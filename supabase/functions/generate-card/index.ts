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
  TitleCard: 150, TakeawayCard: 350, Executive: 300, Standard: 600, Detailed: 1200,
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
  const supabase = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
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

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function describeCanvas(ar: string): string {
  if (ar === "9:16") return "portrait — taller than wide";
  if (ar === "1:1") return "square — equal width and height";
  if (["4:5", "3:4", "2:3"].includes(ar)) return "portrait — taller than wide";
  if (["5:4", "3:2"].includes(ar)) return "near-square landscape";
  return "landscape — wider than tall";
}

function buildExpertPriming(subject?: string): string {
  if (!subject) return "";
  return `You are a domain expert on the following subject: ${subject}. Use accurate terminology and professional judgment to organize and present the source material. Do NOT add facts, claims, data, or context from your own knowledge — work exclusively with what the source documents provide.`;
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
const STYLE_IDENTITIES: Record<string, string> = {
  "Flat Design": "Solid color fills with no gradients, shadows, or textures. Crisp geometric shapes, simple flat icons, and strict grid layout with generous whitespace.",
  "Data-Centric Minimalist": "Precision-engineered, cold professional, hyper-legible. Strict 12-column grid with 15% edge breathing room. Line-art or monotone-fill icons only — no photography or 3D. Hard geometric edges, analytical SaaS-blue atmosphere prioritizing data logic over personality.",
  "Isometric": "3D objects at a 30° isometric angle with three visible faces and no perspective distortion. Solid fills with subtle shading for volume, structured spatial arrangement.",
  "Line Art": "Built entirely from strokes and outlines — no filled shapes. Varying line weights for hierarchy, hatching for shading. Editorial and whitespace-heavy.",
  "Retro / Mid-Century": "1950s–60s graphic design with muted earthy tones and textured grain. Atomic-era shapes, starbursts, and bold vintage typography like a classic print poster.",
  "Risograph / Duotone": "Mimics risograph printing — two or three overlapping ink colors with visible halftone dots and slight mis-registration. Grainy, textured, analog zine feel.",
  "Neon / Dark Mode": "Dark background with vivid glowing neon elements and light bloom halos. Sleek futuristic geometry, thin glowing outlines, and circuit-like patterns. Cyberpunk dashboard feel.",
  "Paper Cutout": "Layered cut-paper look with visible paper texture and subtle shadows between layers. Soft rounded forms with slightly irregular hand-cut edges. Warm and tactile like a collage.",
  "Pop Art": "Bold Warhol/Lichtenstein-inspired with thick black outlines, flat saturated primary colors, and Ben-Day halftone dots. Big punchy typography like a comic panel.",
  "Watercolour": "Soft fluid paint washes that bleed and blend with no hard edges. Translucent color layers on visible paper grain. Light, airy, and painterly.",
  "Blueprint": "Technical drawing on deep blue background with white/light blue linework. Grid lines, dimension annotations, construction lines, and monospaced type like an engineer's drawing.",
  "Doodle Art": "Hand-drawn pen sketches with slightly wobbly freehand lines and quick hatching. Playful embellishments — arrows, stars, underlines. Informal whiteboard/notebook feel.",
  "Geometric Gradient": "Overlapping translucent geometric shapes with smooth multi-color gradient fills. Glassmorphism, soft blurs, and a polished tech-forward digital-native aesthetic.",
  "Corporate Memphis": "Friendly flat illustrations with disproportionate human figures — oversized limbs, tiny heads. Blobby organic shapes, no outlines, warm optimistic tech-company tone.",
  "PwC Corporate": "Clean, authoritative corporate consulting aesthetic with disciplined restraint. White background with orange as the singular hero accent for callout borders, key statistics, and focal chart elements. Grey data visualizations with only the focal metric highlighted in orange. Modular card-based layout with generous whitespace, clear section dividers, and a strict visual hierarchy. No decorative flourishes — every element serves the argument.",
};

// ── Prompt builders ──

interface StylingOptions {
  levelOfDetail: string;
  style: string;
  palette: { background: string; primary: string; secondary: string; accent: string; text: string };
  fonts: { primary: string; secondary: string };
  aspectRatio: string;
  resolution: string;
}

function buildNarrativeStyleBlock(settings: StylingOptions): string {
  const identity = STYLE_IDENTITIES[settings.style] || "";
  const styleParagraph = identity
    ? `Design this infographic in a ${settings.style} aesthetic. ${identity} Let this style drive every visual decision — shapes, decorations, title treatments, section dividers, background textures, and iconography.`
    : `Design this infographic in a bold ${settings.style} aesthetic. Let the ${settings.style} style drive every visual decision — shapes, decorations, title treatments, section dividers, background textures, and iconography should all feel authentically ${settings.style}.`;
  const p = settings.palette;
  const bgName = hexToColorName(p.background);
  const primaryName = hexToColorName(p.primary);
  const secondaryName = hexToColorName(p.secondary);
  const accentName = hexToColorName(p.accent);
  const textName = hexToColorName(p.text);
  const paletteParagraph = `Color palette: ${bgName} (${p.background}) background, ${primaryName} (${p.primary}) for headers and primary elements, ${secondaryName} (${p.secondary}) for secondary accents, ${accentName} (${p.accent}) for callout numbers and highlights, ${textName} (${p.text}) for body text. Stay within these five colors but allow natural tonal variation for depth and dimension.`;
  const pFontDesc = fontToDescriptor(settings.fonts.primary);
  const sFontDesc = fontToDescriptor(settings.fonts.secondary);
  const typographyParagraph = pFontDesc === sFontDesc
    ? `Use a ${pFontDesc} typeface throughout. Maintain a clear size hierarchy from title to headers to body text. All text must be legible.`
    : `Use a ${pFontDesc} typeface for titles and headers, and a ${sFontDesc} typeface for body text. Maintain a clear size hierarchy. All text must be legible.`;
  return `${styleParagraph}\n\n${paletteParagraph}\n\n${typographyParagraph}`;
}

function transformContentToTags(synthesisContent: string, cardTitle: string): string {
  let content = synthesisContent;
  content = content.replace(/^---+$/gm, "");
  content = content.replace(/^####\s+(.+)$/gm, "[DETAIL] $1");
  content = content.replace(/^###\s+(.+)$/gm, "[SUBSECTION] $1");
  content = content.replace(/^##\s+(.+)$/gm, "[SECTION] $1");
  content = content.replace(/^#\s+.+$/gm, "");
  content = content.replace(/\*\*(.+?)\*\*/g, "$1");
  content = content.replace(/\*(.+?)\*/g, "$1");
  content = content.replace(/^[\s]*[-*]\s+/gm, "");
  content = content.replace(/\n{3,}/g, "\n\n");
  content = content.trim();
  return `[BEGIN TEXT CONTENT]\n[TITLE] ${cardTitle}\n\n${content}\n[END TEXT CONTENT]`;
}

function transformCoverContentToTags(coverContent: string, cardTitle: string): string {
  let content = coverContent;
  content = content.replace(/^#\s+(.+)$/gm, "[TITLE] $1");
  content = content.replace(/^##\s+(.+)$/gm, "[SUBTITLE] $1");
  content = content.replace(/\*\*(.+?)\*\*/g, "$1");
  content = content.replace(/\*(.+?)\*/g, "$1");
  content = content.replace(/\n{3,}/g, "\n\n");
  content = content.trim();
  content = content.replace(/^[-*]\s+(.+)$/gm, "[TAKEAWAY-BULLET] $1");
  const lines = content.split("\n").map((line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return "";
    if (trimmed.startsWith("[TITLE]") || trimmed.startsWith("[SUBTITLE]") || trimmed.startsWith("[TAKEAWAY-BULLET]")) return trimmed;
    if (content.includes("[SUBTITLE]")) return `[TAGLINE] ${trimmed}`;
    return `[TAKEAWAY] ${trimmed}`;
  });
  const taggedContent = lines.filter((l: string) => l).join("\n");
  return `[BEGIN COVER CONTENT]\n${taggedContent}\n[END COVER CONTENT]`;
}

const FONT_NAMES = ["Montserrat","Inter","Roboto","Open Sans","Lato","Poppins","Raleway","Nunito","Source Sans","Work Sans","DM Sans","Playfair Display","Merriweather","Lora","Georgia","Garamond","PT Serif","Libre Baskerville","Source Serif","Crimson Text","Source Code Pro","Fira Code","JetBrains Mono","IBM Plex Mono","IBM Plex Sans","Helvetica","Arial","Verdana","Tahoma","Trebuchet","Bebas Neue","Orbitron","Rajdhani","Oswald","Impact","Arial Black","DIN Condensed","Pacifico","Comic Sans MS","Rubik","Quicksand","Futura","Courier New"];

function sanitizePlannerOutput(plannerText: string): string {
  let text = plannerText;
  text = text.replace(/^#{1,6}\s+/gm, "");
  text = text.replace(/\*\*(.+?)\*\*/g, "$1");
  text = text.replace(/\*(.+?)\*/g, "$1");
  text = text.replace(/^---+$/gm, "");
  text = text.replace(/^\d+\.\s+/gm, "");
  text = text.replace(/^[\s]*[-*]\s+/gm, "");
  text = text.replace(/#[0-9A-Fa-f]{3,8}\b/g, "");
  for (const font of FONT_NAMES) {
    const escaped = font.replace(/\s+/g, "\\s+");
    text = text.replace(new RegExp(`\\b${escaped}\\b\\s*(?:Bold|SemiBold|Regular|Medium|Light|Thin|ExtraBold|Black)?`, "gi"), "");
  }
  text = text.replace(/\b\d{1,3}(?:-\d{1,3})?pt\b/gi, "");
  text = text.replace(/\b\d{2,4}x\d{2,4}\b/g, "");
  text = text.replace(/\b\d+px\b/gi, "");
  text = text.replace(/[ \t]{2,}/g, " ");
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
}

function assembleRendererPrompt(cardTitle: string, synthesisContent: string, settings: StylingOptions, plannerOutput?: string, referenceNote?: string, subject?: string): string {
  const domainClause = subject ? ` The content belongs to the domain of "${subject}" — use domain-appropriate visual metaphors, iconography, and diagram conventions.` : "";
  const role = `You are an expert Information Designer. Create a visually striking infographic.${domainClause}`;
  const styleBlock = buildNarrativeStyleBlock(settings);
  let layoutBlock: string;
  if (plannerOutput) {
    const cleanPlan = sanitizePlannerOutput(plannerOutput);
    layoutBlock = `Use the following creative brief to guide the information architecture and visual concept. Interpret it strictly within the ${settings.style} style described above — the style identity is non-negotiable and takes precedence over any visual interpretation of the brief.\n\n${cleanPlan}\n\nEvery single piece of text content provided below must appear in the final image — no heading, bullet point, statistic, or detail may be omitted. If the layout concept cannot fit all the content, adapt the layout rather than dropping text. Reduce whitespace, add rows, extend sections, or use a denser arrangement — but never cut content. All text must be legible with high contrast.`;
  } else {
    layoutBlock = "Choose the spatial arrangement that best fits the content hierarchy — grids, flowing sections, or radial layouts as appropriate. Every single piece of text content provided below must appear in the final image — no heading, bullet point, statistic, or detail may be omitted. If the layout cannot fit all the content, adapt it rather than dropping text. All text must be legible with high contrast.";
  }
  const contentBlock = transformContentToTags(synthesisContent, cardTitle);
  const tagInstruction = "The content below uses bracketed tags like [TITLE], [SECTION], [SUBSECTION], [DETAIL], [BEGIN TEXT CONTENT], and [END TEXT CONTENT] to indicate text hierarchy. These tags are structural markers only — do NOT render them as visible text in the image. Render only the text that follows each tag, using the tag to determine visual weight (TITLE = largest, SECTION = heading, SUBSECTION = subheading, DETAIL = minor heading).";
  const blocks = [role, styleBlock];
  if (referenceNote) blocks.push(referenceNote);
  blocks.push(layoutBlock, tagInstruction, contentBlock);
  return blocks.join("\n\n");
}

function buildContentPrompt(cardTitle: string, level: string, subject?: string): string {
  let wordCountRange = "200-250";
  let scopeGuidance = "";
  let formattingGuidance = "";
  if (level === "Executive") {
    wordCountRange = "70-100";
    scopeGuidance = "**Scope:** This is an EXECUTIVE SUMMARY. Prioritize ruthlessly — include only the single most important insight, conclusion, or finding.";
    formattingGuidance = "**Formatting (strict for Executive):**\n- Maximum one ## heading below the title\n- Prefer a tight paragraph or 2-3 bullets — nothing more\n- No tables, no numbered lists, no ###";
  } else if (level === "Detailed") {
    wordCountRange = "450-500";
    scopeGuidance = "**Scope:** This is a DETAILED analysis. Include comprehensive data, supporting evidence, comparisons, and relationships.";
    formattingGuidance = "**Formatting:**\n- Use bullet points for lists\n- Use numbered lists for sequential steps\n- Use tables when comparing items\n- Use bold for key terms\n- Choose the format that best represents the data";
  } else {
    scopeGuidance = "**Scope:** This is a STANDARD summary. Cover the key points, important data, and primary relationships.";
    formattingGuidance = "**Formatting:**\n- Use bullet points for lists\n- Use numbered lists for sequential steps\n- Use tables only when comparing 3+ items\n- Use bold for key terms";
  }
  const expertPriming = buildExpertPriming(subject);
  return `${expertPriming ? expertPriming + "\n\n" : ""}Content Generation — [${cardTitle}]\nUsing the DOCUMENT STRUCTURE and READING INSTRUCTIONS above, read and analyze the target section including all its sub-sections and nested content.\n\n**WORD COUNT: EXACTLY ${wordCountRange} words. This is a hard limit.**\n\n${scopeGuidance}\n\n**Task:** Extract and restructure the section's content into infographic-ready text within the word limit.\n\n**Requirements:**\n- Make explicit any relationships that are implied\n- Use concise, direct phrasing\n- Preserve key data points exactly as written\n- Do not invent information not present in the documents\n\n${formattingGuidance}\n\n**Heading Hierarchy (strict):**\n- Do NOT include the section title as a heading\n- Use ## for main sections\n- Use ### for subsections (if word count permits)\n- Never use # (H1) — reserved for section title\n\n**Output:** Return ONLY the card content. No preamble. REMINDER: ${wordCountRange} words maximum.`.trim();
}

function buildCoverContentPrompt(cardTitle: string, coverType: string, subject?: string): string {
  const expertPriming = buildExpertPriming(subject);
  if (coverType === "TitleCard") {
    return `${expertPriming ? expertPriming + "\n\n" : ""}Cover Slide Content — [${cardTitle}]\nUsing the DOCUMENT STRUCTURE and READING INSTRUCTIONS above, read and analyze the target section.\n\n**Task:** Generate content for a TITLE CARD SLIDE. Use "${cardTitle}" as the title (or a refined version).\n\n**Output format (strict):**\n# [Title — 2-8 words]\n## [Subtitle — 5-12 words]\n[Tagline — optional, 3-8 words]\n\n**WORD COUNT:** 15-25 words total. Hard limit.\n\n**Output:** Return ONLY the cover content starting with #. No preamble.`.trim();
  }
  return `${expertPriming ? expertPriming + "\n\n" : ""}Cover Slide Content — [${cardTitle}]\nUsing the DOCUMENT STRUCTURE and READING INSTRUCTIONS above, read and analyze the target section.\n\n**Task:** Generate content for a TAKEAWAY CARD SLIDE. Use "${cardTitle}" as the title.\n\n**Output format (strict):**\n# [Title — 2-8 words]\n- [Takeaway bullet 1]\n- [Takeaway bullet 2]\n- [Takeaway bullet 3 (optional)]\n\n**WORD COUNT:** 40-60 words total. Hard limit.\n\n**Output:** Return ONLY the cover content starting with #. No preamble.`.trim();
}

function buildPlannerPrompt(cardTitle: string, synthesisContent: string, aspectRatio: string, previousPlan?: string, subject?: string): string {
  const wordCount = countWords(synthesisContent);
  const canvasDescription = describeCanvas(aspectRatio);
  let diversityClause = "";
  if (previousPlan) {
    diversityClause = `\n## PREVIOUS CONCEPT (DO NOT REPEAT):\n${previousPlan.slice(0, 600)}\n---\n`;
  }
  const domainContext = subject ? `\n## DOMAIN CONTEXT:\nThis content belongs to the domain of "${subject}".\n` : "";
  return `# CREATIVE VISUAL BRIEF — [${cardTitle}]\n\nYou are an expert information designer creating a creative brief for an infographic.${domainContext}\n\n## CANVAS:\n- Aspect ratio: ${aspectRatio} (${canvasDescription})\n- Content density: ~${wordCount} words${diversityClause}\n\n## CONTENT:\n---\n${synthesisContent}\n---\n\nWrite a short creative brief (150-250 words) covering: DATA RELATIONSHIPS, VISUAL CONCEPT, CONTENT GROUPINGS, FOCAL HIERARCHY.\n\nRULES: No exact positions, no container types, no colors/fonts/sizes, no rewriting content, reference ALL content items.`.trim();
}

function buildCoverPlannerPrompt(cardTitle: string, coverContent: string, style: string, aspectRatio: string, coverType: string): string {
  const canvasDescription = describeCanvas(aspectRatio);
  const coverKind = coverType === "TitleCard" ? "Title Card" : "Takeaway Card";
  return `COVER SLIDE LAYOUT PLANNING — [${cardTitle}]\n\nYou are an expert cover slide designer. Plan the visual layout of a ${coverKind}.\n\nCANVAS: ${aspectRatio} (${canvasDescription})\n\nCONTENT:\n---\n${coverContent}\n---\n\nPlan a visually striking cover slide. The title is the hero element. This is NOT a data infographic. No charts, grids, or bullet lists. Write narrative prose covering COMPOSITION, VISUAL FOCAL POINT, STYLE APPLICATION (${style}), TEXT HIERARCHY.\n\nFORBIDDEN: font names, point sizes, hex colors, pixel values.`.trim();
}

function buildVisualizerPrompt(cardTitle: string, contentToMap: string, settings: StylingOptions, visualPlan?: string, subject?: string): string {
  return assembleRendererPrompt(cardTitle, contentToMap, settings, visualPlan, undefined, subject);
}

function buildCoverVisualizerPrompt(cardTitle: string, coverContent: string, settings: StylingOptions, visualPlan?: string, coverType?: string): string {
  const role = "You are an expert cover slide designer. Create a visually striking cover slide — a bold, brand-forward title card that functions as an opener or presentation cover. This is NOT a data infographic. Do not include charts, data grids, bullet lists, or multi-section layouts. The title must be the absolute hero element — the largest, most dominant text on the canvas. Fill the entire canvas with a cohesive visual composition — no empty white areas.";
  const styleBlock = buildNarrativeStyleBlock(settings);
  let layoutBlock: string;
  if (visualPlan) {
    const cleanPlan = sanitizePlannerOutput(visualPlan);
    layoutBlock = `${cleanPlan}\n\nRender the title as the hero element — bold, dominant, and immediately readable. All text must be legible with high contrast against the background.`;
  } else {
    layoutBlock = coverType === "TakeawayCard"
      ? "Place the title prominently in the upper portion. Below it, render takeaway bullet points as a clean, vertically stacked list. Fill remaining canvas with style-driven decorative elements. All text must be legible with high contrast."
      : "Center the title as the dominant element. Place the subtitle below it. If there is a tagline, position it at the bottom edge. Fill canvas with style-driven decorative elements. All text must be legible with high contrast.";
  }
  const contentBlock = transformCoverContentToTags(coverContent, cardTitle);
  const tagInstruction = "The content below uses bracketed tags like [TITLE], [SUBTITLE], [TAGLINE], [TAKEAWAY-BULLET], [BEGIN COVER CONTENT], and [END COVER CONTENT] to indicate text hierarchy. These tags are structural markers only — do NOT render them as visible text in the image. Render only the text that follows each tag.";
  const blocks = [role, styleBlock, layoutBlock, tagInstruction, contentBlock];
  return blocks.join("\n\n");
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

async function getSignedUrl(db: ReturnType<typeof serviceClient>, path: string): Promise<string> {
  const { data, error } = await db.storage.from("card-images").createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) throw new Error(`Signed URL failed: ${error?.message}`);
  return data.signedUrl;
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
      settings, subject,
      existingSynthesis, previousPlan,
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
        ? buildCoverContentPrompt(cardTitle, detailLevel, subject)
        : buildContentPrompt(cardTitle, detailLevel, subject);

      const systemRole = buildExpertPriming(subject) || "You are a content synthesis expert.";

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
    // PHASE 2: Layout Planning (Claude)
    // ══════════════════════════════════════════════════════════════
    let visualPlan = "";
    try {
      const plannerPrompt = isCover
        ? buildCoverPlannerPrompt(cardTitle, synthesisContent, settings.style, settings.aspectRatio, detailLevel)
        : buildPlannerPrompt(cardTitle, synthesisContent, settings.aspectRatio, previousPlan, subject);

      const plannerResult = await callClaude({
        model: CLAUDE_MODEL,
        max_tokens: 1024,
        temperature: 0.7,
        messages: [{ role: "user", content: plannerPrompt }],
      });
      visualPlan = plannerResult.text;
    } catch (err) {
      console.warn("Planner failed, continuing without plan:", (err as Error).message);
    }

    // ══════════════════════════════════════════════════════════════
    // PHASE 3: Image Generation (Gemini)
    // ══════════════════════════════════════════════════════════════
    const imagePrompt = isCover
      ? buildCoverVisualizerPrompt(cardTitle, synthesisContent, settings, visualPlan || undefined, detailLevel)
      : buildVisualizerPrompt(cardTitle, synthesisContent, settings, visualPlan || undefined, subject);

    const parts: any[] = [];
    // Add reference image if provided
    if (referenceImage?.base64) {
      parts.push({ inlineData: { data: referenceImage.base64, mimeType: referenceImage.mimeType || "image/png" } });
    }
    parts.push({ text: imagePrompt });

    const imageConfig = {
      ...{ thinkingConfig: { thinkingLevel: "Minimal" }, responseModalities: ["TEXT", "IMAGE"] },
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
    const signedUrl = await getSignedUrl(db, storagePath);

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

    const album = [];
    for (const row of (albumRows || [])) {
      const url = row.storage_path ? await getSignedUrl(db, row.storage_path) : "";
      album.push({
        id: row.id,
        imageUrl: url,
        storagePath: row.storage_path || "",
        label: row.label || "",
        isActive: row.is_active,
        createdAt: new Date(row.created_at).getTime(),
        sortOrder: row.sort_order,
      });
    }

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
              activeImageMap: { ...(item.activeImageMap || {}), [detailLevel]: signedUrl },
              albumMap: { ...(item.albumMap || {}), [detailLevel]: album },
              visualPlanMap: { ...(item.visualPlanMap || {}), [detailLevel]: visualPlan },
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
      imageUrl: signedUrl,
      storagePath,
      synthesisContent,
      visualPlan,
      geminiUsage,
    });

  } catch (err) {
    console.error("generate-card error:", err);
    return errRes((err as Error).message);
  }
});
