import { useState, useCallback, useMemo } from 'react';
import { useNuggetContext } from '../context/NuggetContext';
import { ChatMessage } from '../types';
import { CLAUDE_MODEL } from '../utils/constants';
import { RecordUsageFn } from './useTokenUsage';
import { useAbortController } from './useAbortController';
import { computeDocumentHash } from '../utils/documentHash';
import { resolveEnabledDocs } from '../utils/documentResolution';
import { chatMessageApi } from '../utils/api';
import { buildGuidedDeckOpeningPrompt } from '../utils/prompts/guidedDeck';
import { createLogger } from '../utils/logger';

const log = createLogger('GuidedDeck');

/**
 * Detect an unfenced deck outline in Claude's response and wrap it.
 *
 * Triggers only when ALL of these are true:
 * - No ```deck-outline fence already exists
 * - 3+ contiguous numbered lines with pipe separators (e.g. "1. Title | Desc | Standard")
 * - At least one line contains a LOD keyword (Executive, Standard, or Detailed)
 *
 * This avoids false positives on partial revisions, numbered lists, or content discussions.
 */
function ensureDeckOutlineFence(content: string): string {
  if (/```deck-outline/i.test(content)) return content;

  const lines = content.split('\n');
  const outlineLinePattern = /^\d+\.\s+.+\|.+/;
  const lodPattern = /\b(Executive|Standard|Detailed)\b/i;

  let bestStart = -1;
  let bestEnd = -1;
  let bestCount = 0;
  let runStart = -1;
  let runCount = 0;
  let runHasLod = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (outlineLinePattern.test(trimmed)) {
      if (runStart === -1) runStart = i;
      runCount++;
      if (lodPattern.test(trimmed)) runHasLod = true;
    } else if (trimmed === '') {
      // Allow blank lines within a run
    } else {
      // Run ended — check if it qualifies
      if (runCount >= 3 && runHasLod && runCount > bestCount) {
        bestStart = runStart;
        bestEnd = i - 1;
        bestCount = runCount;
      }
      runStart = -1;
      runCount = 0;
      runHasLod = false;
    }
  }
  // Check final run
  if (runCount >= 3 && runHasLod && runCount > bestCount) {
    bestStart = runStart;
    bestEnd = lines.length - 1;
  }

  if (bestStart === -1) return content;

  // Trim trailing blank lines from the detected block
  while (bestEnd > bestStart && lines[bestEnd].trim() === '') bestEnd--;

  const before = lines.slice(0, bestStart).join('\n');
  const outline = lines.slice(bestStart, bestEnd + 1).join('\n');
  const after = lines.slice(bestEnd + 1).join('\n');
  const result = [before.trimEnd(), '```deck-outline', outline, '```', after.trimStart()]
    .filter((s) => s.length > 0)
    .join('\n');

  log.debug('Auto-wrapped unfenced deck outline');
  return result;
}

/**
 * Detect unfenced card content in Claude's response and wrap it.
 *
 * Triggers only when ALL of these are true:
 * - No ```deck-content fence already exists
 * - No ```deck-outline fence (outline and content are mutually exclusive per message)
 * - 2+ H1 headings (`# Title`) each followed by at least 3 lines of substantive content
 *
 * This distinguishes full card content from outlines (single-line entries),
 * partial revisions, or regular chat with occasional headings.
 */
function ensureDeckContentFence(content: string): string {
  if (/```deck-content/i.test(content)) return content;
  if (/```deck-outline/i.test(content)) return content;

  const lines = content.split('\n');
  const h1Pattern = /^#\s+\S/;

  // Find H1 positions
  const h1Positions: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (h1Pattern.test(lines[i].trim())) h1Positions.push(i);
  }

  if (h1Positions.length < 2) return content;

  // Check each H1 section has at least 3 lines of substantive content
  let qualifiedSections = 0;
  for (let idx = 0; idx < h1Positions.length; idx++) {
    const sectionStart = h1Positions[idx] + 1;
    const sectionEnd = idx + 1 < h1Positions.length ? h1Positions[idx + 1] : lines.length;
    let contentLines = 0;
    for (let i = sectionStart; i < sectionEnd; i++) {
      if (lines[i].trim().length > 0) contentLines++;
    }
    if (contentLines >= 3) qualifiedSections++;
  }

  if (qualifiedSections < 2) return content;

  // Wrap from first H1 to end of last section
  const blockStart = h1Positions[0];
  let blockEnd = lines.length - 1;
  while (blockEnd > blockStart && lines[blockEnd].trim() === '') blockEnd--;

  const before = lines.slice(0, blockStart).join('\n');
  const cardContent = lines.slice(blockStart, blockEnd + 1).join('\n');
  const after = lines.slice(blockEnd + 1).join('\n');
  const result = [before.trimEnd(), '```deck-content', cardContent, '```', after.trimStart()]
    .filter((s) => s.length > 0)
    .join('\n');

  log.debug('Auto-wrapped unfenced deck content');
  return result;
}

/**
 * Guided Deck conversation hook.
 *
 * Manages a separate deck-planning chat that uses premeditated suggestion chips
 * to guide the user through planning a card deck. Messages are stored on
 * `nugget.deckMessages`, isolated from the regular chat.
 *
 * Document changes force a fresh restart — no "continue" option.
 */
export function useGuidedDeck(recordUsage?: RecordUsageFn) {
  const { selectedNugget, appendNuggetDeckMessage, setNuggets, selectedNuggetId } = useNuggetContext();
  const [isLoading, setIsLoading] = useState(false);
  const { create: createAbort, abort: abortOp, clear: clearAbort, isAbortError } = useAbortController();

  /** Resolve enabled document contents for the active nugget. */
  const resolveDocumentContext = useCallback((): Array<{
    name: string;
    content: string;
    fileId?: string;
    sourceType?: string;
    bookmarks?: import('../types').BookmarkNode[];
  }> => {
    if (!selectedNugget || selectedNugget.type !== 'insights') return [];
    return resolveEnabledDocs(selectedNugget.documents).map((doc) => ({
      name: doc.name,
      content: doc.content || '',
      fileId: doc.fileId,
      sourceType: doc.sourceType,
      bookmarks: doc.bookmarks,
    }));
  }, [selectedNugget]);

  /**
   * Start a guided deck conversation.
   * Clears any previous deck messages, sends the opening prompt,
   * and persists only the assistant response (no synthetic user message).
   */
  const startDeck = useCallback(async () => {
    if (!selectedNugget || selectedNugget.type !== 'insights') return;
    if (isLoading) return;

    const resolvedDocs = resolveDocumentContext();
    if (resolvedDocs.length === 0) return;

    // Clear previous deck messages and store current doc hash
    const currentHash = computeDocumentHash(selectedNugget.documents);
    setNuggets((prev) =>
      prev.map((n) =>
        n.id === selectedNugget.id
          ? { ...n, deckMessages: [], lastDeckDocHash: currentHash, lastModifiedAt: Date.now() }
          : n,
      ),
    );

    const docNames = resolvedDocs.map((d) => d.name);
    const openingPrompt = buildGuidedDeckOpeningPrompt(selectedNugget.subject, docNames);

    setIsLoading(true);
    const controller = createAbort();

    try {
      const response = await chatMessageApi({
        action: 'send_message',
        userText: openingPrompt,
        documents: resolvedDocs,
        subject: selectedNugget.subject,
        qualityReport: selectedNugget.dqafReport ?? selectedNugget.qualityReport,
      }, controller.signal);

      recordUsage?.({
        provider: 'claude',
        model: CLAUDE_MODEL,
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
        cacheReadTokens: response.usage.cacheReadTokens,
        cacheWriteTokens: response.usage.cacheWriteTokens,
      });

      const assistantMessage: ChatMessage = {
        id: Math.random().toString(36).substr(2, 9),
        role: 'assistant',
        content: ensureDeckContentFence(ensureDeckOutlineFence(response.responseText)),
        timestamp: Date.now(),
      };

      appendNuggetDeckMessage(assistantMessage);
    } catch (err: any) {
      if (isAbortError(err)) return;
      log.error('Start deck error:', err);

      const errorMessage: ChatMessage = {
        id: Math.random().toString(36).substr(2, 9),
        role: 'assistant',
        content: `Error: ${err.message || 'Failed to start guided deck. Please try again.'}`,
        timestamp: Date.now(),
      };
      appendNuggetDeckMessage(errorMessage);
    } finally {
      clearAbort();
      setIsLoading(false);
    }
  }, [selectedNugget, isLoading, resolveDocumentContext, appendNuggetDeckMessage, recordUsage, setNuggets, createAbort, clearAbort, isAbortError]);

  /**
   * Send a follow-up message in the deck conversation.
   */
  const sendDeckMessage = useCallback(
    async (text: string) => {
      if (!selectedNugget || selectedNugget.type !== 'insights' || !text.trim()) return;

      const resolvedDocs = resolveDocumentContext();
      const history = selectedNugget.deckMessages ?? [];

      // Reconstruct the opening prompt so Claude retains the Q&A instructions
      // (startDeck doesn't store the user prompt — only the assistant response)
      const docNames = resolvedDocs.map((d) => d.name);
      const openingPrompt = buildGuidedDeckOpeningPrompt(selectedNugget.subject, docNames);

      // Create and persist user message immediately
      const userMessage: ChatMessage = {
        id: Math.random().toString(36).substr(2, 9),
        role: 'user',
        content: text.trim(),
        timestamp: Date.now(),
      };
      appendNuggetDeckMessage(userMessage);

      setIsLoading(true);
      const controller = createAbort();

      try {
        const response = await chatMessageApi({
          action: 'send_message',
          userText: text.trim(),
          conversationHistory: [
            // Always prepend the opening prompt so Claude knows the rules
            { role: 'user' as const, content: openingPrompt },
            ...history.map((m) => ({
              role: m.role,
              content: m.content,
            })),
          ],
          subject: selectedNugget.subject,
          qualityReport: selectedNugget.dqafReport ?? selectedNugget.qualityReport,
          documents: resolvedDocs,
        }, controller.signal);

        if (response.budgetExceeded) {
          const errorMessage: ChatMessage = {
            id: Math.random().toString(36).substr(2, 9),
            role: 'assistant',
            content: response.responseText,
            timestamp: Date.now(),
          };
          appendNuggetDeckMessage(errorMessage);
          return;
        }

        if (response.messagesPruned && response.messagesPruned > 0) {
          log.debug(`Server pruned ${response.messagesPruned} messages to fit context window`);
        }

        recordUsage?.({
          provider: 'claude',
          model: CLAUDE_MODEL,
          inputTokens: response.usage.inputTokens,
          outputTokens: response.usage.outputTokens,
          cacheReadTokens: response.usage.cacheReadTokens,
          cacheWriteTokens: response.usage.cacheWriteTokens,
        });

        const assistantMessage: ChatMessage = {
          id: Math.random().toString(36).substr(2, 9),
          role: 'assistant',
          content: ensureDeckContentFence(ensureDeckOutlineFence(response.responseText)),
          timestamp: Date.now(),
        };

        appendNuggetDeckMessage(assistantMessage);
      } catch (err: any) {
        if (isAbortError(err)) return;
        log.error('Deck message error:', err);

        const isOverflow =
          err.message?.includes('prompt is too long') ||
          (err.message?.includes('too long') && err.message?.includes('token'));

        const errorContent = isOverflow
          ? 'The conversation and documents together exceed the maximum context size. Please clear the deck conversation and start over with fewer documents.'
          : `Error: ${err.message || 'Failed to get response. Please try again.'}`;

        const errorMessage: ChatMessage = {
          id: Math.random().toString(36).substr(2, 9),
          role: 'assistant',
          content: errorContent,
          timestamp: Date.now(),
        };
        appendNuggetDeckMessage(errorMessage);
      } finally {
        clearAbort();
        setIsLoading(false);
      }
    },
    [selectedNugget, resolveDocumentContext, appendNuggetDeckMessage, recordUsage, createAbort, clearAbort, isAbortError],
  );

  /** Clear the deck conversation. */
  const clearDeck = useCallback(() => {
    if (!selectedNuggetId) return;
    setNuggets((prev) =>
      prev.map((n) =>
        n.id === selectedNuggetId
          ? { ...n, deckMessages: [], lastDeckDocHash: undefined, lastModifiedAt: Date.now() }
          : n,
      ),
    );
  }, [selectedNuggetId, setNuggets]);

  /** Abort an in-flight request. */
  const stopDeckResponse = useCallback(() => {
    abortOp();
  }, [abortOp]);

  /** Whether documents have changed since the deck conversation started. */
  const docHashChanged = useMemo(() => {
    if (!selectedNugget) return false;
    const deckMsgs = selectedNugget.deckMessages;
    if (!deckMsgs || deckMsgs.length === 0 || !selectedNugget.lastDeckDocHash) return false;
    const currentHash = computeDocumentHash(selectedNugget.documents);
    return currentHash !== selectedNugget.lastDeckDocHash;
  }, [selectedNugget]);

  return {
    messages: selectedNugget?.deckMessages || [],
    isLoading,
    startDeck,
    sendDeckMessage,
    clearDeck,
    stopDeckResponse,
    docHashChanged,
  };
}
