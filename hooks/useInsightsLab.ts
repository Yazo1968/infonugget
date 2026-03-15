import { useState, useCallback, useMemo } from 'react';
import { useNuggetContext } from '../context/NuggetContext';
import { ChatMessage, DetailLevel, DocChangeEvent } from '../types';
import { CLAUDE_MODEL } from '../utils/constants';
import { RecordUsageFn } from './useTokenUsage';
import { useAbortController } from './useAbortController';
import { computeDocumentHash } from '../utils/documentHash';
import { resolveEnabledDocs } from '../utils/documentResolution';
import { chatMessageApi } from '../utils/api';
import { createLogger } from '../utils/logger';

const log = createLogger('InsightsLab');

/** Threshold in estimated chars before triggering compaction. ~30k chars ≈ 7500 tokens. */
const COMPACTION_CHAR_THRESHOLD = 30_000;
/** Keep the most recent N messages after compaction (not compacted). */
const COMPACTION_KEEP_RECENT = 6;

/**
 * Chat state management + Claude API integration for the Insights Lab workflow.
 * Handles regular chat messages and structured card content generation.
 *
 * Uses prompt caching to avoid re-processing document context on every message:
 * - System blocks: INSIGHTS_SYSTEM_PROMPT + document context (cached)
 * - Messages: proper multi-turn conversation (incrementally cached)
 */
