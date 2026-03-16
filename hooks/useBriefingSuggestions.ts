import { useCallback } from 'react';
import { BriefingSuggestions, UploadedFile } from '../types';
import { RecordUsageFn } from './useTokenUsage';
import { BRIEFING_LIMITS, BRIEFING_SUGGESTION_COUNT } from '../utils/deckShared/constants';
import { parseBriefingMarkdownResponse } from '../utils/deckShared/parsers';
import { chatMessageApi, ChatMessageDocument } from '../utils/api';
import { CLAUDE_MODEL } from '../utils/constants';
import { useAbortController } from './useAbortController';
import { createLogger } from '../utils/logger';

const log = createLogger('BriefingSuggestions');

/**
 * Standalone hook for generating AI briefing suggestions.
 * Extracted from useAutoDeck — uses chatMessageApi (not auto-deck EF).
 */
export function useBriefingSuggestions(recordUsage?: RecordUsageFn) {
  const { create: createAbort, abort: abortOp, clear: clearAbort, isAbortError } = useAbortController();

  const generateBriefingSuggestions = useCallback(
    async (
      domain: string | undefined,
      documents: UploadedFile[],
      totalWordCount: number,
    ): Promise<BriefingSuggestions> => {
      const controller = createAbort();
      try {
        // Map documents to ChatMessageDocument format (fileId enables Files API on server)
        const chatDocs: ChatMessageDocument[] = documents.map((d) => ({
          name: d.name,
          fileId: d.fileId,
          sourceType: d.sourceType,
          ...(d.content ? { content: d.content } : {}),
        }));

        // Build a natural-language prompt that produces structured markdown tables
        const docList = documents.map((d) => `- ${d.name}`).join('\n');
        const domainLine = domain ? `The domain/topic is: "${domain}".` : '';
        const prompt = [
          `I have ${documents.length} document(s) totaling ~${totalWordCount.toLocaleString()} words:`,
          docList,
          '',
          domainLine,
          '',
          `Based on the actual content of these documents, suggest ${BRIEFING_SUGGESTION_COUNT} options for EACH of the following 5 briefing fields for a presentation deck. Each option must have a short label (2–5 words) and a brief description sentence.`,
          '',
          'The 5 fields and their description-sentence word limits:',
          `1. **Objective** — Why are we making this deck? (${BRIEFING_LIMITS.objective.min}–${BRIEFING_LIMITS.objective.max} words per description)`,
          `2. **Audience** — Who will view this deck? (${BRIEFING_LIMITS.audience.min}–${BRIEFING_LIMITS.audience.max} words per description)`,
          `3. **Type** — What kind of deck is this? (${BRIEFING_LIMITS.type.min}–${BRIEFING_LIMITS.type.max} words per description)`,
          `4. **Focus** — What should the deck emphasize? (${BRIEFING_LIMITS.focus.min}–${BRIEFING_LIMITS.focus.max} words per description)`,
          `5. **Tone** — What tone/style should the deck use? (${BRIEFING_LIMITS.tone.min}–${BRIEFING_LIMITS.tone.max} words per description)`,
          '',
          'Format your response as markdown with a ## heading per field, and a table with columns | Label | Brief |',
          'Example:',
          '## 1. Objective',
          '| Label | Brief |',
          '|---|---|',
          '| **Capital Raise** | Secure Series A funding by demonstrating market traction and growth potential |',
          '',
          'Important:',
          '- Base every suggestion on the actual document content — not generic options.',
          '- Labels should be concise and distinct from each other.',
          '- Description sentences should be specific to these documents.',
          '- Do NOT include any other commentary — just the 5 sections with tables.',
        ].join('\n');

        const response = await chatMessageApi(
          {
            action: 'send_message',
            userText: prompt,
            documents: chatDocs,
            domain,
            conversationHistory: [],
          },
          controller.signal,
        );

        recordUsage?.({
          provider: 'claude',
          model: CLAUDE_MODEL,
          inputTokens: response.usage.inputTokens,
          outputTokens: response.usage.outputTokens,
          cacheReadTokens: response.usage.cacheReadTokens,
          cacheWriteTokens: response.usage.cacheWriteTokens,
        });

        const result = parseBriefingMarkdownResponse(response.responseText);
        if (result.status !== 'ok') {
          throw new Error(result.error);
        }
        return result.suggestions;
      } catch (err: any) {
        if (isAbortError(err)) throw err;
        log.error('Briefing suggestions failed:', err);
        throw err;
      } finally {
        clearAbort();
      }
    },
    [recordUsage, createAbort, clearAbort, isAbortError],
  );

  const abortSuggestions = useCallback(() => {
    abortOp();
  }, [abortOp]);

  return { generateBriefingSuggestions, abortSuggestions };
}
