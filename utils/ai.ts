import { StylingOptions, Palette, FontPair, CustomStyle } from '../types';
import { createLogger } from './logger';
import { supabase } from './supabase';
import {
  CLAUDE_MODEL,
  API_MAX_RETRIES,
  RETRY_BACKOFF_BASE_MS,
  RETRY_JITTER_MAX_MS,
  RETRY_DELAY_CAP_MS,
} from './constants';

// ─────────────────────────────────────────────────────────────────
// Supabase Edge Function URLs
// ─────────────────────────────────────────────────────────────────

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const CLAUDE_PROXY_URL = `${SUPABASE_URL}/functions/v1/claude-proxy`;
const CLAUDE_FILES_PROXY_URL = `${SUPABASE_URL}/functions/v1/claude-files-proxy`;
const GEMINI_PROXY_URL = `${SUPABASE_URL}/functions/v1/gemini-proxy`;

/** Get a fresh Supabase auth token for Edge Function calls. */
async function getAuthToken(): Promise<string> {
  // getSession() may return a cached/expired token — try it first,
  // then force a refresh if the token looks expired or is missing.
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.access_token) {
    // Check if the JWT is expired by decoding the payload
    try {
      const payload = JSON.parse(atob(session.access_token.split('.')[1]));
      const nowSec = Math.floor(Date.now() / 1000);
      if (payload.exp && payload.exp > nowSec + 30) {
        // Token still valid (with 30s buffer)
        return session.access_token;
      }
    } catch {
      // If we can't decode, use the token as-is and let the server decide
      return session.access_token;
    }
  }

  // Token missing or expired — force a refresh
  const { data: { session: refreshed }, error } = await supabase.auth.refreshSession();
  if (error || !refreshed?.access_token) {
    throw new Error('Not authenticated — session refresh failed');
  }
  return refreshed.access_token;
}

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

// ── Structured style identities — technique + composition + mood ──
// Single source of truth: visible in UI, injected into prompts.

import { StyleIdentity } from '../types';

export const STYLE_IDENTITY_FIELDS: Record<string, StyleIdentity> = {
  'Flat Design': {
    technique: 'Solid color fills with no gradients, shadows, or textures. Crisp geometric shapes and simple flat icons.',
    composition: 'Strict grid layout with generous whitespace and clear visual hierarchy.',
    mood: 'Clean, modern, and approachable.',
  },
  'Data-Centric Minimalist': {
    technique: 'Line-art or monotone-fill icons only — no photography or 3D. Hard geometric edges, hyper-legible typography.',
    composition: 'Strict 12-column grid with 15% edge breathing room. Data logic prioritized over decoration.',
    mood: 'Precision-engineered, cold professional, analytical.',
  },
  Isometric: {
    technique: '3D objects at a 30° isometric angle with three visible faces. Solid fills with subtle shading for volume, no perspective distortion.',
    composition: 'Structured spatial arrangement with consistent isometric grid alignment.',
    mood: 'Technical, dimensional, explanatory.',
  },
  'Line Art': {
    technique: 'Built entirely from strokes and outlines — no filled shapes. Varying line weights for hierarchy, hatching for shading.',
    composition: 'Editorial layout, whitespace-heavy, minimal elements.',
    mood: 'Refined, restrained, illustrative.',
  },
  'Retro / Mid-Century': {
    technique: 'Muted earthy tones with textured grain. Atomic-era shapes, starbursts, and bold vintage display typography.',
    composition: 'Print poster arrangement with layered overlapping elements and decorative framing.',
    mood: '1950s–60s graphic design, nostalgic, confident.',
  },
  'Risograph / Duotone': {
    technique: 'Two or three overlapping ink colors with visible halftone dots and slight mis-registration. Grainy, textured surface.',
    composition: 'Overlapping color layers with offset alignment, zine-style page structure.',
    mood: 'Analog, lo-fi, indie-press.',
  },
  'Neon / Dark Mode': {
    technique: 'Vivid glowing neon elements with light bloom halos on dark background. Thin glowing outlines and circuit-like patterns.',
    composition: 'Sleek futuristic geometry, dashboard-style modular sections.',
    mood: 'Cyberpunk, electric, high-tech.',
  },
  'Paper Cutout': {
    technique: 'Layered cut-paper shapes with visible paper texture and subtle inter-layer shadows. Slightly irregular hand-cut edges.',
    composition: 'Overlapping depth layers, soft rounded forms, collage arrangement.',
    mood: 'Warm, tactile, handcrafted.',
  },
  'Pop Art': {
    technique: 'Thick black outlines, flat saturated primary colors, and Ben-Day halftone dots. Bold display typography.',
    composition: 'Comic panel layout with bold partitioning and graphic impact.',
    mood: 'Loud, punchy, Warhol/Lichtenstein-inspired.',
  },
  Watercolour: {
    technique: 'Soft fluid paint washes that bleed and blend with no hard edges. Translucent color layers on visible paper grain.',
    composition: 'Free-flowing organic arrangement with soft boundaries between sections.',
    mood: 'Light, airy, painterly.',
  },
  Blueprint: {
    technique: 'White and light-blue linework on deep blue ground. Construction lines, dimension annotations, monospaced labels.',
    composition: 'Technical drawing grid with labeled compartments and structured alignment.',
    mood: 'Precision engineering, analytical clarity, drafting-table formality.',
  },
  'Doodle Art': {
    technique: 'Hand-drawn pen sketches with slightly wobbly freehand lines and quick hatching. Arrows, stars, underlines as embellishments.',
    composition: 'Casual whiteboard/notebook arrangement, loosely organized clusters.',
    mood: 'Playful, informal, spontaneous.',
  },
  'Geometric Gradient': {
    technique: 'Overlapping translucent geometric shapes with smooth multi-color gradient fills. Glassmorphism and soft blurs.',
    composition: 'Layered transparency with floating elements and polished digital composition.',
    mood: 'Tech-forward, digital-native, polished.',
  },
  'Corporate Memphis': {
    technique: 'Flat illustrations with disproportionate human figures — oversized limbs, tiny heads. Blobby organic shapes, no outlines.',
    composition: 'Friendly open layout with breathing room around character-driven scenes.',
    mood: 'Warm, optimistic, approachable tech-company.',
  },
  'PwC Corporate': {
    technique: 'Clean flat renders, orange hero accent for key statistics and callout borders. Flat charts with direct value labeling.',
    composition: 'Modular card layout with generous whitespace, strict visual hierarchy. Serif headings, sans-serif body.',
    mood: 'Authoritative, corporate consulting, trustworthy.',
  },
};

