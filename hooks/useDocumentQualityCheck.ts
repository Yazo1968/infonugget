import { useState, useCallback, useMemo } from 'react';
import { Nugget, QualityReport, TopicCluster, QualityConflict } from '../types';
import { callClaude } from '../utils/ai';
import { buildQualityCheckPrompt } from '../utils/prompts/qualityCheck';
import { buildTocSystemPrompt } from '../utils/pdfBookmarks';
import { RecordUsageFn } from './useTokenUsage';

// ─────────────────────────────────────────────────────────────────
// Document Quality Check Hook
// ─────────────────────────────────────────────────────────────────
// Manages the quality check lifecycle: amber detection, AI analysis,
// report storage, and dismiss/proceed workflow.
// ─────────────────────────────────────────────────────────────────

export type QualityStatus = 'green' | 'amber' | 'red' | null;

interface UseDocumentQualityCheckResult {
  /** The full quality report (if any) */
  qualityReport: QualityReport | undefined;
  /** Computed 3-state: green | amber | red | null (no docs) */
  effectiveStatus: QualityStatus;
  /** Whether an AI check is currently running */
  isChecking: boolean;
  /** Error message from the last failed check (cleared on next run) */
  checkError: string | null;
  /** Trigger the AI quality check */
  runQualityCheck: () => Promise<void>;
  /** Dismiss the report warnings and proceed */
  dismissReport: () => void;
}

export function useDocumentQualityCheck(
  selectedNugget: Nugget | undefined,
  updateNugget: (nuggetId: string, updater: (n: Nugget) => Nugget) => void,
  recordUsage?: RecordUsageFn,
): UseDocumentQualityCheckResult {
  const [isChecking, setIsChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);

  const qualityReport = selectedNugget?.qualityReport;

  // Compute effective status from report + docChangeLog
  const effectiveStatus = useMemo((): QualityStatus => {
    if (!selectedNugget) return null;

    const enabledDocs = selectedNugget.documents.filter((d) => d.enabled !== false && (d.content || d.fileId));
    if (enabledDocs.length === 0) return null;
    if (enabledDocs.length === 1) return 'green';

    if (!qualityReport) return 'amber'; // never checked

    const currentLogLength = selectedNugget.docChangeLog?.length ?? 0;
    const lastCheckIndex = qualityReport.docChangeLogIndexAtCheck ?? 0;
    if (currentLogLength > lastCheckIndex) return 'amber'; // docs changed since last check

    return qualityReport.status;
  }, [selectedNugget, qualityReport]);

  const runQualityCheck = useCallback(async () => {
    if (!selectedNugget) return;

    const enabledDocs = selectedNugget.documents.filter(
      (d) => d.enabled !== false && (d.content || d.fileId),
    );

    // Single doc or no docs → auto-green
    if (enabledDocs.length <= 1) {
      const report: QualityReport = {
        status: 'green',
        clusters: enabledDocs.length === 1
          ? [{
              subject: enabledDocs[0].name,
              description: 'Single document — no cross-document analysis needed.',
              documentIds: [enabledDocs[0].id],
              isolated: false,
            }]
          : [],
        conflicts: [],
        hasUnrelatedDocs: false,
        dismissed: false,
        lastCheckTimestamp: Date.now(),
        docChangeLogIndexAtCheck: selectedNugget.docChangeLog?.length ?? 0,
      };
      updateNugget(selectedNugget.id, (n) => ({ ...n, qualityReport: report }));
      return;
    }

    setIsChecking(true);
    setCheckError(null);

    try {
      // Build system blocks
      const systemPrompt = buildQualityCheckPrompt(enabledDocs.map((d) => d.name));

      // Always use truncated text summaries — never Files API references.
      // Documents this large (4M+ tokens) exceed the 200K context window regardless
      // of delivery method. The quality check only needs topic-level understanding.
      const MAX_CHARS_PER_DOC = 12_000;

      const systemBlocks: Array<{ text: string; cache: boolean }> = [
        { text: systemPrompt, cache: false },
      ];

      const docSections: string[] = [];
      for (const d of enabledDocs) {
        let excerpt: string | null = null;

        if (d.content) {
          excerpt = d.content.length > MAX_CHARS_PER_DOC
            ? d.content.slice(0, MAX_CHARS_PER_DOC) + '\n\n[... document truncated for analysis ...]'
            : d.content;
        } else if (d.sourceType === 'native-pdf' && d.bookmarks?.length) {
          excerpt = buildTocSystemPrompt(d.bookmarks, d.name);
        }

        if (excerpt) {
          docSections.push(`--- Document: ${d.name} ---\n${excerpt}\n--- End Document ---`);
        } else {
          docSections.push(`--- Document: ${d.name} ---\n[No content preview available]\n--- End Document ---`);
        }
      }

      if (docSections.length > 0) {
        systemBlocks.push({ text: `Documents:\n\n${docSections.join('\n\n')}`, cache: true });
      }

      // Build messages — simple text request, no Files API references
      const messages = [{
        role: 'user' as const,
        content: 'Analyze the documents provided and return the quality report JSON as specified in your instructions.',
      }];

      const { text, usage } = await callClaude('', {
        systemBlocks,
        messages,
        maxTokens: 4096,
      });

      recordUsage?.({
        provider: 'claude',
        model: 'claude-sonnet-4-6',
        inputTokens: usage?.input_tokens ?? 0,
        outputTokens: usage?.output_tokens ?? 0,
        cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
        cacheWriteTokens: usage?.cache_creation_input_tokens ?? 0,
      });

      // Parse the JSON response
      const parsed = parseQualityResponse(text, enabledDocs);
      const currentLogLength = selectedNugget.docChangeLog?.length ?? 0;

      const hasIssues = parsed.hasUnrelatedDocs || parsed.conflicts.length > 0;

      const report: QualityReport = {
        status: hasIssues ? 'red' : 'green',
        clusters: parsed.clusters,
        conflicts: parsed.conflicts,
        hasUnrelatedDocs: parsed.hasUnrelatedDocs,
        dismissed: false,
        lastCheckTimestamp: Date.now(),
        docChangeLogIndexAtCheck: currentLogLength,
      };

      updateNugget(selectedNugget.id, (n) => ({ ...n, qualityReport: report }));
    } catch (err) {
      console.error('[QualityCheck] Analysis failed:', err);
      const msg = err instanceof Error ? err.message : String(err);
      setCheckError(msg);
    } finally {
      setIsChecking(false);
    }
  }, [selectedNugget, updateNugget, recordUsage]);

  const dismissReport = useCallback(() => {
    if (!selectedNugget || !qualityReport) return;
    updateNugget(selectedNugget.id, (n) => ({
      ...n,
      qualityReport: n.qualityReport
        ? { ...n.qualityReport, dismissed: true }
        : undefined,
    }));
  }, [selectedNugget, qualityReport, updateNugget]);

  return {
    qualityReport,
    effectiveStatus,
    isChecking,
    checkError,
    runQualityCheck,
    dismissReport,
  };
}

