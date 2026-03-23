import { AutoDeckLod, DetailLevel } from '../../types';

// ── Level of Detail configuration (shared by deck generation features) ──

export interface LodConfig {
  name: AutoDeckLod;
  label: string;
  wordCountMin: number;
  wordCountMax: number;
  midpoint: number;
  detailLevel: DetailLevel;
}

export const LOD_LEVELS: Record<AutoDeckLod, LodConfig> = {
  executive: {
    name: 'executive',
    label: 'Executive',
    wordCountMin: 60,
    wordCountMax: 80,
    midpoint: 70,
    detailLevel: 'Executive',
  },
  standard: {
    name: 'standard',
    label: 'Standard',
    wordCountMin: 120,
    wordCountMax: 170,
    midpoint: 145,
    detailLevel: 'Standard',
  },
  detailed: {
    name: 'detailed',
    label: 'Detailed',
    wordCountMin: 250,
    wordCountMax: 300,
    midpoint: 275,
    detailLevel: 'Detailed',
  },
};

/** Rough card count estimate from total word count and LOD. */
export function estimateCardCount(
  totalWordCount: number,
  lod: AutoDeckLod,
): { estimate: number; min: number; max: number } {
  const lodConfig = LOD_LEVELS[lod];
  const rawEstimate = Math.round(totalWordCount / lodConfig.midpoint);
  const MIN_CARDS = 3;
  const clamped = Math.max(MIN_CARDS, rawEstimate);
  return {
    estimate: clamped,
    min: Math.max(MIN_CARDS, Math.floor(clamped * 0.7)),
    max: Math.ceil(clamped * 1.3),
  };
}

// ── Briefing field word limits ──

/** Word limits per briefing field: [min, max]. */
export const BRIEFING_LIMITS: Record<string, { min: number; max: number }> = {
  objective: { min: 15, max: 25 },
  audience: { min: 10, max: 15 },
  type: { min: 10, max: 15 },
  focus: { min: 20, max: 25 },
  tone: { min: 3, max: 5 },
};

export const BRIEFING_SUGGESTION_COUNT = 7;

// Re-export shared countWords so existing imports keep working
export { countWords } from '../prompts/promptUtils';
