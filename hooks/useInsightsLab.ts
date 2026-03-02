import { useState, useCallback, useRef, useMemo } from 'react';
import { useNuggetContext } from '../context/NuggetContext';
import { ChatMessage, DetailLevel, DocChangeEvent, isCoverLevel } from '../types';
import { callClaude } from '../utils/ai';
import { RecordUsageFn } from './useTokenUsage';
import { buildInsightsSystemPrompt, buildCardContentInstruction } from '../utils/prompts/insightsLab';
import { buildCoverContentInstruction } from '../utils/prompts/coverGeneration';
import { computeDocumentHash } from '../utils/documentHash';
import { computeMessageBudget, pruneMessages } from '../utils/tokenEstimation';
import { buildTocSystemPrompt } from '../utils/pdfBookmarks';
import { buildQualityWarningsBlock } from '../utils/prompts/qualityCheck';

/**
 * Chat state management + Claude API integration for the Insights Lab workflow.
 * Handles regular chat messages and structured card content generation.
 *
 * Uses prompt caching to avoid re-processing document context on every message:
 * - System blocks: INSIGHTS_SYSTEM_PROMPT + document context (cached)
 * - Messages: proper multi-turn conversation (incrementally cached)
 */
export function useInsightsLab(recordUsage?: RecordUsageFn) {
  const { selectedNugget, appendNuggetMessage, setNuggets, selectedNuggetId } = useNuggetContext();
  const [isLoading, setIsLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  /**
   * Resolve the document contents for the active insights nugget.
   * Documents are owned directly by the nugget (no shared library lookup).
   */
  const resolveDocumentContext = useCallback((): Array<{
    name: string;
    content: string;
    fileId?: string;
    sourceType?: string;
    bookmarks?: import('../types').BookmarkNode[];
  }> => {
    if (!selectedNugget || selectedNugget.type !== 'insights') return [];
    return selectedNugget.documents
      .filter((doc) => (doc.content || doc.fileId) && doc.enabled !== false)
      .map((doc) => ({
        name: doc.name,
        content: doc.content || '',
        fileId: doc.fileId,
        sourceType: doc.sourceType,
        bookmarks: doc.bookmarks,
      }));
  }, [selectedNugget]);

  /**
   * Send a message to Claude. Can be a regular chat message or a card content request.
   *
   * Prompt structure with caching:
   *   System: [
   *     { text: INSIGHTS_SYSTEM_PROMPT },
   *     { text: "Documents:\n...", cache: true }     ← CACHED (stable within conversation)
   *   ]
   *   Messages: [
   *     { role: "user", content: "msg 1" },
   *     { role: "assistant", content: "resp 1" },
   *     ...
   *     { role: "user", content: "new msg" }          ← cache breakpoint (auto-added by callClaude)
   *   ]
   */
  const sendMessage = useCallback(
    async (
      text: string,
      isCardRequest: boolean = false,
      detailLevel?: DetailLevel,
      messagesOverride?: ChatMessage[],
    ) => {
      if (!selectedNugget || selectedNugget.type !== 'insights' || !text.trim()) return;

      const resolvedDocs = resolveDocumentContext();
      // Use explicit override when caller needs to bypass stale closure
      // (e.g. handleDocChangeContinue injects system msg before React re-renders)
      const history = messagesOverride ?? selectedNugget.messages ?? [];

      // Create user message
      const userMessage: ChatMessage = {
        id: Math.random().toString(36).substr(2, 9),
        role: 'user',
        content: text.trim(),
        timestamp: Date.now(),
      };

      // Add user message to nugget immediately
      appendNuggetMessage(userMessage);

      setIsLoading(true);
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        // ── Split documents: docs with fileId go via Files API only; the rest go inline ──
        const fileApiDocs = resolvedDocs.filter((d) => d.fileId);
        const inlineDocs = resolvedDocs.filter((d) => !d.fileId && d.content);

        // Build system blocks — only inline docs (no fileId) go here to avoid double-sending
        const systemBlocks: Array<{ text: string; cache: boolean }> = [
          { text: buildInsightsSystemPrompt(selectedNugget?.subject), cache: false },
        ];
        if (inlineDocs.length > 0) {
          const docContext = inlineDocs
            .map((d) => `--- Document: ${d.name} ---\n${d.content}\n--- End Document ---`)
            .join('\n\n');
          systemBlocks.push({ text: `Current documents:\n\n${docContext}`, cache: true });
        }
        // Inject quality warnings (if dismissed red report exists)
        const qualityWarnings = buildQualityWarningsBlock(selectedNugget?.qualityReport);
        if (qualityWarnings) {
          systemBlocks.push({ text: qualityWarnings, cache: false });
        }

        if (isCardRequest && detailLevel) {
          if (isCoverLevel(detailLevel)) {
            systemBlocks.push({ text: buildCoverContentInstruction(detailLevel), cache: false });
          } else {
            systemBlocks.push({ text: buildCardContentInstruction(detailLevel), cache: false });
          }
        }

        // Token budget scaled to detail level to prevent over-generation
        let maxTokens = 8192;
        if (isCardRequest) {
          if (detailLevel === 'TitleCard') maxTokens = 150;
          else if (detailLevel === 'TakeawayCard') maxTokens = 350;
          else if (detailLevel === 'Executive') maxTokens = 300;
          else if (detailLevel === 'Standard') maxTokens = 600;
          else maxTokens = 1200; // Detailed
        }

        // ── Pre-flight budget check ──
        const messageBudget = computeMessageBudget(systemBlocks, maxTokens);
        if (messageBudget <= 0) {
          const errorMessage: ChatMessage = {
            id: Math.random().toString(36).substr(2, 9),
            role: 'assistant',
            content:
              'Your documents are too large to fit in the context window. Try disabling some documents or removing large ones to free up space.',
            timestamp: Date.now(),
          };
          appendNuggetMessage(errorMessage);
          return;
        }

        // ── Build multi-turn messages with pruning ──
        const { claudeMessages, dropped } = pruneMessages(history, text.trim(), messageBudget);

        if (dropped > 0) {
          console.debug(
            `[InsightsLab] Pruned ${dropped} messages to fit context window (budget: ${messageBudget} tokens)`,
          );
        }

        // ── Inject bookmark-based TOC into system prompt for native PDFs ──
        for (const d of fileApiDocs) {
          if (d.sourceType === 'native-pdf' && d.bookmarks?.length) {
            const tocPrompt = buildTocSystemPrompt(d.bookmarks, d.name);
            if (tocPrompt) systemBlocks.push({ text: tocPrompt, cache: true });
          }
        }

        // ── Prepend Files API document blocks to the first user message ──
        if (fileApiDocs.length > 0) {
          const docBlocks: Array<{ type: string; source: { type: string; file_id: string }; title: string }> =
            fileApiDocs.map((d) => ({
              type: 'document',
              source: { type: 'file', file_id: d.fileId! },
              title: d.name,
            }));

          // Inject doc blocks into the first user message
          if (claudeMessages.length > 0 && claudeMessages[0].role === 'user') {
            const firstMsg = claudeMessages[0];
            const existingBlocks =
              typeof firstMsg.content === 'string' ? [{ type: 'text', text: firstMsg.content }] : [...firstMsg.content];
            claudeMessages[0] = { role: 'user', content: [...docBlocks, ...existingBlocks] as any };
          } else {
            // Edge case: no user message first — prepend a document reference message
            claudeMessages.unshift({
              role: 'user',
              content: [...docBlocks, { type: 'text', text: 'Please analyze the documents provided above.' }] as any,
            });
          }
        }

        const { text: responseText, usage: claudeUsage } = await callClaude('', {
          systemBlocks,
          messages: claudeMessages,
          maxTokens,
          signal: controller.signal,
        });

        recordUsage?.({
          provider: 'claude',
          model: 'claude-sonnet-4-6',
          inputTokens: claudeUsage?.input_tokens ?? 0,
          outputTokens: claudeUsage?.output_tokens ?? 0,
          cacheReadTokens: claudeUsage?.cache_read_input_tokens ?? 0,
          cacheWriteTokens: claudeUsage?.cache_creation_input_tokens ?? 0,
        });

        // Create assistant message
        const assistantMessage: ChatMessage = {
          id: Math.random().toString(36).substr(2, 9),
          role: 'assistant',
          content: responseText,
          timestamp: Date.now(),
          isCardContent: isCardRequest,
          detailLevel: isCardRequest ? detailLevel : undefined,
        };

        // Add assistant message to nugget
        appendNuggetMessage(assistantMessage);

        // Update lastDocHash so we know the state of docs at this point
        const currentHash = computeDocumentHash(selectedNugget.documents);
        setNuggets((prev) => prev.map((n) => (n.id === selectedNugget.id ? { ...n, lastDocHash: currentHash } : n)));
      } catch (err: any) {
        // Silently ignore aborted requests
        if (err.name === 'AbortError') return;

        console.error('Insights lab error:', err);

        // Detect token overflow for user-friendly message
        const isOverflow =
          err.message?.includes('prompt is too long') ||
          (err.message?.includes('too long') && err.message?.includes('token'));

        const errorContent = isOverflow
          ? 'The conversation and documents together exceed the maximum context size. Try one of the following:\n' +
            '- **Clear the chat** to start a fresh conversation\n' +
            '- **Disable** some documents in the document list\n' +
            '- **Remove** large documents that are not needed for this question'
          : `Error: ${err.message || 'Failed to get response from Claude. Please try again.'}`;

        const errorMessage: ChatMessage = {
          id: Math.random().toString(36).substr(2, 9),
          role: 'assistant',
          content: errorContent,
          timestamp: Date.now(),
        };

        appendNuggetMessage(errorMessage);
      } finally {
        abortRef.current = null;
        setIsLoading(false);
      }
    },
    [selectedNugget, resolveDocumentContext, appendNuggetMessage, recordUsage, setNuggets],
  );

  /**
   * Abort the in-flight Claude request.
   */
  const stopResponse = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsLoading(false);
  }, []);

  /**
   * Clear all messages from the active insights nugget.
   * Also advances the doc change sync index so the fresh chat starts clean.
   */
  const clearMessages = useCallback(() => {
    if (!selectedNuggetId) return;
    setNuggets((prev) =>
      prev.map((n) => {
        if (n.id !== selectedNuggetId || n.type !== 'insights') return n;
        return {
          ...n,
          messages: [],
          lastDocChangeSyncIndex: (n.docChangeLog || []).length,
          lastModifiedAt: Date.now(),
        };
      }),
    );
  }, [selectedNuggetId, setNuggets]);

  // ── Document change detection ──

  /** Unseen document changes since last sync to chat agent */
  const pendingDocChanges: DocChangeEvent[] = useMemo(() => {
    if (!selectedNugget || selectedNugget.type !== 'insights') return [];
    const log = selectedNugget.docChangeLog || [];
    const syncIdx = selectedNugget.lastDocChangeSyncIndex ?? 0;
    return log.slice(syncIdx);
  }, [selectedNugget]);

  /** Whether the chat has any messages (i.e. agent was already informed of some document state) */
  const hasConversation = (selectedNugget?.messages?.length ?? 0) > 0;

  /**
   * Build a human-readable summary of document changes for the system message.
   */
  const buildChangeSummary = useCallback((changes: DocChangeEvent[]): string => {
    // Group events by document (using docId), tracking latest name per doc
    const docMap = new Map<string, { name: string; events: string[] }>();
    const docOrder: string[] = [];
    for (const e of changes) {
      let entry = docMap.get(e.docId);
      if (!entry) {
        entry = { name: e.docName, events: [] };
        docMap.set(e.docId, entry);
        docOrder.push(e.docId);
      }
      switch (e.type) {
        case 'added':
          entry.events.push('Added');
          break;
        case 'removed':
          entry.events.push('Removed');
          break;
        case 'renamed':
          entry.events.push(`Renamed from "${e.oldName}"`);
          entry.name = e.docName;
          break;
        case 'enabled':
          entry.events.push('Enabled (included in context)');
          break;
        case 'disabled':
          entry.events.push('Disabled (excluded from context)');
          break;
        case 'updated':
          entry.events.push('Content updated');
          break;
        case 'toc_updated':
          entry.events.push('Table of Contents updated');
          break;
        default:
          entry.events.push('Changed');
          break;
      }
    }
    const sections = docOrder.map((id) => {
      const { name, events } = docMap.get(id)!;
      return `**${name}**\n${events.map((ev) => `  - ${ev}`).join('\n')}`;
    });
    return `[Document Update] The following changes were made to the document set since your last update:\n\n${sections.join('\n\n')}\n\nThe system context now reflects the current document set. Base all subsequent answers on the updated documents.`;
  }, []);

  /**
   * Continue with pending changes: inject a system message summarizing changes,
   * then send the user's message.
   */
  const handleDocChangeContinue = useCallback(
    async (text: string, isCardRequest: boolean = false, detailLevel?: DetailLevel) => {
      if (!selectedNugget || selectedNugget.type !== 'insights') return;

      const changes = pendingDocChanges;
      if (changes.length === 0) {
        // No changes — just send normally
        await sendMessage(text, isCardRequest, detailLevel);
        return;
      }

      // Inject a system message into the nugget's message history
      const systemMsg: ChatMessage = {
        id: Math.random().toString(36).substr(2, 9),
        role: 'system',
        content: buildChangeSummary(changes),
        timestamp: Date.now(),
      };

      // Add system message to nugget + advance sync index
      appendNuggetMessage(systemMsg);

      // Advance the sync index
      const newSyncIdx = (selectedNugget.docChangeLog || []).length;
      setNuggets((prev) =>
        prev.map((n) => (n.id === selectedNugget.id ? { ...n, lastDocChangeSyncIndex: newSyncIdx } : n)),
      );

      // Build the updated messages array including the system message
      // (because React state won't have updated yet for the sendMessage closure)
      const updatedMessages = [...(selectedNugget.messages || []), systemMsg];

      // Now send the user message with the updated history
      await sendMessage(text, isCardRequest, detailLevel, updatedMessages);
    },
    [selectedNugget, pendingDocChanges, sendMessage, buildChangeSummary, appendNuggetMessage, setNuggets],
  );

  /**
   * Start fresh: clear all messages and advance sync index, ready for new conversation.
   */
  const handleDocChangeStartFresh = useCallback(() => {
    clearMessages();
  }, [clearMessages]);

  return {
    messages: selectedNugget?.messages || [],
    isLoading,
    sendMessage,
    stopResponse,
    clearMessages,
    pendingDocChanges,
    hasConversation,
    handleDocChangeContinue,
    handleDocChangeStartFresh,
  };
}
