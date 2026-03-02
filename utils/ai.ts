import { StylingOptions, Palette, FontPair, CustomStyle } from '../types';
import type { GoogleGenAI } from '@google/genai';
import { createLogger } from './logger';
import {
  CLAUDE_MODEL,
  API_MAX_RETRIES,
  RETRY_BACKOFF_BASE_MS,
  RETRY_JITTER_MAX_MS,
  RETRY_DELAY_CAP_MS,
} from './constants';

const log = createLogger('AI');

export const VISUAL_STYLES: Record<string, Palette> = {
  'Flat Design': {
    background: '#F5F7FA',
    primary: '#2D5BFF',
    secondary: '#6B7B8D',
    accent: '#FF6B35',
    text: '#1A1A2E',
  },
  'Data-Centric Minimalist': {
    background: '#F4F7F9',
    primary: '#28435A',
    secondary: '#5F9EA0',
    accent: '#9BC4CB',
    text: '#212529',
  },
  Isometric: { background: '#FFFFFF', primary: '#4A90D9', secondary: '#50C878', accent: '#FF6F61', text: '#2C3E50' },
  'Line Art': { background: '#FFFFFF', primary: '#1A1A1A', secondary: '#888888', accent: '#E63946', text: '#1A1A1A' },
  'Retro / Mid-Century': {
    background: '#F4ECD8',
    primary: '#C75B12',
    secondary: '#5B8C5A',
    accent: '#D4A03C',
    text: '#3B2F2F',
  },
  'Risograph / Duotone': {
    background: '#FAF3E8',
    primary: '#E63946',
    secondary: '#1D3557',
    accent: '#E63946',
    text: '#1D3557',
  },
  'Neon / Dark Mode': {
    background: '#0D0D0D',
    primary: '#00F0FF',
    secondary: '#BF00FF',
    accent: '#39FF14',
    text: '#FFFFFF',
  },
  'Paper Cutout': {
    background: '#FFF8F0',
    primary: '#E07A5F',
    secondary: '#81B29A',
    accent: '#F2CC8F',
    text: '#3D405B',
  },
  'Pop Art': { background: '#FFFFFF', primary: '#FF0040', secondary: '#0066FF', accent: '#FFDE00', text: '#1A1A1A' },
  Watercolour: { background: '#FFFFFF', primary: '#7FB3D8', secondary: '#D4A0C0', accent: '#A8D5A2', text: '#4A4A4A' },
  Blueprint: { background: '#0B3D91', primary: '#FFFFFF', secondary: '#87CEEB', accent: '#FFD700', text: '#FFFFFF' },
  'Doodle Art': { background: '#FFFFFF', primary: '#222222', secondary: '#555555', accent: '#FF6B35', text: '#222222' },
  'Geometric Gradient': {
    background: '#F0F0F5',
    primary: '#6C5CE7',
    secondary: '#00CEC9',
    accent: '#FD79A8',
    text: '#2D3436',
  },
  'Corporate Memphis': {
    background: '#FAF0E6',
    primary: '#1877F2',
    secondary: '#F4845F',
    accent: '#FFC947',
    text: '#14213D',
  },
  'PwC Corporate': {
    background: '#FFFFFF',
    primary: '#D04A02',
    secondary: '#2D2D2D',
    accent: '#EB8C00',
    text: '#2D2D2D',
  },
};

export const STYLE_FONTS: Record<string, FontPair> = {
  'Flat Design': { primary: 'Montserrat', secondary: 'Open Sans' },
  'Data-Centric Minimalist': { primary: 'Inter', secondary: 'IBM Plex Sans' },
  Isometric: { primary: 'Bebas Neue', secondary: 'Roboto' },
  'Line Art': { primary: 'Raleway', secondary: 'Lato' },
  'Retro / Mid-Century': { primary: 'Futura', secondary: 'Helvetica' },
  'Risograph / Duotone': { primary: 'Oswald', secondary: 'Source Sans Pro' },
  'Neon / Dark Mode': { primary: 'Orbitron', secondary: 'Rajdhani' },
  'Paper Cutout': { primary: 'Quicksand', secondary: 'Nunito' },
  'Pop Art': { primary: 'Impact', secondary: 'Arial Black' },
  Watercolour: { primary: 'Playfair Display', secondary: 'Lora' },
  Blueprint: { primary: 'DIN Condensed', secondary: 'Courier New' },
  'Doodle Art': { primary: 'Pacifico', secondary: 'Comic Sans MS' },
  'Geometric Gradient': { primary: 'Poppins', secondary: 'Inter' },
  'Corporate Memphis': { primary: 'Work Sans', secondary: 'Rubik' },
  'PwC Corporate': { primary: 'Georgia', secondary: 'Arial' },
};

