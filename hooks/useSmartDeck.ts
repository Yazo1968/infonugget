import { useState, useCallback } from 'react';
import { useNuggetContext } from '../context/NuggetContext';
import {
  AutoDeckBriefing,
  AutoDeckLod,
  SmartDeckSession,
  SmartDeckStatus,
  DetailLevel,
  UploadedFile,
} from '../types';
import { CLAUDE_MODEL } from '../utils/constants';
import { RecordUsageFn } from './useTokenUsage';
import { parseProducerResponse, ProducedCard } from '../utils/deckShared/parsers';
import { LOD_LEVELS, countWords } from '../utils/deckShared/constants';
import { useToast } from '../components/ToastNotification';
import { createLogger } from '../utils/logger';
import { useAbortController } from './useAbortController';
import { resolveEnabledDocs } from '../utils/documentResolution';
import { chatMessageApi, ChatMessageDocument } from '../utils/api';
import { uploadToFilesAPI, callClaude } from '../utils/ai';
import { base64ToBlob } from '../utils/fileProcessing';
import { buildSmartDeckPrompt } from '../utils/smartDeck/prompt';
import type { ClaudeMessage } from '../utils/ai';

const log = createLogger('SmartDeck');

// ── Config for the generate call ──

export interface SmartDeckGenerateConfig {
  briefing: AutoDeckBriefing;
  lod: AutoDeckLod;
  includeCover: boolean;
  includeClosing: boolean;
}

// ── Hook ──

