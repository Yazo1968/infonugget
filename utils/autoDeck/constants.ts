import { AutoDeckLod, DetailLevel } from '../../types';

// ── Level of Detail configuration ──

export interface LodConfig {
  name: AutoDeckLod;
  label: string;
  wordCountMin: number;
  wordCountMax: number;
  midpoint: number;
  detailLevel: DetailLevel;
}

export const AUTO_DECK_LOD_LEVELS: Record<AutoDeckLod, LodConfig> = {
  executive: {
    name: 'executive',
    label: 'Executive',
    wordCountMin: 70,
    wordCountMax: 100,
    midpoint: 85,
    detailLevel: 'Executive',
  },
  standard: {
    name: 'standard',
    label: 'Standard',
    wordCountMin: 200,
    wordCountMax: 250,
    midpoint: 225,
    detailLevel: 'Standard',
  },
  detailed: {
    name: 'detailed',
    label: 'Detailed',
    wordCountMin: 450,
    wordCountMax: 500,
    midpoint: 475,
    detailLevel: 'Detailed',
  },
};

// ── Limits ──

export const AUTO_DECK_LIMITS = {
  maxRevisions: 5,
  maxCardsWarning: 40,
  minCards: 3,
} as const;

// ── Briefing field word limits ──

/** Word limits per briefing field: [min, max]. */
export const BRIEFING_LIMITS: Record<string, { min: number; max: number }> = {
  objective: { min: 15, max: 25 },
  audience: { min: 10, max: 15 },
  type: { min: 10, max: 15 },
  focus: { min: 20, max: 25 },
  tone: { min: 3, max: 5 },
};

/** Number of AI suggestions to generate per briefing field. */
export const BRIEFING_SUGGESTION_COUNT = 7;

// ── Helpers ──

/** Rough card count estimate from total word count and LOD. */
export function estimateCardCount(
  totalWordCount: number,
  lod: AutoDeckLod,
): { estimate: number; min: number; max: number } {
  const lodConfig = AUTO_DECK_LOD_LEVELS[lod];

  // Simple division: total words / LOD midpoint
  const rawEstimate = Math.round(totalWordCount / lodConfig.midpoint);

  // Clamp to minimum
  const clamped = Math.max(AUTO_DECK_LIMITS.minCards, rawEstimate);

  return {
    estimate: clamped,
    min: Math.max(AUTO_DECK_LIMITS.minCards, Math.floor(clamped * 0.7)),
    max: Math.ceil(clamped * 1.3),
  };
}

// Re-export shared countWords so existing imports keep working
export { countWords } from '../prompts/promptUtils';