export const STYLE_IDENTITIES: Record<string, string> = {
  'Flat Design':
    'Solid color fills with no gradients, shadows, or textures. Crisp geometric shapes, simple flat icons, and strict grid layout with generous whitespace.',
  'Data-Centric Minimalist':
    'Precision-engineered, cold professional, hyper-legible. Strict 12-column grid with 15% edge breathing room. Line-art or monotone-fill icons only — no photography or 3D. Hard geometric edges, analytical SaaS-blue atmosphere prioritizing data logic over personality.',
  Isometric:
    '3D objects at a 30° isometric angle with three visible faces and no perspective distortion. Solid fills with subtle shading for volume, structured spatial arrangement.',
  'Line Art':
    'Built entirely from strokes and outlines — no filled shapes. Varying line weights for hierarchy, hatching for shading. Editorial and whitespace-heavy.',
  'Retro / Mid-Century':
    '1950s–60s graphic design with muted earthy tones and textured grain. Atomic-era shapes, starbursts, and bold vintage typography like a classic print poster.',
  'Risograph / Duotone':
    'Mimics risograph printing — two or three overlapping ink colors with visible halftone dots and slight mis-registration. Grainy, textured, analog zine feel.',
  'Neon / Dark Mode':
    'Dark background with vivid glowing neon elements and light bloom halos. Sleek futuristic geometry, thin glowing outlines, and circuit-like patterns. Cyberpunk dashboard feel.',
  'Paper Cutout':
    'Layered cut-paper look with visible paper texture and subtle shadows between layers. Soft rounded forms with slightly irregular hand-cut edges. Warm and tactile like a collage.',
  'Pop Art':
    'Bold Warhol/Lichtenstein-inspired with thick black outlines, flat saturated primary colors, and Ben-Day halftone dots. Big punchy typography like a comic panel.',
  Watercolour:
    'Soft fluid paint washes that bleed and blend with no hard edges. Translucent color layers on visible paper grain. Light, airy, and painterly.',
  Blueprint:
    "Technical drawing on deep blue background with white/light blue linework. Grid lines, dimension annotations, construction lines, and monospaced type like an engineer's drawing.",
  'Doodle Art':
    'Hand-drawn pen sketches with slightly wobbly freehand lines and quick hatching. Playful embellishments — arrows, stars, underlines. Informal whiteboard/notebook feel.',
  'Geometric Gradient':
    'Overlapping translucent geometric shapes with smooth multi-color gradient fills. Glassmorphism, soft blurs, and a polished tech-forward digital-native aesthetic.',
  'Corporate Memphis':
    'Friendly flat illustrations with disproportionate human figures — oversized limbs, tiny heads. Blobby organic shapes, no outlines, warm optimistic tech-company tone.',
  'PwC Corporate':
    'Clean, authoritative corporate consulting aesthetic with disciplined restraint. White background with orange as the singular hero accent for callout borders, key statistics, and focal chart elements. Grey data visualizations with only the focal metric highlighted in orange. Modular card-based layout with generous whitespace, clear section dividers, and a strict visual hierarchy. No decorative flourishes — every element serves the argument. Flat charts with minimal gridlines, direct value labeling, and orange left-border callout boxes for key figures.',
};

// Snapshot of built-in style names — used to guard against overwriting and for UI dividers
export const BUILTIN_STYLE_NAMES: ReadonlySet<string> = new Set(Object.keys(VISUAL_STYLES));

/**
 * Injects user-created custom styles into the runtime maps so they work
 * seamlessly with the existing prompt pipeline (buildNarrativeStyleBlock, etc.).
 * Call on app startup and after any custom style CRUD operation.
 */