export function useSmartDeck(
  recordUsage?: RecordUsageFn,
  placeholderFns?: {
    createPlaceholderCards: (titles: string[], detailLevel: DetailLevel | DetailLevel[], options?: { sourceDocuments?: string[]; smartDeckSessionId?: string }) => { id: string; title: string }[];
    createPlaceholderCardsInFolder?: (titles: string[], detailLevel: DetailLevel | DetailLevel[], options?: { sourceDocuments?: string[]; smartDeckSessionId?: string; folderName?: string }) => { folderId: string; cards: { id: string; title: string }[] } | null;
    fillPlaceholderCard: (cardId: string, detailLevel: DetailLevel, content: string, newTitle?: string) => void;
    removePlaceholderCard: (cardId: string, detailLevel: DetailLevel) => void;
  },
) {
  const { selectedNugget, updateNugget, updateNuggetDocument, createLogCheckpoint } = useNuggetContext();
  const { addToast } = useToast();

  const [session, setSession] = useState<SmartDeckSession | null>(null);
  const { create: createAbort, abort: abortOp, clear: clearAbort, isAbortError } = useAbortController();

  // ── Helpers ──

  const updateSession = useCallback((updater: (s: SmartDeckSession) => SmartDeckSession) => {
    setSession((prev) => (prev ? updater(prev) : prev));
  }, []);

  const setStatus = useCallback(
    (status: SmartDeckStatus) => {
      updateSession((s) => ({ ...s, status }));
    },
    [updateSession],
  );

  /**
   * Ensure all documents have a Files API fileId.
   * Uploads any doc missing one. Returns docs with fileIds, or null if all failed.
   */
  const ensureDocFileIds = useCallback(
    async (docs: UploadedFile[]): Promise<UploadedFile[] | null> => {
      const needsUpload = docs.filter((d) => !d.fileId);
      if (needsUpload.length === 0) return docs;

      addToast({ type: 'info', message: 'Uploading documents to Files API...', duration: 4000 });

      for (const doc of needsUpload) {
        try {
          let newFileId: string | undefined;
          if (doc.sourceType === 'native-pdf' && doc.pdfBase64) {
            newFileId = await uploadToFilesAPI(
              base64ToBlob(doc.pdfBase64, 'application/pdf'),
              doc.name,
              'application/pdf',
            );
          } else if (doc.content) {
            newFileId = await uploadToFilesAPI(doc.content, doc.name, 'text/plain');
          }
          if (newFileId) {
            updateNuggetDocument(doc.id, { ...doc, fileId: newFileId });
            (doc as any).fileId = newFileId;
          }
        } catch (err: any) {
          log.warn(`Files API upload failed for "${doc.name}":`, err);
          addToast({
            type: 'error',
            message: `Upload failed for "${doc.name}"`,
            detail: err.message || 'Check network connection.',
            duration: 8000,
          });
        }
      }

      const uploaded = docs.filter((d) => d.fileId);
      if (uploaded.length === 0) {
        addToast({ type: 'error', message: 'All document uploads failed. Cannot proceed.', duration: 8000 });
        return null;
      }
      return docs;
    },
    [addToast, updateNuggetDocument],
  );

  // ── Actions ──

  /**
   * Generate a complete card deck in a single shot.
   */
  const generate = useCallback(
    async (config: SmartDeckGenerateConfig) => {
      if (!selectedNugget) return;

      // Resolve enabled documents
      const enabledDocs = resolveEnabledDocs(selectedNugget.documents);
      if (enabledDocs.length === 0) {
        addToast({ message: 'No enabled documents available.', type: 'error' });
        return;
      }

      // Validate briefing
      const { briefing } = config;
      if (!briefing.objective && !briefing.audience && !briefing.type) {
        addToast({ message: 'Please set at least one briefing field (objective, audience, or type).', type: 'error' });
        return;
      }

      // Ensure file IDs
      const docsWithFiles = await ensureDocFileIds(enabledDocs);
      if (!docsWithFiles) return;

      // Create sources log checkpoint
      createLogCheckpoint('smart_deck');

      // Create session
      const sessionId = `smartdeck-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
      const newSession: SmartDeckSession = {
        id: sessionId,
        nuggetId: selectedNugget.id,
        lod: config.lod,
        domain: selectedNugget.domain,
        status: 'generating',
        generatedCards: [],
        includeCover: config.includeCover,
        includeClosing: config.includeClosing,
        error: null,
        createdAt: Date.now(),
      };
      setSession(newSession);

      const abortController = createAbort();

      try {
        // Build documents array for chatMessageApi
        const apiDocs: ChatMessageDocument[] = docsWithFiles.map((d) => ({
          name: d.name,
          fileId: d.fileId,
          sourceType: d.sourceType,
          bookmarks: d.bookmarks,
        }));

        // Build the prompt
        const userText = buildSmartDeckPrompt({
          briefing: config.briefing,
          lod: config.lod,
          includeCover: config.includeCover,
          includeClosing: config.includeClosing,
          documentNames: docsWithFiles.map((d) => d.name),
          domain: selectedNugget.domain,
        });

        log.info(`Generating presentation: ${config.lod}, cover=${config.includeCover}, closing=${config.includeClosing}`);

        // Call the chat-message Edge Function
        const response = await chatMessageApi({
          action: 'send_message',
          userText,
          documents: apiDocs,
          domain: selectedNugget.domain,
          conversationHistory: [],
          geminiStoreName: selectedNugget.geminiStoreName,
          maxTokens: 16000,
        }, abortController.signal);

        // Record token usage
        recordUsage?.({
          provider: 'claude',
          model: CLAUDE_MODEL,
          inputTokens: response.usage.inputTokens,
          outputTokens: response.usage.outputTokens,
          cacheReadTokens: response.usage.cacheReadTokens,
          cacheWriteTokens: response.usage.cacheWriteTokens,
        });

        // Parse the response — reuse producer parser
        const result = parseProducerResponse(response.responseText);

        if (result.status === 'ok' && result.cards.length > 0) {
          setSession((prev) =>
            prev
              ? {
                  ...prev,
                  status: 'reviewing',
                  generatedCards: result.cards,
                }
              : prev,
          );
          addToast({ message: `Generated ${result.cards.length} cards for review.`, type: 'success', duration: 4000 });
        } else {
          const errorMsg = result.status === 'error' ? result.error : 'No cards were generated.';
          setSession((prev) =>
            prev
              ? { ...prev, status: 'error', error: errorMsg }
              : prev,
          );
        }
      } catch (err: any) {
        if (isAbortError(err)) {
          setSession(null);
          return;
        }
        log.error('Generation failed:', err);
        setSession((prev) =>
          prev
            ? { ...prev, status: 'error', error: `Generation failed: ${err.message}` }
            : prev,
        );
      } finally {
        clearAbort();
      }
    },
    [selectedNugget, recordUsage, addToast, createLogCheckpoint, ensureDocFileIds, createAbort, clearAbort, isAbortError],
  );

  /**
   * Accept all generated cards — create them in the nugget as a folder.
   */
  const acceptCards = useCallback(() => {
    if (!session || session.status !== 'reviewing' || !selectedNugget) return;

    setStatus('accepting');

    const { generatedCards, lod, includeCover, includeClosing } = session;
    const lodConfig = LOD_LEVELS[lod];
    const contentDetailLevel = lodConfig.detailLevel;
    const enabledDocNames = resolveEnabledDocs(selectedNugget.documents).map((d) => d.name);

    // Build titles and per-card detail levels
    // Cover card (number 0) → 'TitleCard', closing card (last) → 'TakeawayCard', content → LOD
    const titles = generatedCards.map((c) => c.title);
    const lastCardNumber = generatedCards.length > 0 ? Math.max(...generatedCards.map((c) => c.number)) : -1;
    const perCardDetailLevels: DetailLevel[] = generatedCards.map((c) => {
      if (includeCover && c.number === 0) return 'TitleCard' as DetailLevel;
      if (includeClosing && c.number === lastCardNumber) return 'TakeawayCard' as DetailLevel;
      return contentDetailLevel;
    });

    if (placeholderFns) {
      const placeholderMap = new Map<string, { id: string; index: number }>();

      if (placeholderFns.createPlaceholderCardsInFolder && titles.length >= 2) {
        const folderResult = placeholderFns.createPlaceholderCardsInFolder(titles, perCardDetailLevels, {
          sourceDocuments: enabledDocNames,
          smartDeckSessionId: session.id,
          folderName: `Deck- ${selectedNugget?.name || 'Untitled'}`,
        });
        if (folderResult) {
          for (let i = 0; i < folderResult.cards.length; i++) {
            placeholderMap.set(folderResult.cards[i].title, { id: folderResult.cards[i].id, index: i });
          }
        }
      } else {
        const placeholders = placeholderFns.createPlaceholderCards(titles, perCardDetailLevels, {
          sourceDocuments: enabledDocNames,
          smartDeckSessionId: session.id,
        });
        for (let i = 0; i < placeholders.length; i++) {
          placeholderMap.set(placeholders[i].title, { id: placeholders[i].id, index: i });
        }
      }

      // Fill all placeholders immediately (content is already generated)
      // Use the per-card detailLevel that matches the spinner key from creation
      for (const pc of generatedCards) {
        const entry = placeholderMap.get(pc.title);
        if (entry) {
          const cardDetailLevel = perCardDetailLevels[entry.index];
          // Content already includes # heading from the AI output — don't prepend title again
          placeholderFns.fillPlaceholderCard(entry.id, cardDetailLevel, pc.content);
        }
      }
    }

    setStatus('complete');
    addToast({ message: `${generatedCards.length} cards created successfully.`, type: 'success', duration: 5000 });
  }, [session, selectedNugget, placeholderFns, addToast, setStatus]);

  /**
   * Abort in-flight generation.
   */
  const abort = useCallback(() => {
    abortOp();
    setSession(null);
  }, [abortOp]);

  /**
   * Reset to configuring state.
   */
  const reset = useCallback(() => {
    abortOp();
    setSession(null);
  }, [abortOp]);

  // ── AI Suggest Card Count ──

  const [isSuggesting, setIsSuggesting] = useState(false);

  type LodSuggestions = Record<AutoDeckLod, { min: number; max: number }>;

  const suggestCardCount = useCallback(async (
    briefing: AutoDeckBriefing,
  ): Promise<LodSuggestions | null> => {
    if (!selectedNugget) return null;

    const docs = resolveEnabledDocs(selectedNugget.documents);
    if (docs.length === 0) {
      addToast({ type: 'warning', message: 'No documents available for analysis.' });
      return null;
    }

    setIsSuggesting(true);
    try {
      // Ensure docs have file IDs
      const docsWithFiles = await ensureDocFileIds(docs);
      if (!docsWithFiles) {
        addToast({ type: 'warning', message: 'Could not upload documents for analysis.' });
        return null;
      }

      // Build file reference content blocks for the user message
      const contentBlocks: any[] = [];
      for (const doc of docsWithFiles) {
        if (doc.fileId) {
          contentBlocks.push({
            type: 'document',
            source: { type: 'file', file_id: doc.fileId },
            title: doc.name,
          });
        }
      }

      const briefingLines = [
        briefing.objective ? `- Objective: ${briefing.objective}` : null,
        briefing.audience ? `- Audience: ${briefing.audience}` : null,
        briefing.type ? `- Presentation type: ${briefing.type}` : null,
        briefing.tone ? `- Tone: ${briefing.tone}` : null,
        briefing.focus ? `- Focus: ${briefing.focus}` : null,
      ].filter(Boolean).join('\n');

      const domainFirstLine = selectedNugget.domain?.split('\n').find(l => l.trim().startsWith('Domain:'))?.replace(/^-?\s*Domain:\s*/i, '').trim() || '';
      const domainRole = domainFirstLine ? ` in the domain of ${domainFirstLine}` : '';

      const prompt = `You are a top tier expert${domainRole}. Exercise your best expert judgment as the overarching factor in every recommendation. The analytical steps below are guides, not formulas — your domain expertise and professional instinct should override mechanical calculation whenever they conflict. A great deck is one where every card earns its place. Recommend the optimal number of content cards across three levels of detail.

ANALYTICAL PROCESS (execute silently before outputting JSON):

Step 1 — Content Inventory
- Identify all distinct topics, themes, and sections in the documents
- Estimate total meaningful word count (exclude headers, labels, metadata)
- Note content density: are topics deep and interconnected, or shallow and discrete?

Step 2 — Topic Consolidation
- Merge related sub-topics that share a common argument or theme into one card
- Avoid card-per-heading thinking — a heading is not a card
- Only treat a topic as a standalone card if it cannot be meaningfully combined with another without losing clarity

Step 3 — LOD Calibration
Apply each word-per-card benchmark to estimate raw card count for each level:
- Executive: 60-80 words/card — high-level summaries, minimal elaboration
- Standard: 120-170 words/card — balanced coverage with supporting points
- Detailed: 250-300 words/card — comprehensive analysis with evidence
Formula: Estimated card count = Total meaningful words / LOD benchmark (midpoint)

Step 4 — Briefing Adjustment
Adjust the raw count based on briefing context:
- Quick brief / status update — reduce by up to 20%
- Standard presentation — no adjustment
- Comprehensive / board-level / multi-stakeholder — increase by up to 15%

Step 5 — Conservative Bias Check
Before finalizing, apply this editorial test to each card:
"Does this card carry a distinct, standalone argument or insight?"
If no — merge it. A tight deck always outperforms a padded one.
When in doubt, recommend fewer cards.

BRIEFING CONTEXT:
${briefingLines}

HARD CONSTRAINTS:
- Content cards only — do not count cover or takeaway cards
- Minimum: 3 cards (no deck is meaningful below this)
- Maximum: 18 cards (beyond this, the deck should be split)
- Spread: 2-3 cards maximum between min and max for each LOD
- Executive should have the most cards (more topics, less depth each)
- Detailed should have the fewest cards (fewer topics, more depth each)
- If content genuinely warrants more than 18 cards, cap at 18

Respond with ONLY a JSON object, no other text:
{"executive": {"min": <number>, "max": <number>}, "standard": {"min": <number>, "max": <number>}, "detailed": {"min": <number>, "max": <number>}}`;

      contentBlocks.push({ type: 'text', text: prompt });

      const messages: ClaudeMessage[] = [{ role: 'user', content: contentBlocks }];

      const result = await callClaude('', {
        messages,
        maxTokens: 100,
        temperature: 0,
      });

      // Parse the JSON response
      const jsonStr = result.text.match(/\{[\s\S]*\}/)?.[0];
      if (!jsonStr) {
        log.warn('AI suggest: could not parse response:', result.text);
        addToast({ type: 'warning', message: 'Could not parse AI suggestion. Try again.' });
        return null;
      }

      const parsed = JSON.parse(jsonStr);
      const suggestions: LodSuggestions = {} as LodSuggestions;
      for (const lod of ['executive', 'standard', 'detailed'] as AutoDeckLod[]) {
        const entry = parsed[lod];
        if (!entry || typeof entry.min !== 'number' || typeof entry.max !== 'number') {
          log.warn(`AI suggest: missing or invalid entry for ${lod}:`, entry);
          addToast({ type: 'warning', message: 'AI returned incomplete data. Try again.' });
          return null;
        }
        if (entry.min < 3 || entry.max > 18 || entry.min > entry.max) {
          log.warn(`AI suggest: invalid range for ${lod}:`, entry);
          addToast({ type: 'warning', message: `AI returned invalid range for ${lod}. Try again.` });
          return null;
        }
        suggestions[lod] = { min: entry.min, max: entry.max };
      }

      recordUsage?.({
        provider: 'claude',
        model: CLAUDE_MODEL,
        inputTokens: result.usage?.input_tokens ?? 0,
        outputTokens: result.usage?.output_tokens ?? 0,
      });

      log.info('AI suggested card counts:', suggestions);
      return suggestions;
    } catch (err: any) {
      if (!isAbortError(err)) {
        log.error('AI suggest failed:', err.message);
        addToast({ type: 'error', message: 'Failed to get AI suggestion.', detail: err.message });
      }
      return null;
    } finally {
      setIsSuggesting(false);
    }
  }, [selectedNugget, ensureDocFileIds, addToast, recordUsage, isAbortError]);

  return {
    session,
    generate,
    acceptCards,
    abort,
    reset,
    suggestCardCount,
    isSuggesting,
  };
}
