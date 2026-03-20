import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { GoogleGenAI } from "npm:@google/genai";

// ── Env ──
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY")!;
const GEMINI_API_KEY_FALLBACK = Deno.env.get("GEMINI_API_KEY_FALLBACK") || "";

const GEMINI_IMAGE_MODEL = "gemini-3.1-flash-image-preview";
const IMAGE_EMPTY_RETRIES = 2;

// ── CORS ──
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonRes(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errRes(msg: string, status = 500) {
  return jsonRes({ error: msg }, status);
}

// ── Auth helper ──
async function verifyUser(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;
  const anonKey = req.headers.get("apikey") || Deno.env.get("SUPABASE_ANON_KEY");
  if (!anonKey) return null;
  const supabase = createClient(SUPABASE_URL, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  return user;
}

// ── Service client (bypasses RLS for server-side writes) ──
function serviceClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ── Gemini call with key rotation ──
async function callGemini(model: string, contents: unknown, config: unknown) {
  const keys = [GEMINI_API_KEY, GEMINI_API_KEY_FALLBACK].filter(Boolean);
  let lastError: Error | null = null;
  for (const key of keys) {
    try {
      const ai = new GoogleGenAI({ apiKey: key });
      const response = await ai.models.generateContent({ model, contents, config } as any);
      const result: Record<string, unknown> = {
        text: null, images: [] as Array<{ data: string; mimeType: string }>,
        usageMetadata: response.usageMetadata || null,
        finishReason: null, safetyRatings: null, promptFeedback: null,
      };
      const candidate = response.candidates?.[0];
      if (candidate) {
        result.finishReason = candidate.finishReason ?? null;
        result.safetyRatings = candidate.safetyRatings ?? null;
      }
      if ((response as any).promptFeedback) result.promptFeedback = (response as any).promptFeedback;
      if (candidate?.content?.parts) {
        for (const part of candidate.content.parts) {
          if (part.text) result.text = part.text;
          if (part.inlineData?.data && typeof part.inlineData.data === "string" && part.inlineData.data.length > 0) {
            (result.images as any[]).push({ data: part.inlineData.data, mimeType: part.inlineData.mimeType || "image/png" });
          }
        }
      }
      return result;
    } catch (err) {
      lastError = err as Error;
      const msg = (err as Error).message || "";
      if (msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED") || msg.includes("quota")) continue;
      throw err;
    }
  }
  throw lastError || new Error("All Gemini API keys exhausted");
}

// ── Storage helpers ──

async function uploadDocVizImage(
  db: ReturnType<typeof serviceClient>,
  userId: string,
  nuggetId: string,
  proposalIndex: number,
  base64Data: string,
  mimeType: string,
): Promise<string> {
  const ext = mimeType.includes("png") ? "png" : "jpg";
  const ts = Date.now();
  const path = `${userId}/${nuggetId}/docviz/proposal-${proposalIndex}-${ts}.${ext}`;
  const binaryStr = atob(base64Data);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
  const blob = new Blob([bytes], { type: mimeType });
  const { error } = await db.storage.from("card-images").upload(path, blob, { contentType: mimeType, upsert: true });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);
  return path;
}

function getPublicUrl(path: string): string {
  return `${SUPABASE_URL}/storage/v1/object/public/card-images/${path}`;
}

// ── Main handler ──
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    // ── Auth ──
    const user = await verifyUser(req);
    if (!user) return errRes("Unauthorized", 401);

    // ── Parse & validate request ──
    const body = await req.json();
    const { nuggetId, proposalIndex, prompt, screenshotBase64, aspectRatio, resolution } = body;

    if (!nuggetId || typeof nuggetId !== "string") return errRes("Missing nuggetId", 400);
    if (proposalIndex == null || typeof proposalIndex !== "number" || proposalIndex < 0) return errRes("Invalid proposalIndex", 400);
    if (!prompt || typeof prompt !== "string") return errRes("Missing prompt", 400);
    if (!screenshotBase64 || typeof screenshotBase64 !== "string") return errRes("Missing screenshotBase64", 400);
    if (!aspectRatio || typeof aspectRatio !== "string") return errRes("Missing aspectRatio", 400);

    const imageSize = resolution === "4K" ? "4K" : resolution === "1K" ? "1K" : "2K";

    console.log(`[generate-graphics] User ${user.id} | nugget ${nuggetId} | proposal ${proposalIndex} | ${aspectRatio} ${imageSize} | screenshot ${Math.round(screenshotBase64.length / 1024)}KB`);

    // ── Call Gemini with multimodal input (text prompt + screenshot image) ──
    const imageConfig = {
      thinkingConfig: { thinkingLevel: "Minimal" },
      responseModalities: ["TEXT", "IMAGE"],
      imageConfig: {
        aspectRatio: aspectRatio.replace(":", ":"),
        imageSize,
      },
    };

    // Multimodal parts: screenshot image + text prompt
    const parts = [
      { inlineData: { data: screenshotBase64, mimeType: "image/png" } },
      { text: prompt },
    ];
    let imageData: string | null = null;
    let imageMimeType = "image/png";

    for (let attempt = 0; attempt <= IMAGE_EMPTY_RETRIES; attempt++) {
      const geminiResult = await callGemini(GEMINI_IMAGE_MODEL, [{ parts }], imageConfig);

      const images = geminiResult.images as Array<{ data: string; mimeType: string }>;
      if (images && images.length > 0) {
        const img = images[0];
        if (img.data && typeof img.data === "string" && img.data.length >= 100) {
          imageData = img.data;
          imageMimeType = img.mimeType || "image/png";
          break;
        }
      }

      // Check safety block — don't retry
      if (geminiResult.finishReason === "SAFETY" || (geminiResult.promptFeedback as any)?.blockReason) {
        return errRes("Image generation blocked by safety filter", 422);
      }

      if (attempt < IMAGE_EMPTY_RETRIES) {
        await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
      }
    }

    if (!imageData) {
      return errRes("Gemini returned no image after retries", 500);
    }

    // ── Upload to storage ──
    const db = serviceClient();
    const storagePath = await uploadDocVizImage(db, user.id, nuggetId, proposalIndex, imageData, imageMimeType);
    const publicUrl = getPublicUrl(storagePath);

    console.log(`[generate-graphics] Image uploaded: ${storagePath}`);

    // ── Update nugget's docviz_result JSONB ──
    const { data: nuggetData, error: fetchError } = await db
      .from("nuggets")
      .select("docviz_result")
      .eq("id", nuggetId)
      .single();

    if (fetchError) {
      console.error("[generate-graphics] Failed to fetch nugget:", fetchError);
      // Image is uploaded but JSONB update failed — still return success with URL
    } else if (nuggetData?.docviz_result) {
      const result = nuggetData.docviz_result as any;
      if (result.proposals && Array.isArray(result.proposals) && result.proposals[proposalIndex]) {
        result.proposals[proposalIndex].imageUrl = publicUrl;
        result.proposals[proposalIndex].storagePath = storagePath;

        const { error: updateError } = await db
          .from("nuggets")
          .update({ docviz_result: result, last_modified_at: Date.now() })
          .eq("id", nuggetId);

        if (updateError) {
          console.error("[generate-graphics] Failed to update nugget JSONB:", updateError);
        }
      }
    }

    return jsonRes({ success: true, imageUrl: publicUrl, storagePath });
  } catch (err) {
    console.error("[generate-graphics] Error:", err);
    return errRes((err as Error).message || "Internal error", 500);
  }
});
