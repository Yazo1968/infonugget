import { useState, useCallback, useMemo, useRef } from 'react';
import { useNuggetContext } from '../context/NuggetContext';
import { useSelectionContext } from '../context/SelectionContext';
import { useAbortController } from './useAbortController';
import { Card, CardItem, DetailLevel, StylingOptions, ImageVersion, ReferenceImage, isCoverLevel } from '../types';
import { CLAUDE_MODEL, GEMINI_IMAGE_MODEL, CARD_TOKEN_LIMITS, COVER_TOKEN_LIMIT } from '../utils/constants';
import { flattenCards, findCard } from '../utils/cardUtils';
import { withGeminiRetry, callClaude, PRO_IMAGE_CONFIG, callGeminiProxy, uploadToFilesAPI } from '../utils/ai';
import { base64ToBlob } from '../utils/fileProcessing';
import { RecordUsageFn } from './useTokenUsage';
import { extractBase64, extractMime } from '../utils/modificationEngine';
import { buildContentPrompt, buildPlannerPrompt, buildSectionFocus } from '../utils/prompts/contentGeneration';
import { buildVisualizerPrompt } from '../utils/prompts/imageGeneration';
import {
  buildCoverContentPrompt,
  buildCoverPlannerPrompt,
  buildCoverVisualizerPrompt,
} from '../utils/prompts/coverGeneration';
import { buildExpertPriming } from '../utils/prompts/promptUtils';
import { resolveEnabledDocs } from '../utils/documentResolution';
import { useToast } from '../components/ToastNotification';
import { createLogger } from '../utils/logger';

const log = createLogger('CardGen');

/**
 * Card generation pipeline — shared by the insights workflow.
 * Handles: content synthesis → layout planning → image generation → batch operations.
 */