export function registerCustomStyles(styles: CustomStyle[]): void {
  // 1. Clear any previously-registered custom entries
  for (const name of Object.keys(VISUAL_STYLES)) {
    if (!BUILTIN_STYLE_NAMES.has(name)) {
      delete VISUAL_STYLES[name];
      delete STYLE_FONTS[name];
      delete STYLE_IDENTITIES[name];
    }
  }
  // 2. Inject each custom style
  for (const s of styles) {
    if (BUILTIN_STYLE_NAMES.has(s.name)) continue; // never overwrite built-in
    VISUAL_STYLES[s.name] = { ...s.palette };
    STYLE_FONTS[s.name] = { ...s.fonts };
    STYLE_IDENTITIES[s.name] = s.identity;
  }
}

export const DEFAULT_STYLING: StylingOptions = {
  levelOfDetail: 'Standard',
  style: 'Flat Design',
  palette: VISUAL_STYLES['Flat Design'],
  fonts: STYLE_FONTS['Flat Design'],
  aspectRatio: '16:9',
  resolution: '1K',
};

// ─────────────────────────────────────────────────────────────────
// Gemini 3 API Config Constants
// IMPORTANT: Gemini 3 docs mandate temperature=1.0 (the default).
// Setting <1.0 causes looping/degraded performance on reasoning tasks.
// DO NOT add temperature overrides without reading the Gemini 3 migration guide.
// ─────────────────────────────────────────────────────────────────

/** Config for Gemini Flash text-only calls: low thinking + text-only output */
const _FLASH_TEXT_CONFIG = {
  thinkingConfig: { thinkingLevel: 'LOW' },
  responseModalities: ['TEXT'],
};

/** Config for Gemini Pro Image calls: must include responseModalities to ensure image output */
export const PRO_IMAGE_CONFIG = {
  responseModalities: ['TEXT', 'IMAGE'],
};

// ─────────────────────────────────────────────────────────────────
// Gemini key rotation — primary + fallback key with auto-failover
// ─────────────────────────────────────────────────────────────────

const GEMINI_KEYS = [process.env.API_KEY, process.env.GEMINI_API_KEY_FALLBACK].filter(Boolean) as string[];

let _currentKeyIndex = 0;
let _GoogleGenAICtor: (new (opts: { apiKey: string }) => GoogleGenAI) | null = null;
let _aiInstance: GoogleGenAI | null = null;

/** Get the current Gemini AI instance (lazy singleton, loads @google/genai on demand). */
export async function getGeminiAI(): Promise<GoogleGenAI> {
  if (!_aiInstance) {
    if (!_GoogleGenAICtor) {
      const { GoogleGenAI: Ctor } = await import('@google/genai');
      _GoogleGenAICtor = Ctor;
    }
    _aiInstance = new _GoogleGenAICtor({ apiKey: GEMINI_KEYS[_currentKeyIndex] || '' });
  }
  return _aiInstance;
}

/** Switch to the next available Gemini API key. Returns true if a fallback was available. */
function rotateGeminiKey(): boolean {
  if (_currentKeyIndex + 1 < GEMINI_KEYS.length) {
    _currentKeyIndex++;
    _aiInstance = null; // force re-creation with new key
    log.warn(`Rotated to fallback key (index ${_currentKeyIndex})`);
    return true;
  }
  return false;
}

/** Reset back to the primary key (call on app init or after a cooldown). */
function _resetGeminiKey(): void {
  _currentKeyIndex = 0;
  _aiInstance = null;
}

/** Compare two StylingOptions for style-anchoring mismatch (style, aspectRatio, palette — NOT resolution/fonts/level) */
export function detectSettingsMismatch(current: StylingOptions, reference: StylingOptions): boolean {
  if (current.style !== reference.style) return true;
  if (current.aspectRatio !== reference.aspectRatio) return true;
  const keys: (keyof Palette)[] = ['background', 'primary', 'secondary', 'accent', 'text'];
  return keys.some((k) => current.palette[k] !== reference.palette[k]);
}

