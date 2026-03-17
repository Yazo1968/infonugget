import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { GoogleGenAI } from "npm:@google/genai";

// ── Env ──
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY")!;
const GEMINI_API_KEY_FALLBACK = Deno.env.get("GEMINI_API_KEY_FALLBACK") || "";

const CLAUDE_MODEL = "claude-sonnet-4-6";
const GEMINI_IMAGE_MODEL = "gemini-3.1-flash-image-preview";
const IMAGE_EMPTY_RETRIES = 2;

const CARD_TOKEN_LIMITS: Record<string, number> = {
  TitleCard: 150, TakeawayCard: 350, Executive: 95, Standard: 203, Detailed: 405,
};
const COVER_TOKEN_LIMIT = 256;

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

// ── Claude call ──
async function callClaude(body: Record<string, unknown>): Promise<{ text: string; usage: unknown }> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "files-api-2025-04-14",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Claude ${res.status}: ${errBody}`);
  }
  const data = await res.json();
  const text = (data.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
  return { text, usage: data.usage };
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

// ── Prompt Helpers (ported from client) ──

function isCoverLevel(level: string): boolean {
  return level === "TitleCard" || level === "TakeawayCard" || level === "DirectContent";
}


function describeCanvas(ar: string): string {
  if (ar === "9:16") return "portrait — taller than wide";
  if (ar === "1:1") return "square — equal width and height";
  if (["4:5", "3:4", "2:3"].includes(ar)) return "portrait — taller than wide";
  if (["5:4", "3:2"].includes(ar)) return "near-square landscape";
  return "landscape — wider than tall";
}

function buildExpertPriming(domain?: string): string {
  if (!domain) return "";
  return `You are a domain expert in the following area:\n${domain}\nUse accurate terminology and professional judgment to organize and present the source material. Do NOT add facts, claims, data, or context from your own knowledge — work exclusively with what the source documents provide.`;
}

// Hex to color name (subset)
const KNOWN_COLORS: Record<string, string> = {
  FFFFFF: "white", FAFAFA: "off-white", F5F7FA: "light grey", F5F5F5: "soft light gray",
  F4ECD8: "warm cream", FAF3E8: "warm ivory", FFF8F0: "warm white", FAF0E6: "linen cream",
  F0F0F0: "pale gray", F4F7F9: "cool white", F0F0F5: "pale lavender",
  "333333": "dark charcoal", "2D2D2D": "near-black", "222222": "dark grey",
  "1A1A2E": "dark navy", "1A1A1A": "near black", "0D0D0D": "near black", "000000": "black",
  "1A365D": "deep navy", "1D3557": "navy blue", "1E3A5F": "deep navy", "14213D": "dark navy",
  "2C3E50": "dark slate", "2C5282": "slate blue", "2D5BFF": "bright blue",
  "3182CE": "ocean blue", "3D405B": "muted navy", "4A90D9": "medium blue",
  "28435A": "deep teal", "5F9EA0": "muted teal", "9BC4CB": "soft cyan", "212529": "charcoal",
  E63946: "crimson red", FF0040: "hot pink", FF6B35: "vivid orange",
  "38A169": "emerald green", "50C878": "emerald green", "5B8C5A": "olive green",
  "81B29A": "sage green", A8D5A2: "soft green",
  D04A02: "burnt orange", EB8C00: "tangerine", C75B12: "rustic orange", D4A03C: "mustard gold",
  E07A5F: "terra cotta", F2CC8F: "sandy peach", FFD700: "gold", FFDE00: "bright yellow",
  "6C5CE7": "purple", "805AD5": "vibrant purple", BF00FF: "purple neon",
  "00CEC9": "turquoise", "00F0FF": "cyan neon", "319795": "teal",
  D4A0C0: "dusty rose", FD79A8: "soft pink",
  "6B7B8D": "slate grey", "4A4A4A": "medium grey", "888888": "mid grey", "555555": "mid grey",
  "1877F2": "facebook blue", "0B3D91": "deep blue", "87CEEB": "sky blue",
  "39FF14": "green neon", "7FB3D8": "soft blue", "3B2F2F": "dark brown",
  FFC947: "warm yellow", F4845F: "peach orange",
};

function hexToColorName(hex: string): string {
  const n = hex.toUpperCase().replace("#", "");
  if (KNOWN_COLORS[n]) return KNOWN_COLORS[n];
  const r = parseInt(n.substring(0, 2), 16);
  const g = parseInt(n.substring(2, 4), 16);
  const b = parseInt(n.substring(4, 6), 16);
  const br = (r + g + b) / 3;
  let hue = "neutral";
  if (r > g && r > b) hue = b > 150 ? "pink" : "red-orange";
  else if (g > r && g > b) hue = "green";
  else if (b > r && b > g) hue = r > 150 ? "purple" : "blue";
  else if (r > 200 && g > 200 && b < 100) hue = "yellow";
  else if (r > 200 && g > 120 && b < 100) hue = "orange";
  else if (Math.abs(r - g) < 30 && Math.abs(g - b) < 30) hue = "gray";
  let lightness = "";
  if (br > 200) lightness = "light ";
  else if (br > 140) lightness = "";
  else if (br > 80) lightness = "medium ";
  else lightness = "dark ";
  return `${lightness}${hue}`.trim();
}

const FONT_DESC: Record<string, string> = {
  montserrat: "clean, geometric sans-serif", poppins: "rounded, geometric sans-serif",
  futura: "sharp, geometric sans-serif", raleway: "thin, elegant sans-serif",
  "dm sans": "compact, geometric sans-serif", nunito: "rounded, friendly sans-serif",
  quicksand: "rounded, modern sans-serif", "bebas neue": "tall, condensed, all-caps sans-serif",
  oswald: "condensed, strong, industrial sans-serif", impact: "heavy, ultra-condensed, bold sans-serif",
  "arial black": "heavy, wide, bold sans-serif", "din condensed": "technical, narrow, industrial sans-serif",
  orbitron: "futuristic, geometric, squared sans-serif", rajdhani: "angular, condensed, technical sans-serif",
  inter: "modern, neutral sans-serif", roboto: "contemporary, versatile sans-serif",
  "open sans": "friendly, neutral sans-serif", lato: "warm, humanist sans-serif",
  "source sans pro": "technical, clean sans-serif", "work sans": "minimal, clean sans-serif",
  rubik: "rounded, geometric, friendly sans-serif", helvetica: "classic, neutral sans-serif",
  arial: "neutral, clean sans-serif", pacifico: "flowing, casual, handwritten script",
  "comic sans ms": "casual, rounded, handwritten sans-serif",
  "playfair display": "elegant, high-contrast serif", merriweather: "sturdy, readable serif",
  lora: "calligraphic, balanced serif", georgia: "classic, rounded serif",
  garamond: "refined, old-style serif", "pt serif": "traditional, professional serif",
  "libre baskerville": "classic, transitional serif", "source serif pro": "sturdy, slab-influenced serif",
  "crimson text": "elegant, bookish serif", "source code pro": "clean, technical monospace",
  "fira code": "modern, ligature-rich monospace", "jetbrains mono": "sharp, developer monospace",
  "ibm plex mono": "structured, technical monospace", "ibm plex sans": "engineered, technical sans-serif",
  "courier new": "classic typewriter monospace",
};

function fontToDescriptor(fontName: string): string {
  const name = fontName.toLowerCase().trim();
  if (FONT_DESC[name]) return FONT_DESC[name];
  for (const [key, desc] of Object.entries(FONT_DESC)) {
    if (name.includes(key) || key.includes(name)) return desc;
  }
  if (name.includes("serif") && !name.includes("sans")) return "professional serif";
  if (name.includes("sans")) return "clean sans-serif";
  if (name.includes("mono") || name.includes("code")) return "clean monospace";
  return "clean, professional typeface";
}

// Style identities (ported from ai.ts)
// ── Structured style identities (fallback for built-in styles when client doesn't send fields) ──

interface StyleIdentityFields { technique: string; composition: string; mood: string; }

const STYLE_IDENTITY_MAP: Record<string, StyleIdentityFields> = {
  "Flat Design": { technique: "Solid color fills with no gradients, shadows, or textures. Crisp geometric shapes and simple flat icons.", composition: "Strict grid layout with generous whitespace and clear visual hierarchy.", mood: "Clean, modern, and approachable." },
  "Data-Centric Minimalist": { technique: "Line-art or monotone-fill icons only — no photography or 3D. Hard geometric edges, hyper-legible typography.", composition: "Strict 12-column grid with 15% edge breathing room. Data logic prioritized over decoration.", mood: "Precision-engineered, cold professional, analytical." },
  "Isometric": { technique: "3D objects at a 30° isometric angle with three visible faces. Solid fills with subtle shading for volume, no perspective distortion.", composition: "Structured spatial arrangement with consistent isometric grid alignment.", mood: "Technical, dimensional, explanatory." },
  "Line Art": { technique: "Built entirely from strokes and outlines — no filled shapes. Varying line weights for hierarchy, hatching for shading.", composition: "Editorial layout, whitespace-heavy, minimal elements.", mood: "Refined, restrained, illustrative." },
  "Retro / Mid-Century": { technique: "Muted earthy tones with textured grain. Atomic-era shapes, starbursts, and bold vintage display typography.", composition: "Print poster arrangement with layered overlapping elements and decorative framing.", mood: "1950s–60s graphic design, nostalgic, confident." },
  "Risograph / Duotone": { technique: "Two or three overlapping ink colors with visible halftone dots and slight mis-registration. Grainy, textured surface.", composition: "Overlapping color layers with offset alignment, zine-style page structure.", mood: "Analog, lo-fi, indie-press." },
  "Neon / Dark Mode": { technique: "Vivid glowing neon elements with light bloom halos on dark background. Thin glowing outlines and circuit-like patterns.", composition: "Sleek futuristic geometry, dashboard-style modular sections.", mood: "Cyberpunk, electric, high-tech." },
  "Paper Cutout": { technique: "Layered cut-paper shapes with visible paper texture and subtle inter-layer shadows. Slightly irregular hand-cut edges.", composition: "Overlapping depth layers, soft rounded forms, collage arrangement.", mood: "Warm, tactile, handcrafted." },
  "Pop Art": { technique: "Thick black outlines, flat saturated primary colors, and Ben-Day halftone dots. Bold display typography.", composition: "Comic panel layout with bold partitioning and graphic impact.", mood: "Loud, punchy, Warhol/Lichtenstein-inspired." },
  "Watercolour": { technique: "Soft fluid paint washes that bleed and blend with no hard edges. Translucent color layers on visible paper grain.", composition: "Free-flowing organic arrangement with soft boundaries between sections.", mood: "Light, airy, painterly." },
  "Blueprint": { technique: "White and light-blue linework on deep blue ground. Construction lines, dimension annotations, monospaced labels.", composition: "Technical drawing grid with labeled compartments and structured alignment.", mood: "Precision engineering, analytical clarity, drafting-table formality." },
  "Doodle Art": { technique: "Hand-drawn pen sketches with slightly wobbly freehand lines and quick hatching. Arrows, stars, underlines as embellishments.", composition: "Casual whiteboard/notebook arrangement, loosely organized clusters.", mood: "Playful, informal, spontaneous." },
  "Geometric Gradient": { technique: "Overlapping translucent geometric shapes with smooth multi-color gradient fills. Glassmorphism and soft blurs.", composition: "Layered transparency with floating elements and polished digital composition.", mood: "Tech-forward, digital-native, polished." },
  "Corporate Memphis": { technique: "Flat illustrations with disproportionate human figures — oversized limbs, tiny heads. Blobby organic shapes, no outlines.", composition: "Friendly open layout with breathing room around character-driven scenes.", mood: "Warm, optimistic, approachable tech-company." },
  "PwC Corporate": { technique: "Clean flat renders, orange hero accent for key statistics and callout borders. Flat charts with direct value labeling.", composition: "Modular card layout with generous whitespace, strict visual hierarchy. Serif headings, sans-serif body.", mood: "Authoritative, corporate consulting, trustworthy." },
};

// ── Prompt builders ──

interface StylingOptions {
  levelOfDetail: string;
  style: string;
  palette: { background: string; primary: string; secondary: string; accent: string; text: string };
  fonts: { primary: string; secondary: string };
  aspectRatio: string;
  resolution: string;
  // Structured style identity — sent from client
  technique?: string;
  composition?: string;
  mood?: string;
}

function buildStyleBlock(settings: StylingOptions): string {
  // Priority: fields on settings (from client) → hardcoded structured map
  const hasSettingsFields = settings.technique || settings.composition || settings.mood;
  const structured = hasSettingsFields
    ? { technique: settings.technique || "", composition: settings.composition || "", mood: settings.mood || "" }
    : STYLE_IDENTITY_MAP[settings.style];

  let identityBlock: string;
  if (structured) {
    identityBlock = `${settings.style}\nTechnique: ${structured.technique}\nComposition: ${structured.composition}\nMood: ${structured.mood}`;
  } else {
    identityBlock = settings.style;
  }

  const p = settings.palette;
  const pFontDesc = fontToDescriptor(settings.fonts.primary);
  const sFontDesc = fontToDescriptor(settings.fonts.secondary);
  const typeLine = pFontDesc === sFontDesc
    ? `Typography: ${pFontDesc} throughout, clear size hierarchy from title to body`
    : `Typography: ${pFontDesc} for titles/headers, ${sFontDesc} for body text`;
  return `${identityBlock}