export function useCardGeneration(
  menuDraftOptions: StylingOptions,
  referenceImage: ReferenceImage | null = null,
  useReferenceImage: boolean = false,
  recordUsage?: RecordUsageFn,
) {
  const { selectedNugget, updateNuggetCard, updateNuggetDocument } = useNuggetContext();
  const { activeCardId } = useSelectionContext();

  const { addToast } = useToast();

  // State — per-card status tracking for concurrent generation
  const [genStatusMap, setGenStatusMap] = useState<Record<string, string>>({});
  const [activeLogicTab, setActiveLogicTab] = useState<DetailLevel>('Standard');
  const [manifestCards, setManifestCards] = useState<Card[] | null>(null);

  // Store a ref to generateCard so the retry closure can call it
  const generateCardRef = useRef<(card: Card) => Promise<void>>(undefined);

  // AbortController for cancelling in-flight generation (single or batch)
  const { create: createAbort, abort: abortOp, isAbortError } = useAbortController();

  // Helper: set status for a specific card
  const setCardStatus = useCallback((cardId: string, status: string) => {
    setGenStatusMap((prev) => {
      if (!status) {
        // Remove the entry when clearing
        const { [cardId]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [cardId]: status };
    });
  }, []);

  // Derived: status for the currently-viewed card (used by AssetsPanel display)
  const genStatus = useMemo(() => {
    if (!activeCardId) return '';
    return genStatusMap[activeCardId] || '';
  }, [genStatusMap, activeCardId]);

  // Derived
  const _activeCard = useMemo(() => {
    if (!selectedNugget) return null;
    const allCards = flattenCards(selectedNugget.cards);
    return allCards[0] || null;
  }, [selectedNugget]);

  const currentSynthesisContent = useMemo(() => {
    const allCards = flattenCards(selectedNugget?.cards ?? []);
    const card = allCards[0];
    if (!card) return '';
    const level = card.detailLevel || 'Standard';
    return card.synthesisMap?.[level] || '';
  }, [selectedNugget]);

  const contentDirty = useMemo(() => {
    if (!selectedNugget) return false;
    const allCards = flattenCards(selectedNugget.cards);
    const card = allCards[0];
    if (!card?.cardUrlMap?.[activeLogicTab]) return false;
    if (!card.lastGeneratedContentMap?.[activeLogicTab]) return false;
    const content = card.synthesisMap?.[card.detailLevel || 'Standard'] || '';
    return content !== card.lastGeneratedContentMap[activeLogicTab];
  }, [selectedNugget, activeLogicTab]);

  const selectedCount = useMemo(() => {
    const cards = flattenCards(selectedNugget?.cards ?? []);
    return cards.filter((c) => c.selected).length;
  }, [selectedNugget]);

  // ── Internal: synthesize content for a card ──

  const performSynthesis = useCallback(
    async (card: Card, level: DetailLevel, signal?: AbortSignal) => {
      if (!selectedNugget) return null;
      const enabledDocs = resolveEnabledDocs(selectedNugget.documents);
      let docsWithFileId = enabledDocs.filter((d) => d.fileId);

      // Auto-upload docs missing fileId before synthesis
      if (docsWithFileId.length === 0) {
        const uploadable = enabledDocs.filter((d) => d.content || d.pdfBase64);
        if (uploadable.length === 0) {
          addToast({
            type: 'error',
            message: 'No uploadable documents found',
            detail: 'Documents must have content before AI synthesis can work.',
            duration: 8000,
          });
          return null;
        }

        addToast({ type: 'info', message: 'Uploading documents to Files API...', duration: 4000 });
        for (const doc of uploadable) {
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
            log.warn(`Auto-upload failed for "${doc.name}":`, err);
            addToast({
              type: 'error',
              message: `Files API upload failed for "${doc.name}"`,
              detail: err.message || 'Check Edge Function secrets and network connection.',
              duration: 8000,
            });
          }
        }

        docsWithFileId = enabledDocs.filter((d) => d.fileId);
        if (docsWithFileId.length === 0) return null;
      }

      // Set synthesizing status
      updateNuggetCard(card.id, (c) => ({
        ...c,
        isSynthesizingMap: { ...(c.isSynthesizingMap || {}), [level]: true },
      }));

      const isCover = isCoverLevel(level);
      if (!manifestCards)
        setCardStatus(
          card.id,
          isCover
            ? `Generating ${level} content for [${card.text}]...`
            : `Synthesizing ${level} Mapping for [${card.text}]...`,
        );

      try {
        // Build unified section focus (handles both MD and PDF)
        const nuggetSubject = selectedNugget?.subject;
        const sectionFocus = buildSectionFocus(card.text, enabledDocs);

        // Branch: cover prompts vs content prompts
        const contentPrompt = isCover
          ? buildCoverContentPrompt(card.text, level, nuggetSubject)
          : buildContentPrompt(card.text, level, nuggetSubject);
        const finalPrompt = sectionFocus ? `${sectionFocus}\n\n${contentPrompt}` : contentPrompt;

        const expertPriming = buildExpertPriming(nuggetSubject);
        const systemRole = isCover
          ? expertPriming
            ? `${expertPriming} You also serve as an expert cover slide content designer. You create bold, concise titles, subtitles, and taglines for presentation cover slides. Follow the format and word count requirements precisely.`
            : 'You are an expert cover slide content designer. You create bold, concise titles, subtitles, and taglines for presentation cover slides. Follow the format and word count requirements precisely.'
          : expertPriming
            ? `${expertPriming} You also serve as an expert content synthesizer. You extract, restructure, and condense document content into infographic-ready text. Follow the formatting and word count requirements precisely.`
            : 'You are an expert content synthesizer. You extract, restructure, and condense document content into infographic-ready text. Follow the formatting and word count requirements precisely.';

        const systemBlocks: Array<{ text: string; cache: boolean }> = [{ text: systemRole, cache: false }];

        // Build user message with document blocks + section focus + content prompt
        const docBlocks = docsWithFileId.map((d) => ({
          type: 'document' as const,
          source: { type: 'file' as const, file_id: d.fileId! },
          title: d.name,
        }));
        const messages: Array<{ role: 'user' | 'assistant'; content: any }> = [
          {
            role: 'user' as const,
            content: [...docBlocks, { type: 'text' as const, text: finalPrompt }],
          },
        ];

        const { text: rawSynthesized, usage: claudeUsage } = await callClaude('', {
          systemBlocks,
          messages,
          maxTokens: isCover
            ? (CARD_TOKEN_LIMITS[level] ?? COVER_TOKEN_LIMIT)
            : (CARD_TOKEN_LIMITS[level] ?? CARD_TOKEN_LIMITS.Detailed),
          temperature: 0.3,
          signal,
        });

        recordUsage?.({
          provider: 'claude',
          model: CLAUDE_MODEL,
          inputTokens: claudeUsage?.input_tokens ?? 0,
          outputTokens: claudeUsage?.output_tokens ?? 0,
          cacheReadTokens: claudeUsage?.cache_read_input_tokens ?? 0,
          cacheWriteTokens: claudeUsage?.cache_creation_input_tokens ?? 0,
        });

        let synthesizedText = rawSynthesized;
        if (!isCover) {
          synthesizedText = synthesizedText.replace(/^\s*#\s+[^\n]*\n*/, '');
          synthesizedText = `# ${card.text}\n\n${synthesizedText.trimStart()}`;
        }

        updateNuggetCard(card.id, (c) => ({
          ...c,
          synthesisMap: { ...(c.synthesisMap || {}), [level]: synthesizedText },
          isSynthesizingMap: { ...(c.isSynthesizingMap || {}), [level]: false },
        }));

        return synthesizedText;
      } catch (err: any) {
        if (isAbortError(err)) return null;
        log.error('Synthesis failed:', err);
        addToast({
          type: 'error',
          message: `Content synthesis failed for "${card.text}"`,
          detail: err.message || 'Unknown error',
          duration: 8000,
        });
        updateNuggetCard(card.id, (c) => ({
          ...c,
          isSynthesizingMap: { ...(c.isSynthesizingMap || {}), [level]: false },
        }));
        return null;
      } finally {
        if (!manifestCards) setCardStatus(card.id, '');
      }
    },
    [selectedNugget, manifestCards, updateNuggetCard, setCardStatus, recordUsage],
  );

  // ── Generate card image for a card ──

  const generateCard = useCallback(
    async (card: Card, skipReferenceOnce?: boolean, externalSignal?: AbortSignal) => {
      if (typeof window !== 'undefined' && (window as any).aistudio) {
        const hasKey = await (window as any).aistudio.hasSelectedApiKey();
        if (!hasKey) {
          await (window as any).aistudio.openSelectKey();
        }
      }

      // Use provided signal (batch) or create a new AbortController (single card)
      let signal: AbortSignal;
      if (externalSignal) {
        signal = externalSignal;
      } else {
        const controller = createAbort();
        signal = controller.signal;
      }

      const settings = { ...menuDraftOptions };
      const currentLevel = settings.levelOfDetail;
      const nuggetSubject = selectedNugget?.subject;

      // Set generating status
      updateNuggetCard(card.id, (c) => ({
        ...c,
        isGeneratingMap: { ...(c.isGeneratingMap || {}), [currentLevel]: true },
      }));

      try {
        // Look up content at the toolbar's level first, then fall back to the card's own level
        const contentToMap =
          card.synthesisMap?.[currentLevel] ||
          card.synthesisMap?.[card.detailLevel || 'Standard'];

        if (!contentToMap) {
          addToast({
            type: 'warning',
            message: `No content available for "${card.text}"`,
            detail: 'Please create content for this card before generating an image.',
            duration: 6000,
          });
          return;
        }

        const isCover = isCoverLevel(currentLevel);
        setCardStatus(card.id, `Planning layout for [${card.text}]...`);

        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

        let visualPlan: string | undefined;
        try {
          const plannerPrompt = isCover
            ? buildCoverPlannerPrompt(card.text, contentToMap, settings.style, settings.aspectRatio, currentLevel)
            : buildPlannerPrompt(
                card.text,
                contentToMap,
                settings.aspectRatio,
                card.visualPlanMap?.[currentLevel],
                nuggetSubject,
              );

          const plannerResponse = await callClaude(plannerPrompt, { maxTokens: 1024, temperature: 0.7, signal });
          visualPlan = plannerResponse?.text || undefined;
          if (plannerResponse?.usage) {
            recordUsage?.({
              provider: 'claude',
              model: CLAUDE_MODEL,
              inputTokens: plannerResponse.usage?.input_tokens ?? 0,
              outputTokens: plannerResponse.usage?.output_tokens ?? 0,
              cacheReadTokens: plannerResponse.usage?.cache_read_input_tokens ?? 0,
              cacheWriteTokens: plannerResponse.usage?.cache_creation_input_tokens ?? 0,
            });
          }
        } catch (err) {
          log.warn('Planner step failed, falling back to direct visualization:', err);
        }

        setCardStatus(
          card.id,
          `Rendering ${settings.style} ${isCover ? 'Card' : 'Visual'} [${currentLevel}] for [${card.text}]...`,
        );

        const shouldUseRef = !!(referenceImage && useReferenceImage && !skipReferenceOnce);
        const lastPrompt = isCover
          ? buildCoverVisualizerPrompt(card.text, contentToMap, settings, visualPlan, shouldUseRef, currentLevel)
          : buildVisualizerPrompt(card.text, contentToMap, settings, visualPlan, shouldUseRef, nuggetSubject);

        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

        const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [];
        if (shouldUseRef) {
          parts.push({
            inlineData: {
              mimeType: extractMime(referenceImage!.url),
              data: extractBase64(referenceImage!.url),
            },
          });
        }
        parts.push({ text: lastPrompt });

        // Retry up to 2 extra times when Gemini returns a 200 but no image data
        const IMAGE_EMPTY_RETRIES = 2;
        let imageResponse = await withGeminiRetry(async () => {
          return await callGeminiProxy(
            GEMINI_IMAGE_MODEL,
            [{ parts }],
            {
              ...PRO_IMAGE_CONFIG,
              imageConfig: {
                aspectRatio: settings.aspectRatio,
                imageSize: settings.resolution,
              },
            },
            signal,
          );
        });

        for (let emptyRetry = 0; emptyRetry < IMAGE_EMPTY_RETRIES; emptyRetry++) {
          if (imageResponse.images && imageResponse.images.length > 0) break;
          if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
          // Safety block — don't retry if the model explicitly refused
          const reason = imageResponse.finishReason?.toUpperCase();
          if (reason === 'SAFETY' || reason === 'PROHIBITED_CONTENT' || imageResponse.promptFeedback?.blockReason) {
            break;
          }
          log.warn(`Empty image response for "${card.text}" (attempt ${emptyRetry + 1}/${IMAGE_EMPTY_RETRIES}), retrying...`);
          await new Promise((r) => setTimeout(r, 1500 * (emptyRetry + 1)));
          imageResponse = await withGeminiRetry(async () => {
            return await callGeminiProxy(
              GEMINI_IMAGE_MODEL,
              [{ parts }],
              {
                ...PRO_IMAGE_CONFIG,
                imageConfig: {
                  aspectRatio: settings.aspectRatio,
                  imageSize: settings.resolution,
                },
              },
              signal,
            );
          });
        }

        if (imageResponse?.usageMetadata) {
          recordUsage?.({
            provider: 'gemini',
            model: GEMINI_IMAGE_MODEL,
            inputTokens: imageResponse.usageMetadata?.promptTokenCount ?? 0,
            outputTokens: imageResponse.usageMetadata?.candidatesTokenCount ?? 0,
          });
        }

        let cardUrl = '';
        if (!imageResponse.images || imageResponse.images.length === 0) {
          // Build a descriptive error using diagnostics from the proxy
          const reason = imageResponse.finishReason;
          const blocked = imageResponse.promptFeedback?.blockReason;
          let detail = 'The response may have been blocked or empty.';
          if (blocked) {
            detail = `Prompt blocked by safety filter: ${blocked}`;
          } else if (reason === 'SAFETY' || reason === 'PROHIBITED_CONTENT') {
            detail = `Image generation blocked (${reason}). Try simplifying the card content.`;
          } else if (reason) {
            detail = `Model finish reason: ${reason}. The model may not have generated an image for this content.`;
          }
          if (imageResponse.text) {
            log.warn(`Gemini returned text but no image for "${card.text}":`, imageResponse.text.slice(0, 200));
          }
          throw new Error(`No image data received from the AI model. ${detail}`);
        }
        const img = imageResponse.images[0];
        if (!img.data || typeof img.data !== 'string' || img.data.length < 100) {
          throw new Error('Image data is empty or corrupted. The AI model returned an invalid image.');
        }
        cardUrl = `data:${img.mimeType || 'image/png'};base64,${img.data}`;

        if (cardUrl) {
          updateNuggetCard(card.id, (c) => {
            // Preserve version history: keep existing versions and append the new generation
            const existingHistory = c.imageHistoryMap?.[currentLevel] || [];
            const prevUrl = c.cardUrlMap?.[currentLevel];
            const updatedHistory = [...existingHistory];
            // If there's a previous image that isn't already the last entry, add it
            if (
              prevUrl &&
              (updatedHistory.length === 0 || updatedHistory[updatedHistory.length - 1].imageUrl !== prevUrl)
            ) {
              updatedHistory.push({
                imageUrl: prevUrl,
                timestamp: Date.now(),
                label: updatedHistory.length === 0 ? 'Original' : `Generation ${updatedHistory.length}`,
              });
            }
            // Add the new generation
            updatedHistory.push({
              imageUrl: cardUrl,
              timestamp: Date.now(),
              label: `Generation ${updatedHistory.length + 1}`,
            });
            // Cap at 10 versions
            while (updatedHistory.length > 10) updatedHistory.shift();
            return {
              ...c,
              cardUrlMap: { ...(c.cardUrlMap || {}), [currentLevel]: cardUrl },
              isGeneratingMap: { ...(c.isGeneratingMap || {}), [currentLevel]: false },
              imageHistoryMap: { ...(c.imageHistoryMap || {}), [currentLevel]: updatedHistory },
              lastGeneratedContentMap: { ...(c.lastGeneratedContentMap || {}), [currentLevel]: contentToMap },
              visualPlanMap: { ...(c.visualPlanMap || {}), [currentLevel]: visualPlan },
              lastPromptMap: { ...(c.lastPromptMap || {}), [currentLevel]: lastPrompt },
            };
          });
        }
      } catch (err: any) {
        if (isAbortError(err)) return;
        log.error('Generation failed:', err);
        log.error(
          'Generation error details:',
          JSON.stringify(
            {
              message: err.message,
              status: err.status,
              code: err.code,
              details: err.details,
              errorInfo: err.errorInfo,
              aspectRatio: settings.aspectRatio,
              resolution: settings.resolution,
              style: settings.style,
              level: currentLevel,
            },
            null,
            2,
          ),
        );
        if (err.message?.includes('Requested entity was not found') || err.status === 404) {
          if (typeof window !== 'undefined' && (window as any).aistudio) {
            await (window as any).aistudio.openSelectKey();
          }
        }

        // Determine if this was a retryable error (503/overloaded/rate-limit)
        const msg = (err.message || '').toLowerCase();
        const isOverloaded =
          msg.includes('503') ||
          msg.includes('unavailable') ||
          msg.includes('high demand') ||
          msg.includes('overloaded');

        addToast({
          type: isOverloaded ? 'warning' : 'error',
          message: isOverloaded
            ? `Model overloaded — generation for "${card.text}" failed after retries`
            : `Generation failed for "${card.text}"`,
          detail: isOverloaded
            ? 'The AI model is experiencing high demand. Try again in a moment.'
            : err.message || 'Unknown error',
          onRetry: () => {
            generateCardRef.current?.(card);
          },
          duration: isOverloaded ? 12000 : 8000,
        });
      } finally {
        if (!manifestCards) setCardStatus(card.id, '');
        updateNuggetCard(card.id, (c) => ({
          ...c,
          isGeneratingMap: { ...(c.isGeneratingMap || {}), [currentLevel]: false },
        }));
      }
    },
    [
      performSynthesis,
      manifestCards,
      menuDraftOptions,
      referenceImage,
      useReferenceImage,
      updateNuggetCard,
      setCardStatus,
      addToast,
      recordUsage,
      selectedNugget?.subject,
    ],
  );

  // Keep ref in sync so retry closures always call the latest generateCard
  generateCardRef.current = generateCard;

  // ── Batch operations ──

  const handleGenerateAll = useCallback(() => {
    const cards = flattenCards(selectedNugget?.cards ?? []);
    if (cards.length === 0) return;

    const selectedItems = cards.filter((c) => c.selected);
    if (selectedItems.length === 0) {
      addToast({ type: 'info', message: 'Please select items in the sidebar first.', duration: 4000 });
      return;
    }

    setManifestCards(selectedItems);
  }, [selectedNugget, addToast, setManifestCards]);

  const executeBatchCardGeneration = async () => {
    if (!manifestCards) return;
    const selectedItems = [...manifestCards];
    setManifestCards(null);

    // Create shared abort controller for the batch
    const controller = createAbort();

    // Set initial batch status on each card
    for (const item of selectedItems) {
      setCardStatus(item.id, `Queued for batch generation...`);
    }
    await Promise.allSettled(selectedItems.map((item) => generateCard(item, undefined, controller.signal)));
    // Individual card statuses are cleared in generateCard's finally block
  };

  // ── Image modification handler ──

  const handleImageModified = useCallback(
    (cardId: string, newImageUrl: string, history: ImageVersion[]) => {
      const card = findCard(selectedNugget?.cards ?? [], cardId);
      const level = card?.detailLevel || 'Standard';
      const currentContent = card?.synthesisMap?.[level] || '';

      updateNuggetCard(cardId, (c) => ({
        ...c,
        cardUrlMap: { ...(c.cardUrlMap || {}), [level]: newImageUrl },
        imageHistoryMap: { ...(c.imageHistoryMap || {}), [level]: history },
        lastGeneratedContentMap: {
          ...(c.lastGeneratedContentMap || {}),
          [level]: currentContent || c.lastGeneratedContentMap?.[level],
        },
      }));
    },
    [selectedNugget, updateNuggetCard],
  );

  const stopGeneration = useCallback(() => {
    abortOp();
  }, [abortOp]);

  return {
    genStatus,
    activeLogicTab,
    setActiveLogicTab,
    manifestCards,
    setManifestCards,
    currentSynthesisContent,
    contentDirty,
    selectedCount,
    generateCard,
    stopGeneration,
    handleGenerateAll,
    executeBatchCardGeneration,
    handleImageModified,
  };
}