/** Classify whether an API error is transient and worth retrying. */
function isRetryableError(err: any): boolean {
  const msg = (err.message || '').toLowerCase();
  const status = err.status || err.httpStatusCode || 0;
  return (
    status === 429 ||
    status === 500 ||
    status === 503 ||
    msg.includes('429') ||
    msg.includes('500') ||
    msg.includes('503') ||
    msg.includes('overloaded') ||
    msg.includes('unavailable') ||
    msg.includes('resource_exhausted') ||
    msg.includes('rate limit') ||
    msg.includes('rate_limit') ||
    msg.includes('too many requests') ||
    msg.includes('internal server error') ||
    msg.includes('high demand')
  );
}

const withRetry = async <T>(
  fn: () => Promise<T>,
  maxRetries = API_MAX_RETRIES,
  onRetry?: (attempt: number, maxAttempts: number, delayMs: number) => void,
): Promise<T> => {
  let retries = 0;
  while (retries < maxRetries) {
    try {
      return await fn();
    } catch (err: any) {
      if (isRetryableError(err)) {
        retries++;
        if (retries >= maxRetries) throw err;
        // Exponential backoff with jitter
        const baseDelay = Math.pow(2, retries) * RETRY_BACKOFF_BASE_MS;
        const jitter = Math.random() * RETRY_JITTER_MAX_MS;
        const delay = Math.min(baseDelay + jitter, RETRY_DELAY_CAP_MS);
        onRetry?.(retries, maxRetries, delay);
        const errDetail = err.status || err.httpStatusCode || (err.message || '').slice(0, 60);
        log.warn(
          `Attempt ${retries}/${maxRetries} failed (${errDetail}). Retrying in ${(delay / 1000).toFixed(1)}s...`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw err;
    }
  }
  throw new Error('Maximum retries reached');
};

/**
 * Gemini-aware retry wrapper: runs `withRetry` first, and if all retries fail
 * with a retryable error, rotates to the fallback API key and retries once more.
 */
export const withGeminiRetry = async <T>(
  fn: () => Promise<T>,
  maxRetries = API_MAX_RETRIES,
  onRetry?: (attempt: number, maxAttempts: number, delayMs: number) => void,
): Promise<T> => {
  try {
    return await withRetry(fn, maxRetries, onRetry);
  } catch (err: any) {
    if (isRetryableError(err) && rotateGeminiKey()) {
      log.warn('Primary key exhausted, retrying with fallback key...');
      return await withRetry(fn, maxRetries, onRetry);
    }
    throw err;
  }
};

// ─────────────────────────────────────────────────────────────────
// Claude API (Anthropic) — used for all text intelligence
// Supports prompt caching via cache_control on system + message blocks.
// ─────────────────────────────────────────────────────────────────

/** Shared Anthropic API headers. */
function anthropicHeaders(apiKey: string): Record<string, string> {
  return {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    'anthropic-beta': 'files-api-2025-04-14',
    'anthropic-dangerous-direct-browser-access': 'true',
  };
}

const CLAUDE_MAX_TOKENS = 64000;

// Minimum tokens for Sonnet caching (1,024 tokens ≈ ~4,000 chars)
const CACHE_MIN_CHARS = 4000;

interface ClaudeContentBlock {
  type: string;
  text?: string;
  source?: { type: string; media_type?: string; data?: string; file_id?: string };
  title?: string;
  cache_control?: { type: 'ephemeral' };
}

interface ClaudeSystemBlock {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
}

export interface ClaudeUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

interface ClaudeResponse {
  content: Array<{ type: string; text: string }>;
  usage: ClaudeUsage;
}

/** A message in a multi-turn conversation for the Claude messages API */
export interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string | ClaudeContentBlock[];
}

/** System block with optional caching */
export interface SystemBlock {
  text: string;
  cache?: boolean;
}

interface CallClaudeOptions {
  document?: { base64: string; mediaType: string };
  system?: string;
  maxTokens?: number;
  /** Sampling temperature (0–1). Default: 1 (API default). Use lower values for deterministic/analytical tasks. */
  temperature?: number;
  /** Structured system blocks with per-block cache control (overrides `system` string) */
  systemBlocks?: SystemBlock[];
  /** Multi-turn messages array (overrides single-prompt `prompt` arg). Last user message auto-gets cache_control. */
  messages?: ClaudeMessage[];
  /** AbortSignal for cancelling the request */
  signal?: AbortSignal;
}

/**
 * Call Claude API directly via fetch (browser-compatible, no Node.js SDK needed).
 * Supports text-only, document analysis (PDF), general-purpose prompting,
 * and prompt caching via `systemBlocks` and `messages` options.
 *
 * @param prompt  - The text prompt to send (ignored when `options.messages` is provided)
 * @param options - Optional: document, system prompt, max tokens, caching controls
 *
 * Backward compatible: `callClaude(prompt, { base64, mediaType })` still works.
 */
export async function callClaude(
  prompt: string,
  options?: CallClaudeOptions | { base64: string; mediaType: string },
): Promise<{ text: string; usage: ClaudeUsage }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured');

  // Normalize legacy 2-arg calls: callClaude(prompt, { base64, mediaType })
  let document: { base64: string; mediaType: string } | undefined;
  let system: string | undefined;
  let maxTokens = CLAUDE_MAX_TOKENS;
  let temperature: number | undefined;
  let systemBlocks: SystemBlock[] | undefined;
  let messages: ClaudeMessage[] | undefined;
  let signal: AbortSignal | undefined;

  if (options && 'base64' in options && 'mediaType' in options) {
    // Legacy format: direct document object
    document = options as { base64: string; mediaType: string };
  } else if (options) {
    const opts = options as CallClaudeOptions;
    document = opts.document;
    system = opts.system;
    maxTokens = opts.maxTokens ?? CLAUDE_MAX_TOKENS;
    temperature = opts.temperature;
    systemBlocks = opts.systemBlocks;
    messages = opts.messages;
    signal = opts.signal;
  }

  // ── Build system prompt ──
  let systemPayload: string | ClaudeSystemBlock[] | undefined;

  if (systemBlocks && systemBlocks.length > 0) {
    // Structured system blocks with per-block cache control
    systemPayload = systemBlocks.map((block) => {
      const b: ClaudeSystemBlock = { type: 'text', text: block.text };
      if (block.cache && block.text.length >= CACHE_MIN_CHARS) {
        b.cache_control = { type: 'ephemeral' };
      }
      return b;
    });
  } else if (system) {
    // Plain string system prompt — auto-cache if large enough
    if (system.length >= CACHE_MIN_CHARS) {
      systemPayload = [{ type: 'text' as const, text: system, cache_control: { type: 'ephemeral' as const } }];
    } else {
      systemPayload = system;
    }
  }

  // ── Build messages ──
  let messagesPayload: Array<{ role: string; content: string | ClaudeContentBlock[] }>;

  if (messages && messages.length > 0) {
    // Multi-turn messages — add cache_control to last user message
    messagesPayload = messages.map((msg, i) => {
      // Find if this is the last user message
      const isLastUser = msg.role === 'user' && !messages!.slice(i + 1).some((m) => m.role === 'user');

      if (isLastUser && typeof msg.content === 'string') {
        // Wrap string content to add cache_control
        return {
          role: msg.role,
          content: [
            {
              type: 'text',
              text: msg.content,
              cache_control: { type: 'ephemeral' as const },
            },
          ],
        };
      } else if (isLastUser && Array.isArray(msg.content)) {
        // Add cache_control to the last block in the content array
        const blocks = [...msg.content];
        const lastBlock = { ...blocks[blocks.length - 1] };
        lastBlock.cache_control = { type: 'ephemeral' };
        blocks[blocks.length - 1] = lastBlock;
        return { role: msg.role, content: blocks };
      }
      return msg;
    });
  } else {
    // Single-prompt fallback (original behavior)
    const content: ClaudeContentBlock[] = [];
    if (document) {
      content.push({
        type: 'document',
        source: { type: 'base64', media_type: document.mediaType, data: document.base64 },
      });
    }
    content.push({ type: 'text', text: prompt });
    messagesPayload = [{ role: 'user', content }];
  }

  const body: Record<string, any> = {
    model: CLAUDE_MODEL,
    max_tokens: maxTokens,
    messages: messagesPayload,
  };

  if (temperature != null) {
    body.temperature = temperature;
  }

  if (systemPayload) {
    body.system = systemPayload;
  }

  const response = await withRetry(async () => {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { ...anthropicHeaders(apiKey), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      const errorBody = await res.text();
      throw new Error(`Claude API error ${res.status}: ${errorBody}`);
    }

    return (await res.json()) as ClaudeResponse;
  });

  // Guard against empty/blocked responses
  const usage = response.usage ?? { input_tokens: 0, output_tokens: 0 };

  // Log cache performance
  const { cache_creation_input_tokens, cache_read_input_tokens, input_tokens } = usage;
  if (cache_creation_input_tokens || cache_read_input_tokens) {
    log.debug(
      `cache_read: ${cache_read_input_tokens ?? 0}, cache_write: ${cache_creation_input_tokens ?? 0}, uncached: ${input_tokens}`,
    );
  }

  // Extract text from response
  const contentBlocks = response.content ?? [];
  const textBlocks = contentBlocks.filter((b) => b.type === 'text');
  return {
    text: textBlocks.map((b) => b.text).join('\n') || '',
    usage,
  };
}