export function useInsightsLab(recordUsage?: RecordUsageFn) {
  const { selectedNugget, appendNuggetMessage, setNuggets, selectedNuggetId, createLogCheckpoint } = useNuggetContext();
  const [isLoading, setIsLoading] = useState(false);
  const { create: createAbort, abort: abortOp, clear: clearAbort, isAbortError } = useAbortController();

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
    return resolveEnabledDocs(selectedNugget.documents)
      .map((doc) => ({
        name: doc.name,
        content: doc.content || '',
        fileId: doc.fileId,
        sourceType: doc.sourceType,
        bookmarks: doc.bookmarks,
      }));
  }, [selectedNugget]);

  /**
   * Compact conversation history when it exceeds the threshold.
   * Sends history to the server for summarization, replaces old messages
   * with a single system message containing the structured summary.
   * Returns the updated messages array for use in the next send call.
   */
  const compactHistory = useCallback(
    async (messages: ChatMessage[], signal?: AbortSignal): Promise<ChatMessage[]> => {
      const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
      if (totalChars < COMPACTION_CHAR_THRESHOLD || messages.length <= COMPACTION_KEEP_RECENT + 2) {
        return messages;
      }

      log.debug(`Compacting chat: ${messages.length} messages, ~${totalChars} chars`);

      const messagesToCompact = messages.slice(0, -COMPACTION_KEEP_RECENT);
      const recentMessages = messages.slice(-COMPACTION_KEEP_RECENT);

      try {
        const response = await chatMessageApi({
          action: 'compact',
          conversationHistory: messagesToCompact.map((m) => ({
            role: m.role,
            content: m.content,
            isCardContent: m.isCardContent,
          })),
          documents: [],
        }, signal);

        recordUsage?.({
          provider: 'claude',
          model: CLAUDE_MODEL,
          inputTokens: response.usage.inputTokens,
          outputTokens: response.usage.outputTokens,
          cacheReadTokens: response.usage.cacheReadTokens,
          cacheWriteTokens: response.usage.cacheWriteTokens,
        });

        const summaryMessage: ChatMessage = {
          id: Math.random().toString(36).substr(2, 9),
          role: 'system',
          content: `[Conversation Summary]\n\n${response.responseText}`,
          timestamp: Date.now(),
        };

        const compactedMessages = [summaryMessage, ...recentMessages];

        // Persist the compacted messages to the nugget
        setNuggets((prev) =>
          prev.map((n) =>
            n.id === selectedNuggetId ? { ...n, messages: compactedMessages, lastModifiedAt: Date.now() } : n,
          ),
        );

        log.debug(`Compacted: ${messagesToCompact.length} messages → summary + ${recentMessages.length} recent`);
        return compactedMessages;
      } catch (err: any) {
        log.warn('Compaction failed, continuing with full history:', err.message);
        return messages;
      }
    },
    [selectedNuggetId, setNuggets, recordUsage],
  );

  /**
   * Send a message via the chat-message Edge Function.
   * All prompt building, token budgeting, and message pruning happen server-side.
   * Automatically compacts history when it exceeds the threshold.
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
      let history = messagesOverride ?? selectedNugget.messages ?? [];

      // Compact if history is large
      history = await compactHistory(history);

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
      const controller = createAbort();

      try {
        const response = await chatMessageApi({
          action: 'send_message',
          userText: text.trim(),
          isCardRequest,
          detailLevel,
          conversationHistory: history.map((m) => ({
            role: m.role,
            content: m.content,
            isCardContent: m.isCardContent,
          })),
          domain: selectedNugget.domain,
          qualityReport: selectedNugget.dqafReport ?? selectedNugget.qualityReport,
          documents: resolvedDocs,
        }, controller.signal);

        // Handle budget exceeded (server returns a friendly message)
        if (response.budgetExceeded) {
          const errorMessage: ChatMessage = {
            id: Math.random().toString(36).substr(2, 9),
            role: 'assistant',
            content: response.responseText,
            timestamp: Date.now(),
          };
          appendNuggetMessage(errorMessage);
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

        // Sanitize prohibited characters when this is card content
        let responseText = response.responseText;
        if (isCardRequest) {
          responseText = responseText
            .replace(/[\u2014\u2013]/g, '-')   // em dash, en dash -> hyphen
            .replace(/\u2192/g, '->')           // arrow -> text arrow
            .replace(/[\u2713\u2714\u2717\u2718]/g, '') // check/cross marks
            .replace(/\*+/g, '')                // strip asterisks
            .replace(/~/g, '')                  // strip tildes
            .replace(/^>\s?/gm, '');            // strip blockquote markers
        }

        // Create assistant message
        const assistantMessage: ChatMessage = {
          id: Math.random().toString(36).substr(2, 9),
          role: 'assistant',
          content: responseText,
          timestamp: Date.now(),
          isCardContent: isCardRequest,
          detailLevel: isCardRequest ? detailLevel : undefined,
        };

        appendNuggetMessage(assistantMessage);

        // Update lastDocHash so we know the state of docs at this point
        const currentHash = computeDocumentHash(selectedNugget.documents);
        setNuggets((prev) => prev.map((n) => (n.id === selectedNugget.id ? { ...n, lastDocHash: currentHash } : n)));
      } catch (err: any) {
        if (isAbortError(err)) return;

        log.error('Insights lab error:', err);

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
        clearAbort();
        setIsLoading(false);
      }
    },
    [selectedNugget, resolveDocumentContext, appendNuggetMessage, recordUsage, setNuggets, compactHistory],
  );

  /**
   * Abort the in-flight Claude request.
   */
  const stopResponse = useCallback(() => {
    abortOp();
    setIsLoading(false);
  }, [abortOp]);

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
          lastDocChangeSyncSeq: n.sourcesLogStats?.logsCreated ?? (n.docChangeLog || []).length,
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
    const syncSeq = selectedNugget.lastDocChangeSyncSeq ?? 0;
    return log.filter((e) => e.seq > syncSeq);
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
        case 'updated': {
          let desc = 'Content updated';
          if (e.magnitude) {
            const charDelta = e.magnitude.charCountAfter - e.magnitude.charCountBefore;
            const charLabel = charDelta >= 0 ? `+${charDelta}` : `${charDelta}`;
            const headingDelta = e.magnitude.headingCountAfter - e.magnitude.headingCountBefore;
            const parts: string[] = [`${charLabel} chars`];
            if (headingDelta !== 0) parts.push(`${headingDelta >= 0 ? '+' : ''}${headingDelta} headings`);
            if (e.magnitude.headingTextChanged) parts.push('heading text changed');
            desc += ` (${parts.join(', ')})`;
          }
          entry.events.push(desc);
          break;
        }
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

      // Create a Sources Log checkpoint — captures pending changes at continuation point
      createLogCheckpoint('chat_continued');

      // Inject a system message into the nugget's message history
      const systemMsg: ChatMessage = {
        id: Math.random().toString(36).substr(2, 9),
        role: 'system',
        content: buildChangeSummary(changes),
        timestamp: Date.now(),
      };

      // Add system message to nugget + advance sync seq
      appendNuggetMessage(systemMsg);

      // Advance the sync seq to the highest seq among consumed events
      const maxSeq = changes.reduce((max, e) => Math.max(max, e.seq), 0);
      setNuggets((prev) =>
        prev.map((n) => (n.id === selectedNugget.id ? { ...n, lastDocChangeSyncSeq: maxSeq } : n)),
      );

      // Build the updated messages array including the system message
      // (because React state won't have updated yet for the sendMessage closure)
      const updatedMessages = [...(selectedNugget.messages || []), systemMsg];

      // Now send the user message with the updated history
      await sendMessage(text, isCardRequest, detailLevel, updatedMessages);
    },
    [selectedNugget, pendingDocChanges, sendMessage, buildChangeSummary, appendNuggetMessage, setNuggets, createLogCheckpoint],
  );

  /**
   * Start fresh: clear all messages and advance sync index, ready for new conversation.
   */
  const handleDocChangeStartFresh = useCallback(() => {
    clearMessages();
  }, [clearMessages]);

  /**
   * Lightweight initial chat call via chat-message Edge Function.
   * Generates document briefs + exploration suggestions.
   * Only the assistant response is persisted — no synthetic user message saved.
   */
  const initiateChat = useCallback(async () => {
    if (!selectedNugget || selectedNugget.type !== 'insights') return;
    if ((selectedNugget.messages?.length ?? 0) > 0 || isLoading) return;

    const resolvedDocs = resolveDocumentContext();
    if (resolvedDocs.length === 0) return;

    // Create a Sources Log checkpoint — captures document state at chat start
    createLogCheckpoint('chat_initiated');

    setIsLoading(true);
    const controller = createAbort();

    try {
      const response = await chatMessageApi({
        action: 'initiate_chat',
        domain: selectedNugget.domain,
        documents: resolvedDocs,
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
        content: response.responseText,
        timestamp: Date.now(),
      };

      appendNuggetMessage(assistantMessage);

      // Update lastDocHash + advance doc-change sync (initiate chat has full doc context)
      const currentHash = computeDocumentHash(selectedNugget.documents);
      const docLog = selectedNugget.docChangeLog || [];
      const maxSyncSeq = docLog.length > 0 ? Math.max(...docLog.map((e) => e.seq)) : 0;
      setNuggets((prev) =>
        prev.map((n) =>
          n.id === selectedNugget.id ? { ...n, lastDocHash: currentHash, lastDocChangeSyncSeq: maxSyncSeq } : n,
        ),
      );
    } catch (err: any) {
      if (isAbortError(err)) return;
      log.error('Initiate chat error:', err);

      const errorMessage: ChatMessage = {
        id: Math.random().toString(36).substr(2, 9),
        role: 'assistant',
        content: `Error: ${err.message || 'Failed to initiate chat. Please try again.'}`,
        timestamp: Date.now(),
      };
      appendNuggetMessage(errorMessage);
    } finally {
      clearAbort();
      setIsLoading(false);
    }
  }, [selectedNugget, isLoading, resolveDocumentContext, appendNuggetMessage, recordUsage, setNuggets, createAbort, clearAbort, isAbortError, createLogCheckpoint]);

  return {
    messages: selectedNugget?.messages || [],
    isLoading,
    sendMessage,
    stopResponse,
    clearMessages,
    pendingDocChanges,
    hasConversation,
    initiateChat,
    handleDocChangeContinue,
    handleDocChangeStartFresh,
  };
}