Palette: background ${p.background} | primary ${p.primary} | secondary ${p.secondary} | accent ${p.accent} | text ${p.text}
${typeLine}
Canvas: ${settings.aspectRatio} ${describeCanvas(settings.aspectRatio)}`;
}

function prepareContentBlock(synthesisContent: string, cardTitle: string): string {
  let content = synthesisContent;
  // Strip H1 (title is provided separately)
  content = content.replace(/^#\s+.+$/gm, "");
  // Collapse excessive blank lines
  content = content.replace(/\n{3,}/g, "\n\n");
  content = content.trim();
  return `Title: ${cardTitle}\n\n${content}`;
}

function prepareCoverContentBlock(coverContent: string): string {
  let content = coverContent;
  // Collapse excessive blank lines
  content = content.replace(/\n{3,}/g, "\n\n");
  content = content.trim();
  return content;
}

function parseDomain(domain?: string): { sector: string; contentNature: string; vizParadigm: string; visuals: string } {
  if (!domain) return { sector: "", contentNature: "", vizParadigm: "", visuals: "" };
  const sectorMatch = domain.match(/-\s*Domain:\s*(.+)/i);
  const natureMatch = domain.match(/-\s*Content nature:\s*(.+)/i);
  const paradigmMatch = domain.match(/-\s*Visualization paradigm:\s*(.+)/i);
  const visualsMatch = domain.match(/-\s*Visual vocabulary:\s*(.+)/i);
  return {
    sector: sectorMatch?.[1]?.trim() || "",
    contentNature: natureMatch?.[1]?.trim() || "",
    vizParadigm: paradigmMatch?.[1]?.trim() || "",
    visuals: visualsMatch?.[1]?.trim() || "",
  };
}

function assembleRendererPrompt(cardTitle: string, synthesisContent: string, settings: StylingOptions, referenceNote?: string, domain?: string): string {
  const styleBlock = buildStyleBlock(settings);
  const contentBlock = prepareContentBlock(synthesisContent, cardTitle);
  let refLine = "";
  if (referenceNote) refLine = `\n\n${referenceNote}`;

  // Build THEME block from domain bullet points
  const themeBlock = domain ? `\n\nTHEME:\n${domain.trim()}` : "";

  return `Transform the provided CONTENT into a highly visual, illustration.