// ─────────────────────────────────────────────────────────────────
// Anthropic Files API (beta) — upload once, reference by file_id
// ─────────────────────────────────────────────────────────────────

interface FilesAPIResponse {
  id: string;
  type: 'file';
  filename: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
}

/**
 * Upload text content to the Anthropic Files API.
 * Returns the file_id for referencing in subsequent Messages requests.
 */
export async function uploadToFilesAPI(
  content: string | Blob | File,
  filename: string,
  mimeType: string = 'text/plain',
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured');

  const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
  const formData = new FormData();
  formData.append('file', blob, filename);

  const res = await fetch('/api/anthropic-files', {
    method: 'POST',
    headers: anthropicHeaders(apiKey),
    body: formData,
  });

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`Files API upload error ${res.status}: ${errorBody}`);
  }

  const data = (await res.json()) as FilesAPIResponse;
  log.debug(`Uploaded "${filename}" → ${data.id} (${data.size_bytes} bytes)`);
  return data.id;
}

/**
 * Generate a complete custom style (palette, fonts, identity) from a user-provided name and
 * free-form description using Claude. The description can be anything — specific color/font
 * requests, a vague mood, a reference to an era, or even gibberish. The AI extracts whatever
 * is usable and fills in the rest with sensible design choices.
 *
 * Returns the generated fields or throws on failure.
 */
