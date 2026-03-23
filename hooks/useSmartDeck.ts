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
import { uploadToFilesAPI } from '../utils/ai';
import { base64ToBlob } from '../utils/fileProcessing';
import { buildSmartDeckPrompt } from '../utils/smartDeck/prompt';

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

  return {
    session,
    generate,
    acceptCards,
    abort,
    reset,
  };
}