INSTRUCTIONS:
* Use the exact CONTENT provided below.
* make sure you do not repeat the same content in the illustration.
* use the text in the content only, do not add, remove or change any of the content text.
* Use your thinking abilities to apply the THEME and the STYLE provided below
STEPS:
1- plan the illustration layout, components, shapes, text and other elements required.
2- create the illustration according to the plan.${themeBlock}

CONTENT:\n${contentBlock}

STYLE:\n${styleBlock}${refLine}`;
}

function buildContentPrompt(cardTitle: string, level: string, domain?: string): string {
  let wordCountRange = "120-150";
  let wordCountHard = "150";
  let scopeGuidance = "";
  let formattingGuidance = "";
  if (level === "Executive") {
    wordCountRange = "50-70";
    wordCountHard = "70";
    scopeGuidance = "**Scope:** EXECUTIVE SUMMARY — ruthlessly concise. Include ONLY the single most important insight or finding. Cut everything else.";
    formattingGuidance = "**Formatting (strict):**\n- Maximum one ## heading\n- 1 tight paragraph OR 2-3 bullets — nothing more\n- No tables, no numbered lists, no ###";
  } else if (level === "Detailed") {
    wordCountRange = "250-300";
    wordCountHard = "300";
    scopeGuidance = "**Scope:** DETAILED analysis. Include comprehensive data, supporting evidence, comparisons, and relationships.";
    formattingGuidance = "**Formatting:**\n- Use bullet points for lists\n- Use numbered lists for sequential steps\n- Use tables when comparing items\n- Use bold for key terms";
  } else {
    wordCountHard = "150";
    scopeGuidance = "**Scope:** STANDARD summary. Cover key points, important data, and primary relationships.";
    formattingGuidance = "**Formatting:**\n- Use bullet points for lists\n- Use numbered lists for sequential steps\n- Use tables only when comparing 3+ items\n- Use bold for key terms";
  }
  const expertPriming = buildExpertPriming(domain);
  return `${expertPriming ? expertPriming + "\n\n" : ""}Content Generation — [${cardTitle}]\nUsing the DOCUMENT STRUCTURE and READING INSTRUCTIONS above, read and analyze the target section including all its sub-sections and nested content.\n\nWORD LIMIT: ${wordCountRange} words. ABSOLUTE MAXIMUM: ${wordCountHard} words. Count your words before responding. If over ${wordCountHard}, cut content until under.\n\n${scopeGuidance}\n\n**Task:** Extract and restructure the section's content into infographic-ready text.\n\n**Requirements:**\n- Make explicit any relationships that are implied\n- Use concise, direct phrasing\n- Preserve key data points exactly as written\n- Do not invent information not present in the documents\n\n${formattingGuidance}\n\n**Heading Hierarchy (strict):**\n- Do NOT include the section title as a heading\n- Use ## for main sections\n- Use ### for subsections (if word count permits)\n- Never use # (H1) — reserved for section title\n\n**Output:** Return ONLY the card content. No preamble. No commentary. HARD LIMIT: ${wordCountHard} words.`.trim();
}