export async function generateStyleWithAI(
  name: string,
  description: string,
  signal?: AbortSignal,
): Promise<{ palette: Palette; fonts: FontPair; identity: string }> {
  const system = `You are a visual design expert specializing in presentation and infographic styles. A user wants to create a custom visual style. They have provided a style name and a free-form description.

The description may contain ANY combination of:
- Specific color requests (e.g. hex codes, color names, "blue and gold")
- Font preferences (e.g. "use Helvetica", "something modern")
- Mood/era references (e.g. "Art Deco", "minimalist Japanese", "90s retro")
- Detailed identity descriptions
- Vague wishes (e.g. "make it look professional")
- Partial information (e.g. only colors, only fonts, etc.)
- Gibberish or irrelevant text

Your job:
1. Extract any usable design intent from the description
2. Research the design references mentioned — recall relevant color theory, typography pairings, historical design movements, brand aesthetics, or cultural associations that apply to the user's description
3. Use your research to make informed, intentional design choices rather than generic defaults
4. For anything not specified or not usable, make excellent design choices that are coherent with whatever WAS specified
5. If the entire description is gibberish or empty, create a clean, professional style inspired by the style name alone
6. Always produce a complete, cohesive style — never leave fields empty or default

Return ONLY valid JSON with no markdown fencing, no explanation, in this exact structure:
{
  "palette": {
    "background": "<hex>",
    "primary": "<hex>",
    "secondary": "<hex>",
    "accent": "<hex>",
    "text": "<hex>"
  },
  "fonts": {
    "primary": "<Google Font name for titles>",
    "secondary": "<Google Font name for body text>"
  },
  "identity": "<40-80 word visual identity description that describes shapes, textures, layout style, mood, and specific design rules>"
}

Rules:
- All palette colors must be valid 6-digit hex codes with # prefix
- Choose fonts available on Google Fonts
- Ensure sufficient contrast between background and text colors
- The identity must be specific and actionable — describe shapes, space usage, textures, mood, and layout rules
- If the user mentioned specific colors or fonts, honor them; fill in the rest to complement
- If the user provided an identity-like description, refine and expand it into a proper identity`;

  const prompt = `Style name: ${name}\n\nUser description:\n${description}`;
  const { text } = await callClaude(prompt, { system, maxTokens: 500, signal });

  // Parse the JSON response (handle possible markdown fencing)
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  }

  const parsed = JSON.parse(cleaned);

  // Validate structure
  if (!parsed.palette || !parsed.fonts || !parsed.identity) {
    throw new Error('AI response missing required fields');
  }
  for (const key of ['background', 'primary', 'secondary', 'accent', 'text']) {
    if (typeof parsed.palette[key] !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(parsed.palette[key])) {
      throw new Error(`Invalid palette color for ${key}: ${parsed.palette[key]}`);
    }
  }
  if (!parsed.fonts.primary || !parsed.fonts.secondary) {
    throw new Error('AI response missing font names');
  }

  return {
    palette: {
      background: parsed.palette.background,
      primary: parsed.palette.primary,
      secondary: parsed.palette.secondary,
      accent: parsed.palette.accent,
      text: parsed.palette.text,
    },
    fonts: {
      primary: String(parsed.fonts.primary).trim(),
      secondary: String(parsed.fonts.secondary).trim(),
    },
    identity: String(parsed.identity).trim(),
  };
}

