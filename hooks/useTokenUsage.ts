import { useState, useRef, useCallback, useEffect } from 'react';
import { CLAUDE_MODEL, GEMINI_IMAGE_MODEL } from '../utils/constants';
import { StorageBackend } from '../utils/storage/StorageBackend';
import { createLogger } from '../utils/logger';

const log = createLogger('TokenUsage');

// ── Cost rates per 1M tokens (USD) ──

const COST_RATES: Record<string, { input: number; output: number; cacheRead?: number; cacheWrite?: number }> = {
  [CLAUDE_MODEL]: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  [GEMINI_IMAGE_MODEL]: { input: 0.25, output: 0.067 },
};

// Fallback for unknown models
const DEFAULT_RATES: { input: number; output: number; cacheRead?: number; cacheWrite?: number } = {
  input: 1,
  output: 5,
};

// ── Types ──

export interface TokenUsageEntry {
  provider: 'claude' | 'gemini';
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  estimatedCost: number;
  timestamp: number;
}

export interface TokenUsageTotals {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCost: number;
  claudeCost: number;
  geminiCost: number;
  claudeInputTokens: number;
  claudeOutputTokens: number;
  geminiInputTokens: number;
  geminiOutputTokens: number;
  callCount: number;
}

const EMPTY_TOTALS: TokenUsageTotals = {
  totalInputTokens: 0,
  totalOutputTokens: 0,
  totalCacheReadTokens: 0,
  totalCost: 0,
  claudeCost: 0,
  geminiCost: 0,
  claudeInputTokens: 0,
  claudeOutputTokens: 0,
  geminiInputTokens: 0,
  geminiOutputTokens: 0,
  callCount: 0,
};

// ── Cost calculation ──

function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens?: number,
  cacheWriteTokens?: number,
): number {
  const rates = COST_RATES[model] ?? DEFAULT_RATES;
  let cost = (inputTokens / 1_000_000) * rates.input + (outputTokens / 1_000_000) * rates.output;
  if (cacheReadTokens && rates.cacheRead != null) {
    cost += (cacheReadTokens / 1_000_000) * rates.cacheRead;
  }
  if (cacheWriteTokens && rates.cacheWrite != null) {
    cost += (cacheWriteTokens / 1_000_000) * rates.cacheWrite;
  }
  return cost;
}

// ── Format helpers ──

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function formatCost(n: number): string {
  if (n >= 10) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(3)}`;
  if (n > 0) return `$${n.toFixed(4)}`;
  return '$0.00';
}

// ── Hook ──

export type RecordUsageFn = (entry: Omit<TokenUsageEntry, 'estimatedCost' | 'timestamp'>) => void;

const SAVE_DEBOUNCE_MS = 500;

export function useTokenUsage(storage?: StorageBackend, initialTotals?: TokenUsageTotals) {
  const entriesRef = useRef<TokenUsageEntry[]>([]);
  const [totals, setTotals] = useState<TokenUsageTotals>(initialTotals ?? EMPTY_TOTALS);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestTotalsRef = useRef(totals);

  // Keep ref in sync
  useEffect(() => {
    latestTotalsRef.current = totals;
  }, [totals]);

  // Debounced save to storage
  const scheduleSave = useCallback(() => {
    if (!storage?.isReady()) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      storage
        .saveTokenUsage(latestTotalsRef.current as unknown as Record<string, unknown>)
        .catch((err) => log.warn('Failed to save:', err));
    }, SAVE_DEBOUNCE_MS);
  }, [storage]);

  const recordUsage: RecordUsageFn = useCallback(
    (raw) => {
      log.debug(
        'recordUsage called:',
        raw.provider,
        raw.model,
        'in:',
        raw.inputTokens,
        'out:',
        raw.outputTokens,
      );
      const cost = calculateCost(
        raw.model,
        raw.inputTokens,
        raw.outputTokens,
        raw.cacheReadTokens,
        raw.cacheWriteTokens,
      );
      const entry: TokenUsageEntry = {
        ...raw,
        estimatedCost: cost,
        timestamp: Date.now(),
      };
      entriesRef.current.push(entry);

      setTotals((prev) => {
        const next = {
          totalInputTokens: prev.totalInputTokens + entry.inputTokens,
          totalOutputTokens: prev.totalOutputTokens + entry.outputTokens,
          totalCacheReadTokens: prev.totalCacheReadTokens + (entry.cacheReadTokens ?? 0),
          totalCost: prev.totalCost + cost,
          claudeCost: entry.provider === 'claude' ? prev.claudeCost + cost : prev.claudeCost,
          geminiCost: entry.provider === 'gemini' ? prev.geminiCost + cost : prev.geminiCost,
          claudeInputTokens:
            entry.provider === 'claude' ? prev.claudeInputTokens + entry.inputTokens : prev.claudeInputTokens,
          claudeOutputTokens:
            entry.provider === 'claude' ? prev.claudeOutputTokens + entry.outputTokens : prev.claudeOutputTokens,
          geminiInputTokens:
            entry.provider === 'gemini' ? prev.geminiInputTokens + entry.inputTokens : prev.geminiInputTokens,
          geminiOutputTokens:
            entry.provider === 'gemini' ? prev.geminiOutputTokens + entry.outputTokens : prev.geminiOutputTokens,
          callCount: prev.callCount + 1,
        };
        return next;
      });
      scheduleSave();
    },
    [scheduleSave],
  );

  const resetUsage = useCallback(() => {
    entriesRef.current = [];
    setTotals(EMPTY_TOTALS);
    // Save reset immediately
    if (storage?.isReady()) {
      storage
        .saveTokenUsage(EMPTY_TOTALS as unknown as Record<string, unknown>)
        .catch((err) => log.warn('Failed to save reset:', err));
    }
  }, [storage]);

  return { totals, recordUsage, resetUsage };
}