function buildCoverContentPrompt(cardTitle: string, coverType: string, domain?: string): string {
  const expertPriming = buildExpertPriming(domain);
  if (coverType === "TitleCard") {
    return `${expertPriming ? expertPriming + "\n\n" : ""}Cover Slide Content — [${cardTitle}]\nUsing the DOCUMENT STRUCTURE and READING INSTRUCTIONS above, read and analyze the target section.\n\n**Task:** Generate content for a TITLE CARD SLIDE. Use "${cardTitle}" as the title (or a refined version).\n\n**Output format (strict):**\n# [Title — 2-8 words]\n## [Subtitle — 5-12 words]\n[Tagline — optional, 3-8 words]\n\n**WORD COUNT:** 15-25 words total. Hard limit.\n\n**Output:** Return ONLY the cover content starting with #. No preamble.`.trim();
  }
  return `${expertPriming ? expertPriming + "\n\n" : ""}Cover Slide Content — [${cardTitle}]\nUsing the DOCUMENT STRUCTURE and READING INSTRUCTIONS above, read and analyze the target section.\n\n**Task:** Generate content for a TAKEAWAY CARD SLIDE. Use "${cardTitle}" as the title.\n\n**Output format (strict):**\n# [Title — 2-8 words]\n- [Takeaway bullet 1]\n- [Takeaway bullet 2]\n- [Takeaway bullet 3 (optional)]\n\n**WORD COUNT:** 40-60 words total. Hard limit.\n\n**Output:** Return ONLY the cover content starting with #. No preamble.`.trim();
}