// Derived legacy map — kept for backward compat with any code that still reads STYLE_IDENTITIES.
export const STYLE_IDENTITIES: Record<string, string> = Object.fromEntries(
  Object.entries(STYLE_IDENTITY_FIELDS).map(([name, { technique, composition, mood }]) => [
    name,
    `${technique} ${composition} ${mood}`,
  ]),
);

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
      delete STYLE_IDENTITY_FIELDS[name];
    }
  }
  // 2. Inject each custom style
  for (const s of styles) {
    if (BUILTIN_STYLE_NAMES.has(s.name)) continue; // never overwrite built-in
    VISUAL_STYLES[s.name] = { ...s.palette };
    STYLE_FONTS[s.name] = { ...s.fonts };
    // Register structured fields if available, otherwise use legacy identity
    if (s.technique || s.composition || s.mood) {
      STYLE_IDENTITY_FIELDS[s.name] = {
        technique: s.technique || '',
        composition: s.composition || '',
        mood: s.mood || '',
      };
      STYLE_IDENTITIES[s.name] = [s.technique, s.composition, s.mood].filter(Boolean).join(' ');
    } else {
      STYLE_IDENTITIES[s.name] = s.identity;
    }
  }
}

export const DEFAULT_STYLING: StylingOptions = {
  levelOfDetail: 'Standard',
  style: 'Flat Design',
  palette: VISUAL_STYLES['Flat Design'],
  fonts: STYLE_FONTS['Flat Design'],
  aspectRatio: '16:9',
  resolution: '2K',
  technique: STYLE_IDENTITY_FIELDS['Flat Design'].technique,
  composition: STYLE_IDENTITY_FIELDS['Flat Design'].composition,
  mood: STYLE_IDENTITY_FIELDS['Flat Design'].mood,
};

// ─────────────────────────────────────────────────────────────────
// Gemini 3 API Config Constants
// IMPORTANT: Gemini 3 docs mandate temperature=1.0 (the default).
// Setting <1.0 causes looping/degraded performance on reasoning tasks.
// DO NOT add temperature overrides without reading the Gemini 3 migration guide.
// ─────────────────────────────────────────────────────────────────

/** Config for Gemini Flash text-only calls: low thinking + text-only output */
const _FLASH_TEXT_CONFIG = {
  thinkingConfig: { thinkingLevel: 'Low' as any },
  responseModalities: ['TEXT'],
};

/** Config for Gemini image generation calls. Supported levels: Minimal (default), High. */
export const PRO_IMAGE_CONFIG = {
  thinkingConfig: { thinkingLevel: 'High' as any },
  responseModalities: ['TEXT', 'IMAGE'],
};

// ─────────────────────────────────────────────────────────────────
// Gemini Proxy — calls Gemini via Supabase Edge Function
// ─────────────────────────────────────────────────────────────────

export interface GeminiProxyResponse {
  text?: string;
  images?: Array<{ data: string; mimeType: string }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  /** Why the model stopped generating (e.g. STOP, SAFETY, MAX_TOKENS). */
  finishReason?: string | null;
  /** Per-category safety ratings from the model. */
  safetyRatings?: Array<{ category: string; probability: string }> | null;
  /** Prompt-level feedback — present when the prompt itself was blocked. */
  promptFeedback?: { blockReason?: string; safetyRatings?: unknown[] } | null;
}

/**
 * Call Gemini via the Supabase Edge Function proxy.
 * Replaces direct `@google/genai` SDK usage — API keys are server-side only.
 */
