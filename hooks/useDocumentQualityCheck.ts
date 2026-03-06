import { useState, useCallback, useMemo } from 'react';
import { CLAUDE_MODEL } from '../utils/constants';
import { Nugget, DQAFReport } from '../types';
import { documentQualityApi } from '../utils/api';
import { resolveEnabledDocs } from '../utils/documentResolution';
import { useAbortController } from './useAbortController';
import { RecordUsageFn } from './useTokenUsage';
import { createLogger } from '../utils/logger';

const log = createLogger('QualityCheck');

// ─────────────────────────────────────────────────────────────────
// Document Quality Assessment Framework (DQAF) Hook
// ─────────────────────────────────────────────────────────────────
// Manages the DQAF assessment lifecycle:
//   - Engagement purpose validation
//   - Edge Function call (3-stage assessment)
//   - Report storage on nugget
//   - Effective status computation (green/amber/red/stale/null)
// ─────────────────────────────────────────────────────────────────

export type QualityStatus = 'green' | 'amber' | 'red' | 'stale' | null;

interface UseDocumentQualityCheckResult {
  /** The full DQAF report (if any) */
  dqafReport: DQAFReport | undefined;
  /** Computed 5-state: green | amber | red | stale | null (no docs) */
  effectiveStatus: QualityStatus;
  /** Whether an assessment is currently running */
  isChecking: boolean;
  /** Error message from the last failed check (cleared on next run) */
  checkError: string | null;
  /** Trigger the DQAF assessment (requires engagement purpose) */
  runQualityCheck: (engagementPurpose: string) => Promise<void>;
  /** Abort a running assessment */
  abortQualityCheck: () => void;
}

export function useDocumentQualityCheck(
  selectedNugget: Nugget | undefined,
  updateNugget: (nuggetId: string, updater: (n: Nugget) => Nugget) => void,
  recordUsage?: RecordUsageFn,
): UseDocumentQualityCheckResult {
  const [isChecking, setIsChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const { create: createAbort, clear: clearAbort, isAbortError, abort } = useAbortController();

  const dqafReport = selectedNugget?.dqafReport;

  // Compute effective status from report + docChangeLog
  const effectiveStatus = useMemo((): QualityStatus => {
    if (!selectedNugget) return null;

    const enabledDocs = resolveEnabledDocs(selectedNugget.documents);
    if (enabledDocs.length === 0) return null;

    // Check for legacy report (has qualityReport but no dqafReport) → treat as stale
    if (!dqafReport && selectedNugget.qualityReport) return 'stale';

    // Never checked
    if (!dqafReport) return 'stale';

    // Docs changed since last assessment
    const currentMaxSeq = selectedNugget.sourcesLogStats?.rawEventSeq ?? (selectedNugget.docChangeLog?.length ?? 0);
    const lastCheckSeq = dqafReport.docChangeLogSeqAtCheck ?? 0;
    if (currentMaxSeq > lastCheckSeq) return 'stale';

    // Map verdict to status
    switch (dqafReport.overallVerdict) {
      case 'ready': return 'green';
      case 'conditional': return 'amber';
      case 'not_ready': return 'red';
      default: return 'stale';
    }
  }, [selectedNugget, dqafReport]);

  const runQualityCheck = useCallback(async (engagementPurpose: string) => {
    if (!selectedNugget) return;
    if (!engagementPurpose.trim()) {
      setCheckError('An engagement purpose statement is required to run the assessment.');
      return;
    }

    const enabledDocs = resolveEnabledDocs(selectedNugget.documents);
    if (enabledDocs.length === 0) return;

    setIsChecking(true);
    setCheckError(null);

    const controller = createAbort();

    try {
      // Map documents for the API — flatten BookmarkNode[] to flat structure
      const documents = enabledDocs.map((d) => ({
        id: d.id,
        name: d.name,
        fileId: d.fileId,
        content: d.content,
        sourceType: d.sourceType,
        bookmarks: d.bookmarks?.map((b) => ({
          level: b.level,
          text: b.title,
          page: b.page,
          wordCount: b.wordCount,
        })),
      }));

      log.info(`Running DQAF assessment for ${documents.length} document(s)`);

      const response = await documentQualityApi(
        { documents, engagementPurpose: engagementPurpose.trim(), nuggetId: selectedNugget.id },
        controller.signal,
      );

      // Record token usage
      if (response.usage) {
        recordUsage?.({
          provider: 'claude',
          model: CLAUDE_MODEL,
          inputTokens: response.usage.inputTokens ?? 0,
          outputTokens: response.usage.outputTokens ?? 0,
          cacheReadTokens: response.usage.cacheReadTokens ?? 0,
          cacheWriteTokens: response.usage.cacheWriteTokens ?? 0,
        });
      }

      const currentMaxSeq = selectedNugget.sourcesLogStats?.rawEventSeq ?? (selectedNugget.docChangeLog?.length ?? 0);

      // Stamp the report with client-side metadata
      const report: DQAFReport = {
        ...response.report,
        lastCheckTimestamp: Date.now(),
        docChangeLogSeqAtCheck: currentMaxSeq,
        // Map verdict → legacy status for backward compat (FootnoteBar, PanelTabBar)
        status: response.report.overallVerdict === 'ready'
          ? 'green'
          : response.report.overallVerdict === 'conditional'
            ? 'amber'
            : 'red',
      };

      updateNugget(selectedNugget.id, (n) => ({
        ...n,
        dqafReport: report,
        engagementPurpose: engagementPurpose.trim(),
      }));

      log.info(`DQAF assessment complete: verdict=${report.overallVerdict}, docs=${report.documentCountSubmitted}`);
    } catch (err) {
      if (isAbortError(err)) {
        log.info('DQAF assessment aborted by user');
        return;
      }
      log.error('DQAF assessment failed:', err);
      const msg = err instanceof Error ? err.message : String(err);
      setCheckError(msg);
    } finally {
      clearAbort();
      setIsChecking(false);
    }
  }, [selectedNugget, updateNugget, recordUsage, createAbort, clearAbort, isAbortError]);

  const abortQualityCheck = useCallback(() => {
    abort();
    setIsChecking(false);
  }, [abort]);

  return {
    dqafReport,
    effectiveStatus,
    isChecking,
    checkError,
    runQualityCheck,
    abortQualityCheck,
  };
}