function buildVisualizerPrompt(cardTitle: string, contentToMap: string, settings: StylingOptions, domain?: string): string {
  return assembleRendererPrompt(cardTitle, contentToMap, settings, undefined, domain);
}

function buildCoverVisualizerPrompt(cardTitle: string, coverContent: string, settings: StylingOptions, coverType?: string): string {
  const styleBlock = buildStyleBlock(settings);
  const contentBlock = prepareCoverContentBlock(coverContent);
  const coverInstruction = coverType === "TakeawayCard"
    ? "Generate a bold, brand-forward cover slide. The title must be the largest, most dominant text. Title prominent in upper portion. Takeaway bullets as clean vertical list below. Fill remaining canvas with style-driven decorative elements. No charts, data grids, or multi-section layouts."
    : "Generate a bold, brand-forward cover slide. The title must be the largest, most dominant text, centered as dominant hero element. Subtitle below. Tagline at bottom edge if present. Fill canvas with style-driven decorative elements. No charts, data grids, or multi-section layouts.";

  return `• Instructions:
${coverInstruction}

• Style:
${styleBlock}

• Content:
${contentBlock}`;
}

// ── Storage helpers ──

async function uploadImageToStorage(db: ReturnType<typeof serviceClient>, userId: string, nuggetId: string, cardId: string, detailLevel: string, base64Data: string, mimeType: string, suffix = ""): Promise<string> {
  const ext = mimeType.includes("png") ? "png" : "jpg";
  const ts = Date.now();
  const path = `${userId}/${nuggetId}/${cardId}/${detailLevel}-${ts}${suffix}.${ext}`;
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
    const user = await verifyUser(req);
    if (!user) return errRes("Unauthorized", 401);

    const body = await req.json();
    const {
      nuggetId, cardId, cardTitle, detailLevel,
      settings, domain,
      existingSynthesis,
      documents, // Array of { fileId, name, sourceType, structure?, content? }
      referenceImage, // { base64, mimeType } or null
      skipSynthesis, // boolean — skip phase 1 if synthesis already exists
    } = body;

    if (!nuggetId || !cardId || !cardTitle || !detailLevel || !settings) {
      return errRes("Missing required fields: nuggetId, cardId, cardTitle, detailLevel, settings", 400);
    }

    const db = serviceClient();

    // Update last_api_call_at for Files API cleanup job safety (secondary signal)
    db.from('nuggets')
      .update({ last_api_call_at: new Date().toISOString() })
      .eq('id', nuggetId)
      .then(({ error: e }) => { if (e) console.warn('last_api_call_at update failed:', e); });

    const isCover = isCoverLevel(detailLevel);
    const maxTokens = CARD_TOKEN_LIMITS[detailLevel] ?? COVER_TOKEN_LIMIT;

    // ══════════════════════════════════════════════════════════════
    // PHASE 1: Content Synthesis (Claude)
    // ══════════════════════════════════════════════════════════════
    let synthesisContent = existingSynthesis || "";

    if (!skipSynthesis || !synthesisContent) {
      // Build section focus from documents
      let sectionFocusBlock = "";
      if (documents && documents.length > 0) {
        // Simple section focus — find doc containing the heading
        for (const doc of documents) {
          if (doc.structure && doc.structure.length > 0) {
            const hasTarget = doc.structure.some((h: any) => h.text === cardTitle);
            if (hasTarget || !sectionFocusBlock) {
              // Build a basic TOC with [TARGET] marker
              const targetIdx = doc.structure.findIndex((h: any) => h.text === cardTitle);
              const tocLines = doc.structure.map((h: any, i: number) => {
                const indent = "  ".repeat((h.level || 1) - 1);
                let marker = "";
                if (i === targetIdx) marker = " [TARGET]";
                const pageInfo = h.page ? ` (p. ${h.page})` : "";
                return `${indent}- ${h.text}${pageInfo}${marker}`;
              }).join("\n");
              const readInstructions = targetIdx !== -1
                ? `Locate the section marked [TARGET] and read it including all sub-sections.`
                : `Read the entire document.`;
              sectionFocusBlock = `DOCUMENT STRUCTURE (from "${doc.name}"):\n${readInstructions}\n\n${tocLines}\n\nREADING INSTRUCTIONS:\n${readInstructions}`;
              if (hasTarget) break;
            }
          }
        }
      }

      // Build prompt
      const contentPrompt = isCover
        ? buildCoverContentPrompt(cardTitle, detailLevel, domain)
        : buildContentPrompt(cardTitle, detailLevel, domain);

      const systemRole = buildExpertPriming(domain) || "You are a content synthesis expert.";

      // Build messages with file references
      const userContentParts: any[] = [];
      if (documents) {
        for (const doc of documents) {
          if (doc.fileId) {
            userContentParts.push({ type: "document", source: { type: "file", file_id: doc.fileId } });
          }
        }
      }
      if (sectionFocusBlock) {
        userContentParts.push({ type: "text", text: sectionFocusBlock + "\n\n" + contentPrompt });
      } else {
        userContentParts.push({ type: "text", text: contentPrompt });
      }

      const claudeBody = {
        model: CLAUDE_MODEL,
        max_tokens: maxTokens,
        temperature: 0.3,
        system: [{ type: "text", text: systemRole }],
        messages: [{ role: "user", content: userContentParts }],
      };

      const synthesisResult = await callClaude(claudeBody);
      synthesisContent = synthesisResult.text;

      // For non-cover: strip existing header, prepend # cardTitle
      if (!isCover && synthesisContent) {
        synthesisContent = synthesisContent.replace(/^#\s+.+\n?/, "");
        synthesisContent = `# ${cardTitle}\n${synthesisContent}`;
      }
    }

    if (!synthesisContent) {
      return errRes("Synthesis produced empty content", 500);
    }

    // ══════════════════════════════════════════════════════════════
    // PHASE 2: Image Generation (Gemini)
    // ══════════════════════════════════════════════════════════════
    // DirectContent (snapshot) cards use the standard visualizer — they contain
    // full extracted content, not cover-slide titles/taglines.
    const isCoverImage = (detailLevel === "TitleCard" || detailLevel === "TakeawayCard");
    const imagePrompt = isCoverImage
      ? buildCoverVisualizerPrompt(cardTitle, synthesisContent, settings, detailLevel)
      : buildVisualizerPrompt(cardTitle, synthesisContent, settings, domain);

    const parts: any[] = [];
    // Add reference image if provided
    if (referenceImage?.base64) {
      parts.push({ inlineData: { data: referenceImage.base64, mimeType: referenceImage.mimeType || "image/png" } });
    }
    parts.push({ text: imagePrompt });

    const imageConfig = {
      ...{ thinkingConfig: { thinkingLevel: "High" }, responseModalities: ["TEXT", "IMAGE"] },
      imageConfig: { aspectRatio: settings.aspectRatio.replace(":", ":"), imageSize: settings.resolution === "4K" ? "4K" : settings.resolution === "2K" ? "2K" : "1K" },
    };

    let imageData: string | null = null;
    let imageMimeType = "image/png";
    let geminiUsage: unknown = null;

    // Retry loop for empty image responses
    for (let attempt = 0; attempt <= IMAGE_EMPTY_RETRIES; attempt++) {
      const geminiResult = await callGemini(GEMINI_IMAGE_MODEL, [{ parts }], imageConfig);
      geminiUsage = geminiResult.usageMetadata;

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
      return errRes("Image generation returned empty after retries", 500);
    }

    // ══════════════════════════════════════════════════════════════
    // PHASE 4: Store Image + Update DB (Album System)
    // ══════════════════════════════════════════════════════════════
    const storagePath = await uploadImageToStorage(db, user.id, nuggetId, cardId, detailLevel, imageData, imageMimeType);
    const publicUrl = getPublicUrl(storagePath);

    // Deactivate any existing active image for this album
    await db.from("card_images").update({ is_active: false })
      .eq("nugget_id", nuggetId).eq("card_id", cardId)
      .eq("detail_level", detailLevel).eq("user_id", user.id)
      .eq("is_active", true);

    // Get next sort_order
    const { data: maxOrderRow } = await db.from("card_images")
      .select("sort_order")
      .eq("nugget_id", nuggetId).eq("card_id", cardId)
      .eq("detail_level", detailLevel).eq("user_id", user.id)
      .order("sort_order", { ascending: false })
      .limit(1);
    const nextOrder = (maxOrderRow && maxOrderRow.length > 0 ? maxOrderRow[0].sort_order : -1) + 1;

    // Count existing images for label
    const { count: albumCount } = await db.from("card_images")
      .select("id", { count: "exact", head: true })
      .eq("nugget_id", nuggetId).eq("card_id", cardId)
      .eq("detail_level", detailLevel).eq("user_id", user.id);

    const label = `Generation ${(albumCount || 0) + 1}`;

    // INSERT new album row (active)
    const { data: newRow, error: insertError } = await db.from("card_images").insert({
      nugget_id: nuggetId,
      user_id: user.id,
      card_id: cardId,
      detail_level: detailLevel,
      storage_path: storagePath,
      is_active: true,
      label,
      sort_order: nextOrder,
    }).select("id").single();

    if (insertError) {
      console.error("DB insert error:", insertError);
    }

    const imageId = newRow?.id || "";

    // Build full album for nugget JSONB update
    const { data: albumRows } = await db.from("card_images")
      .select("id, storage_path, is_active, label, sort_order, created_at")
      .eq("nugget_id", nuggetId).eq("card_id", cardId)
      .eq("detail_level", detailLevel).eq("user_id", user.id)
      .order("sort_order", { ascending: true });

    const album = (albumRows || []).map((row) => ({
      id: row.id,
      imageUrl: row.storage_path ? getPublicUrl(row.storage_path) : "",
      storagePath: row.storage_path || "",
      label: row.label || "",
      isActive: row.is_active,
      createdAt: new Date(row.created_at).getTime(),
      sortOrder: row.sort_order,
    }));

    // Update card in nugget's JSONB cards column
    const { data: nuggetData } = await db.from("nuggets").select("cards").eq("id", nuggetId).single();
    if (nuggetData?.cards) {
      const cards = nuggetData.cards as any[];
      const updateCard = (items: any[]): any[] => {
        return items.map((item: any) => {
          if (item.kind === "folder") {
            return { ...item, cards: updateCard(item.cards || []) };
          }
          if (item.id === cardId) {
            const updated = {
              ...item,
              synthesisMap: { ...(item.synthesisMap || {}), [detailLevel]: synthesisContent },
              activeImageMap: { ...(item.activeImageMap || {}), [detailLevel]: publicUrl },
              albumMap: { ...(item.albumMap || {}), [detailLevel]: album },
              lastGeneratedContentMap: { ...(item.lastGeneratedContentMap || {}), [detailLevel]: synthesisContent },
              lastPromptMap: { ...(item.lastPromptMap || {}), [detailLevel]: imagePrompt },
              isGeneratingMap: { ...(item.isGeneratingMap || {}), [detailLevel]: false },
              isSynthesizingMap: { ...(item.isSynthesizingMap || {}), [detailLevel]: false },
            };
            // Clean up legacy fields
            delete updated.cardUrlMap;
            delete updated.imageHistoryMap;
            return updated;
          }
          return item;
        });
      };
      const updatedCards = updateCard(cards);
      await db.from("nuggets").update({ cards: updatedCards, last_modified_at: Date.now() }).eq("id", nuggetId);
    }

    return jsonRes({
      success: true,
      imageId,
      imageUrl: publicUrl,
      storagePath,
      synthesisContent,
      imagePrompt,
      geminiUsage,
    });

  } catch (err) {
    console.error("generate-card error:", err);
    return errRes((err as Error).message);
  }
});