export async function callGeminiProxy(
  model: string,
  contents: any,
  config: any,
  signal?: AbortSignal,
): Promise<GeminiProxyResponse> {
  const token = await getAuthToken();
  const res = await fetch(GEMINI_PROXY_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ model, contents, config }),
    signal,
  });
  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`Gemini proxy error ${res.status}: ${errorBody}`);
  }
  return res.json();
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
 * Gemini-aware retry wrapper. Key rotation is now handled server-side
 * by the Edge Function, so this simply delegates to withRetry.
 */
export const withGeminiRetry = async <T>(
  fn: () => Promise<T>,
  maxRetries = API_MAX_RETRIES,
  onRetry?: (attempt: number, maxAttempts: number, delayMs: number) => void,
): Promise<T> => {
  return await withRetry(fn, maxRetries, onRetry);
};

// ─────────────────────────────────────────────────────────────────
// Claude API (Anthropic) — used for all text intelligence
// Supports prompt caching via cache_control on system + message blocks.
// ─────────────────────────────────────────────────────────────────

/** Shared headers for Claude proxy calls via Supabase Edge Function. */
function claudeProxyHeaders(token: string): Record<string, string> {
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'apikey': SUPABASE_ANON_KEY,
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
  /** Enable extended thinking with a token budget. When set, temperature is ignored (API requirement). */
  thinking?: { budgetTokens: number };
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

  // Normalize legacy 2-arg calls: callClaude(prompt, { base64, mediaType })
  let document: { base64: string; mediaType: string } | undefined;
  let system: string | undefined;
  let maxTokens = CLAUDE_MAX_TOKENS;
  let temperature: number | undefined;
  let systemBlocks: SystemBlock[] | undefined;
  let messages: ClaudeMessage[] | undefined;
  let signal: AbortSignal | undefined;
  let thinking: { budgetTokens: number } | undefined;

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
    thinking = opts.thinking;
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

  if (thinking) {
    // Extended thinking: temperature must not be set (API requirement)
    body.thinking = { type: 'enabled', budget_tokens: thinking.budgetTokens };
  } else if (temperature != null) {
    body.temperature = temperature;
  }

  if (systemPayload) {
    body.system = systemPayload;
  }

  const token = await getAuthToken();

  const response = await withRetry(async () => {
    const res = await fetch(CLAUDE_PROXY_URL, {
      method: 'POST',
      headers: claudeProxyHeaders(token),
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
 * Upload text content to the Anthropic Files API via Supabase Edge Function proxy.
 * Returns the file_id for referencing in subsequent Messages requests.
 */
export async function uploadToFilesAPI(
  content: string | Blob | File,
  filename: string,
  mimeType: string = 'text/plain',
): Promise<string> {
  const token = await getAuthToken();

  const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
  const formData = new FormData();
  formData.append('file', blob, filename);

  const res = await fetch(CLAUDE_FILES_PROXY_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'apikey': SUPABASE_ANON_KEY,
    },
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
): Promise<{ palette: Palette; fonts: FontPair; identity: string; technique: string; composition: string; mood: string }> {
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
  "technique": "<15-20 words — rendering method: shapes, fills, strokes, textures, visual treatment. Two concise sentences.>",
  "composition": "<10-15 words — layout rules: grid, spacing, visual hierarchy, arrangement. One concise sentence.>",
  "mood": "<4-8 words — atmosphere: era, feeling, personality, register. One short phrase.>"
}

Rules:
- All palette colors must be valid 6-digit hex codes with # prefix
- Choose fonts available on Google Fonts
- Ensure sufficient contrast between background and text colors
- technique: EXACTLY 15-20 words. Describe rendering approach — what shapes, fills, strokes, textures are used. Two concise sentences.
- composition: EXACTLY 10-15 words. Describe layout rules — grid system, spacing, hierarchy, element arrangement. One concise sentence.
- mood: EXACTLY 4-8 words. Describe atmosphere — era, emotional tone, personality. One short phrase.
- Each field must be specific and actionable for an image generation model — no vague adjectives
- If the user mentioned specific colors or fonts, honor them; fill in the rest to complement
- If the user provided identity-like descriptions, decompose them into the three fields`;

  const prompt = `Style name: ${name}\n\nUser description:\n${description}`;
  const { text } = await callClaude(prompt, { system, maxTokens: 500, signal });

  // Parse the JSON response (handle possible markdown fencing)
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  }

  const parsed = JSON.parse(cleaned);

  // Validate structure
  if (!parsed.palette || !parsed.fonts || (!parsed.technique && !parsed.identity)) {
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
    identity: [
      parsed.technique || '',
      parsed.composition || '',
      parsed.mood || '',
    ]
      .filter((s) => s.trim())
      .join(' ') || String(parsed.identity || '').trim(),
    technique: String(parsed.technique || '').trim(),
    composition: String(parsed.composition || '').trim(),
    mood: String(parsed.mood || '').trim(),
  };
}

/**
 * Delete a file from the Anthropic Files API via Supabase Edge Function proxy.
 */
export async function deleteFromFilesAPI(fileId: string): Promise<void> {
  try {
    const token = await getAuthToken();
    const res = await fetch(`${CLAUDE_FILES_PROXY_URL}/${fileId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`,
        'apikey': SUPABASE_ANON_KEY,
      },
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

