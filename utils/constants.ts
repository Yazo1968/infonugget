/**
 * Shared constants — centralises magic numbers that appear
 * across multiple files in the codebase.
 */

// ── AI Model Names ──

/** Claude model used for all text synthesis/chat calls. */
export const CLAUDE_MODEL = 'claude-sonnet-4-6';

/** Gemini model used for image generation. */
export const GEMINI_IMAGE_MODEL = 'gemini-3.1-flash-image-preview';

/** Gemini model used for PDF conversion, heading extraction, and DocViz semantic prompts. */
export const GEMINI_FLASH_MODEL = 'gemini-3-flash-preview';

// ── AI Retry Configuration ──

/** Maximum number of automatic retries for transient API failures. */
export const API_MAX_RETRIES = 5;

/** Multiplier (ms) for exponential back-off: delay = 2^attempt × BASE. */
export const RETRY_BACKOFF_BASE_MS = 1000;

/** Random jitter ceiling (ms) added to each retry delay. */
export const RETRY_JITTER_MAX_MS = 1000;

/** Hard cap (ms) on the computed retry delay. */
export const RETRY_DELAY_CAP_MS = 32_000;

// ── Card Synthesis Token Budgets ──

/**
 * Max tokens passed to Claude for content synthesis, keyed by detail level.
 * Used by both useCardGeneration (pipeline) and useInsightsLab (chat cards).
 */
export const CARD_TOKEN_LIMITS: Record<string, number> = {
  TitleCard: 150,
  TakeawayCard: 350,
  Executive: 108,
  Standard: 230,
  Detailed: 405,
};

/** Max tokens for cover-card synthesis (non-TakeawayCard covers). */
export const COVER_TOKEN_LIMIT = 256;

/** Default max tokens for general chat completions (non-card requests). */
export const CHAT_MAX_TOKENS = 8192;

/** Max tokens for the lightweight "Initiate Chat" call (doc briefs + suggestions). */
export const INITIATE_CHAT_MAX_TOKENS = 512;