/**
 * Delete a file from the Anthropic Files API.
 */
export async function deleteFromFilesAPI(fileId: string): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return; // silent no-op if no key

  try {
    const res = await fetch(`/api/anthropic-files/${fileId}`, {
      method: 'DELETE',
      headers: anthropicHeaders(apiKey),
    });
    if (res.ok) {
      log.debug(`Deleted file ${fileId}`);
    } else {
      log.warn(`Failed to delete file ${fileId}: ${res.status}`);
    }
  } catch (err) {
    log.warn(`Delete failed for ${fileId}:`, err);
  }
}

// ── Files API document injection + Claude call ──

/** A document reference with file_id and name, for Files API injection. */
export interface FileApiDoc {
  fileId: string;
  name: string;
}

/**
 * Call Claude with optional Files API document block injection and usage recording.
 *
 * Handles the common pattern used by useAutoDeck:
 * 1. Inject Files API document blocks into the first user message
 * 2. Call Claude with systemBlocks + messages
 * 3. Record usage metrics via the provided callback
 *
 * @returns The raw response text and usage stats (caller handles parsing).
 */
export async function callClaudeWithFileApiDocs({
  fileApiDocs,
  systemBlocks,
  messages,
  maxTokens,
  signal,
  temperature,
  recordUsage,
}: {
  fileApiDocs: FileApiDoc[];
  systemBlocks: SystemBlock[];
  messages: ClaudeMessage[];
  maxTokens: number;
  signal?: AbortSignal;
  temperature?: number;
  recordUsage?: (entry: {
    provider: 'claude' | 'gemini';
    model: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  }) => void;
}): Promise<{ text: string; usage: ClaudeUsage }> {
  // Inject Files API document blocks into the first user message
  if (fileApiDocs.length > 0) {
    const docBlocks = fileApiDocs.map((d) => ({
      type: 'document' as const,
      source: { type: 'file' as const, file_id: d.fileId },
      title: d.name,
    }));

    if (messages.length > 0 && messages[0].role === 'user') {
      const firstMsg = messages[0];
      const existingBlocks =
        typeof firstMsg.content === 'string'
          ? [{ type: 'text' as const, text: firstMsg.content }]
          : [...firstMsg.content];
      messages[0] = { role: 'user', content: [...docBlocks, ...existingBlocks] as any };
    }
  }

  const opts: Record<string, unknown> = {
    systemBlocks,
    messages,
    maxTokens,
    signal,
  };
  if (temperature != null) opts.temperature = temperature;

  const { text, usage } = await callClaude('', opts as any);

  recordUsage?.({
    provider: 'claude',
    model: CLAUDE_MODEL,
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage?.cache_creation_input_tokens ?? 0,
  });

  return { text, usage };
}