// ─────────────────────────────────────────────────────────────────
// Response Parser
// ─────────────────────────────────────────────────────────────────

interface ParsedQualityResult {
  clusters: TopicCluster[];
  conflicts: QualityConflict[];
  hasUnrelatedDocs: boolean;
}

function parseQualityResponse(
  text: string,
  enabledDocs: Array<{ id: string; name: string }>,
): ParsedQualityResult {
  // Extract JSON from the response — handles fences, preamble text, etc.
  let jsonStr = text.trim();

  // Try extracting from markdown fences first (```json ... ``` or ``` ... ```)
  const fenceMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1].trim();
  } else {
    // Try to find a top-level JSON object anywhere in the text
    const braceStart = jsonStr.indexOf('{');
    if (braceStart > 0) {
      jsonStr = jsonStr.slice(braceStart);
    }
    // Trim trailing text after the last closing brace
    const braceEnd = jsonStr.lastIndexOf('}');
    if (braceEnd >= 0 && braceEnd < jsonStr.length - 1) {
      jsonStr = jsonStr.slice(0, braceEnd + 1);
    }
  }

  const raw = JSON.parse(jsonStr);

  // Build name → id lookup
  const nameToId = new Map<string, string>();
  for (const d of enabledDocs) {
    nameToId.set(d.name.toLowerCase(), d.id);
  }

  const findDocId = (name: string): string => {
    const id = nameToId.get(name.toLowerCase());
    if (id) return id;
    // Fuzzy: try partial match
    for (const [key, val] of nameToId) {
      if (key.includes(name.toLowerCase()) || name.toLowerCase().includes(key)) return val;
    }
    return name; // fallback to name as ID
  };

  // Parse clusters
  const clusters: TopicCluster[] = (raw.clusters || []).map((c: any) => ({
    subject: c.subject || 'Unknown',
    description: c.description || '',
    documentIds: (c.documentNames || []).map((n: string) => findDocId(n)),
    isolated: !!c.isolated,
  }));

  // Parse conflicts
  const conflicts: QualityConflict[] = (raw.conflicts || []).map((c: any) => ({
    description: c.description || '',
    entries: (c.entries || []).map((e: any) => ({
      documentId: findDocId(e.documentName || ''),
      documentName: e.documentName || '',
      claim: e.claim || '',
      location: e.location || '',
    })),
    recommendation: c.recommendation || '',
  }));

  const hasUnrelatedDocs = clusters.some((c) => c.isolated);

  return { clusters, conflicts, hasUnrelatedDocs };
}
