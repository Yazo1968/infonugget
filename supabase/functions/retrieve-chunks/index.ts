import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { GoogleGenAI } from "npm:@google/genai";

// ── Env ──
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY")!;
const GEMINI_API_KEY_FALLBACK = Deno.env.get("GEMINI_API_KEY_FALLBACK") || "";

// ── Defaults ──
const DEFAULT_MAX_CHUNKS = 20;
const GEMINI_MODEL = "gemini-3-flash-preview";

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

// ── Gemini client with key rotation ──
function getGeminiClients(): GoogleGenAI[] {
  const keys = [GEMINI_API_KEY, GEMINI_API_KEY_FALLBACK].filter(Boolean);
  return keys.map(key => new GoogleGenAI({ apiKey: key }));
}

async function withKeyRotation<T>(fn: (ai: GoogleGenAI) => Promise<T>): Promise<T> {
  const clients = getGeminiClients();
  let lastError: Error | null = null;
  for (const ai of clients) {
    try {
      return await fn(ai);
    } catch (err) {
      lastError = err as Error;
      const msg = (err as Error).message || "";
      if (msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED") || msg.includes("quota")) continue;
      throw err;
    }
  }
  throw lastError || new Error("All Gemini API keys exhausted");
}

// ── Chunk type (mirrors client-side RetrievedChunk) ──
interface RetrievedChunk {
  text: string;
  documentId: string;
  documentName: string;
  chunkIndex: number;
  relevanceScore?: number;
}

// ── Parse grounding metadata into RetrievedChunk[] ──
function parseGroundingMetadata(candidate: any, maxChunks: number): RetrievedChunk[] {
  const gm = candidate?.groundingMetadata;
  if (!gm) return [];

  const chunks: RetrievedChunk[] = [];

  // groundingChunks contains the retrieved text segments
  const groundingChunks = gm.groundingChunks || [];
  // groundingSupports contains relevance/confidence scores
  const groundingSupports = gm.groundingSupports || [];

  for (let i = 0; i < groundingChunks.length && i < maxChunks; i++) {
    const gc = groundingChunks[i];
    const retrievedDoc = gc.retrievedContext || gc.chunk || {};

    // Extract text from the chunk
    const text = retrievedDoc.text || gc.text || "";
    if (!text) continue;

    // Extract document reference — uri often contains the store document path
    const uri = retrievedDoc.uri || retrievedDoc.source || "";
    // The URI is typically like "fileSearchStores/{store}/documents/{docId}"
    const docParts = uri.split("/");
    const documentId = docParts.length >= 4 ? docParts[docParts.length - 1] : uri;
    const documentName = retrievedDoc.title || retrievedDoc.displayName || documentId;

    // Try to find a relevance score from groundingSupports
    let relevanceScore: number | undefined;
    if (groundingSupports[i]) {
      relevanceScore = groundingSupports[i].confidenceScore ??
        groundingSupports[i].score ??
        undefined;
    }

    chunks.push({
      text,
      documentId,
      documentName,
      chunkIndex: i,
      relevanceScore,
    });
  }

  return chunks;
}

// ── Main handler ──
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Auth check
    const user = await verifyUser(req);
    if (!user) return errRes("Unauthorized", 401);

    const body = await req.json();
    const { storeName, queryText, metadataFilter, maxChunks } = body;

    if (!storeName) return errRes("storeName is required", 400);
    if (!queryText) return errRes("queryText is required", 400);

    const limit = maxChunks ?? DEFAULT_MAX_CHUNKS;

    const result = await withKeyRotation(async (ai) => {
      const toolConfig: any = {
        fileSearch: {
          fileSearchStoreNames: [storeName],
        },
      };
      if (metadataFilter) {
        toolConfig.fileSearch.metadataFilter = metadataFilter;
      }

      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: queryText,
        config: {
          tools: [toolConfig],
        },
      });

      const candidate = response.candidates?.[0];
      const chunks = parseGroundingMetadata(candidate, limit);
      const responseText = response.text || undefined;

      return { chunks, responseText };
    });

    return jsonRes(result);
  } catch (err) {
    const msg = (err as Error).message || "Internal server error";
    console.error("[retrieve-chunks] Error:", msg);
    return errRes(msg, 500);
  }
});
