import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useNuggetContext } from '../context/NuggetContext';
import { useProjectContext } from '../context/ProjectContext';
import { useSelectionContext } from '../context/SelectionContext';
import { useAppContext } from '../context/AppContext';
import { useAbortController } from './useAbortController';
import { Card, DetailLevel, StylingOptions, AlbumImage, ReferenceImage, isCoverLevel } from '../types';
import { CLAUDE_MODEL, CARD_TOKEN_LIMITS, COVER_TOKEN_LIMIT } from '../utils/constants';
import { flattenCards, findCard, cleanCardTitle } from '../utils/cardUtils';
import { callClaude, uploadToFilesAPI } from '../utils/ai';
import { base64ToBlob } from '../utils/fileProcessing';
import { RecordUsageFn } from './useTokenUsage';
import { extractBase64, extractMime } from '../utils/modificationEngine';
import { buildContentPrompt, buildSectionFocus } from '../utils/prompts/contentGeneration';
import { buildCoverContentPrompt } from '../utils/prompts/coverGeneration';
import { buildExpertPriming } from '../utils/prompts/promptUtils';
import { resolveEnabledDocs } from '../utils/documentResolution';
import { generateCardApi } from '../utils/api';
import { useToast } from '../components/ToastNotification';
import { createLogger } from '../utils/logger';
import { marked } from 'marked';
import { toPng } from 'html-to-image';
import { sanitizeHtml } from '../utils/sanitize';

const log = createLogger('CardGen');

/**
 * Render markdown content as HTML, mount in a hidden container, screenshot it,
 * and return the base64 data (without the data URL prefix).
 */
const SCREENSHOT_CSS = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  h1 { font-size: 22px; font-weight: 700; margin: 0 0 12px 0; color: #111; }
  h2 { font-size: 18px; font-weight: 700; margin: 16px 0 8px 0; color: #222; }
  h3 { font-size: 15px; font-weight: 600; margin: 12px 0 6px 0; color: #333; }
  p { margin: 0 0 10px 0; }
  ul { margin: 0 0 10px 0; padding-left: 24px; list-style-type: disc; }
  ol { margin: 0 0 10px 0; padding-left: 24px; list-style-type: decimal; }
  li { margin: 0 0 4px 0; display: list-item; }
  blockquote { margin: 10px 0; padding: 8px 16px; border-left: 3px solid #2a9fd4; background: #f0f7fb; color: #333; font-style: italic; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 13px; }
  th { background: #f1f5f9; font-weight: 700; text-align: left; padding: 8px 12px; border: 1px solid #d1d5db; color: #111; }
  td { padding: 6px 12px; border: 1px solid #d1d5db; vertical-align: top; color: #333; }
  tr:nth-child(even) td { background: #f9fafb; }
  strong { font-weight: 700; }
  em { font-style: italic; }
  code { background: #f1f5f9; padding: 1px 4px; border-radius: 3px; font-size: 13px; }
`;

/** Split paragraphs at every sentence boundary for screenshot readability. */
function splitSentences(html: string): string {
  return html.replace(/<p>([\s\S]*?)<\/p>/gi, (_match, content) => {
    const sentences = content.split(/(?<=\.)\s+/).filter((s: string) => s.trim());
    if (sentences.length <= 1) return `<p>${content}</p>`;
    return sentences.map((s: string) => `<p>${s.trim()}</p>`).join('\n');
  });
}

async function screenshotContent(markdownContent: string): Promise<string> {
  const rawHtml = sanitizeHtml(marked.parse(markdownContent, { async: false }) as string);
  const html = splitSentences(rawHtml);
  const container = document.createElement('div');
  container.style.cssText = 'position:fixed;left:0;top:0;width:800px;padding:32px;background:#fff;color:#222;font-family:system-ui,-apple-system,sans-serif;font-size:14px;line-height:1.6;z-index:-1;opacity:0;pointer-events:none;';
  container.innerHTML = `<style>${SCREENSHOT_CSS}</style>${html}`;
  document.body.appendChild(container);
  // Let the browser layout the content
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  // Set opacity to 1 just for capture (html-to-image reads computed styles)
  container.style.opacity = '1';
  try {
    const dataUrl = await toPng(container, { pixelRatio: 1, cacheBust: true, skipFonts: true });
    return dataUrl;
  } finally {
    document.body.removeChild(container);
  }
}

/** Parse Claude's response — strips any residual XML tags if present (backward compat). */
function parseContentResponse(raw: string): string {
  const contentMatch = raw.match(/<card_content>([\s\S]*?)<\/card_content>/);
  return contentMatch ? contentMatch[1].trim() : raw.trim();
}

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
  const { projects } = useProjectContext();
  const { openProjectId } = useAppContext();
  const { activeCardId } = useSelectionContext();

  const { addToast } = useToast();

  // State — per-card status tracking for concurrent generation
  const [genStatusMap, setGenStatusMap] = useState<Record<string, string>>({});
  const [activeLogicTab, setActiveLogicTab] = useState<DetailLevel>('Standard');
  const [manifestCards, setManifestCards] = useState<Card[] | null>(null);
  const [lastScreenshot, setLastScreenshot] = useState<string | null>(null);
  const lastScreenshotRef = useRef<string | null>(null);

  // Keep ref in sync with state so async generateCard can read latest value
  useEffect(() => { lastScreenshotRef.current = lastScreenshot; }, [lastScreenshot]);

  /**
   * Standalone screenshot capture — call before generating to preview what Gemini will see.
   * Takes a screenshot of the active card's content and stores it in state.
   */
  const captureScreenshot = useCallback(async (card: Card): Promise<string | null> => {
    const currentLevel = card.detailLevel || activeLogicTab;
    const contentToMap = card.synthesisMap?.[currentLevel];
    if (!contentToMap) {
      log.warn('No content to screenshot');
      return null;
    }
    try {
      log.info(`Capturing content screenshot for "${card.text}" [${currentLevel}]`);
      const screenshot = await screenshotContent(contentToMap);
      log.info(`Content screenshot captured: ${Math.round(screenshot.length / 1024)}KB`);
      setLastScreenshot(screenshot);
      return screenshot;
    } catch (err: any) {
      log.error('Screenshot capture failed:', err.message);
      return null;
    }
  }, [activeLogicTab]);

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
        // Strip dedup suffix so "(2)" doesn't appear in prompts or on images
        const title = cleanCardTitle(card.text);

        // Build unified section focus (handles both MD and PDF)
        const nuggetDomain = selectedNugget?.domain;
        const sectionFocus = buildSectionFocus(title, enabledDocs);

        // Branch: cover prompts vs content prompts
        const contentPrompt = isCover
          ? buildCoverContentPrompt(title, level, nuggetDomain)
          : buildContentPrompt(title, level, nuggetDomain);
        const finalPrompt = sectionFocus ? `${sectionFocus}\n\n${contentPrompt}` : contentPrompt;

        const expertPriming = buildExpertPriming(nuggetDomain);
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

        const maxTokens = isCover
          ? (CARD_TOKEN_LIMITS[level] ?? COVER_TOKEN_LIMIT)
          : (CARD_TOKEN_LIMITS[level] ?? CARD_TOKEN_LIMITS.Detailed);

        const { text: rawSynthesized, usage: claudeUsage } = await callClaude('', {
          systemBlocks,
          messages,
          maxTokens,
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

        // Extract content (strips residual XML tags if present)
        const contentText = parseContentResponse(rawSynthesized);

        // Sanitize prohibited characters the model may still produce
        let synthesizedText = contentText
          .replace(/[\u2014\u2013]/g, '-')   // em dash, en dash -> hyphen
          .replace(/\u2192/g, '->')           // arrow -> text arrow
          .replace(/[\u2713\u2714\u2717\u2718]/g, '') // check/cross marks
          .replace(/\*+/g, '')                // strip asterisks
          .replace(/~/g, '')                  // strip tildes
          .replace(/^>\s?/gm, '');            // strip blockquote markers

        if (!isCover) {
          synthesizedText = synthesizedText.replace(/^\s*#\s+[^\n]*\n*/, '');
          synthesizedText = `# ${title}\n\n${synthesizedText.trimStart()}`;
        }

        updateNuggetCard(card.id, (c) => ({
          ...c,
          synthesisMap: { ...(c.synthesisMap || {}), [level]: synthesizedText },
          isSynthesizingMap: { ...(c.isSynthesizingMap || {}), [level]: false },
        }));

        return { content: synthesizedText };
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
      // Use provided signal (batch) or create a new AbortController (single card)
      let signal: AbortSignal;
      if (externalSignal) {
        signal = externalSignal;
      } else {
        const controller = createAbort();
        signal = controller.signal;
      }

      const settings = { ...menuDraftOptions };
      // Use the card's own detailLevel as authoritative — ensures batch generation
      // writes to the same key that AssetsPanel reads (card.detailLevel || activeLogicTab).
      // Falls back to toolbar level for cards without an explicit detailLevel.
      const currentLevel = card.detailLevel || settings.levelOfDetail;

      // Set generating status
      updateNuggetCard(card.id, (c) => ({
        ...c,
        isGeneratingMap: { ...(c.isGeneratingMap || {}), [currentLevel]: true },
      }));

      try {
        // Look up content at the card's level first, then fall back to the toolbar level
        const contentToMap =
          card.synthesisMap?.[currentLevel] ||
          card.synthesisMap?.[settings.levelOfDetail];

        if (!contentToMap) {
          addToast({
            type: 'warning',
            message: `No content available for "${card.text}"`,
            detail: 'Please create content for this card before generating an image.',
            duration: 6000,
          });
          return;
        }

        setCardStatus(card.id, `Generating image for [${card.text}]...`);

        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

        // Prepare reference image for the API (if applicable)
        const shouldUseRef = !!(referenceImage && useReferenceImage && !skipReferenceOnce);
        let refImagePayload: { base64: string; mimeType: string } | null = null;
        if (shouldUseRef) {
          const refUrl = referenceImage!.url;
          if (refUrl.startsWith('data:')) {
            refImagePayload = {
              base64: extractBase64(refUrl),
              mimeType: extractMime(refUrl),
            };
          } else {
            // CDN URL — fetch and convert to base64
            const resp = await fetch(refUrl);
            const blob = await resp.blob();
            const mimeType = blob.type || 'image/png';
            const buffer = await blob.arrayBuffer();
            const bytes = new Uint8Array(buffer);
            let binary = '';
            for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
            refImagePayload = { base64: btoa(binary), mimeType };
          }
        }

        // Prepare document references for the API
        const enabledDocs = resolveEnabledDocs(selectedNugget?.documents ?? []);
        const documents = enabledDocs.map((d) => ({
          fileId: d.fileId,
          name: d.name,
          sourceType: d.sourceType,
          structure: d.structure,
        }));

        // Capture fresh content screenshot for non-cover cards
        let contentScreenshot: string | undefined;
        let screenshotMimeType: string | undefined;
        if (!isCoverLevel(currentLevel as DetailLevel) && contentToMap) {
          try {
            log.info(`Capturing content screenshot for "${card.text}" [${currentLevel}]`);
            const dataUrl = await screenshotContent(contentToMap);
            const rawBase64 = dataUrl.replace(/^data:image\/[a-z]+;base64,/, '');
            contentScreenshot = rawBase64;
            screenshotMimeType = dataUrl.startsWith('data:image/jpeg') ? 'image/jpeg' : 'image/png';
            // Also update state/ref so the preview button can show it
            setLastScreenshot(dataUrl);
            log.info(`Content screenshot captured: ${Math.round(rawBase64.length / 1024)}KB (${screenshotMimeType})`);
          } catch (err: any) {
            log.warn('Screenshot capture failed, proceeding without:', err.message);
          }
        }

        // Call the server-side generate-card Edge Function
        // Pipeline: synthesis (if needed) → image gen → storage upload → DB persist
        const response = await generateCardApi({
          nuggetId: selectedNugget!.id,
          cardId: card.id,
          cardTitle: cleanCardTitle(card.text),
          detailLevel: currentLevel as DetailLevel,
          settings,
          domain: selectedNugget?.domain,
          existingSynthesis: contentToMap,
          documents,
          referenceImage: refImagePayload,
          skipSynthesis: true, // Content already synthesized
          screenshotBase64: contentScreenshot,
          screenshotMimeType,
        }, signal);

        // Update local state with the server response (album model)
        // The server already wrote albumMap/activeImageMap to the nugget JSONB,
        // but we update in-memory state so the UI reflects changes immediately.
        updateNuggetCard(card.id, (c) => {
          const existingAlbum = c.albumMap?.[currentLevel] || [];
          // Deactivate existing items
          const deactivated = existingAlbum.map((img) => ({ ...img, isActive: false }));
          // Append the new image as active
          const newAlbumItem: AlbumImage = {
            id: response.imageId,
            imageUrl: response.imageUrl,
            storagePath: response.storagePath,
            label: `Generation ${deactivated.length + 1}`,
            isActive: true,
            createdAt: Date.now(),
            sortOrder: deactivated.length,
          };
          return {
            ...c,
            albumMap: { ...(c.albumMap || {}), [currentLevel]: [...deactivated, newAlbumItem] },
            activeImageMap: { ...(c.activeImageMap || {}), [currentLevel]: response.imageUrl },
            isGeneratingMap: { ...(c.isGeneratingMap || {}), [currentLevel]: false },
            lastGeneratedContentMap: { ...(c.lastGeneratedContentMap || {}), [currentLevel]: response.synthesisContent },
            ...(response.imagePrompt ? { lastPromptMap: { ...(c.lastPromptMap || {}), [currentLevel]: response.imagePrompt } } : {}),
          };
        });
      } catch (err: any) {
        if (isAbortError(err)) return;
        log.error('Generation failed:', err);

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
      manifestCards,
      menuDraftOptions,
      referenceImage,
      useReferenceImage,
      updateNuggetCard,
      setCardStatus,
      addToast,
      selectedNugget,
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

    // Process in chunks of MAX_CONCURRENT to avoid Gemini API 502/503 errors
    const MAX_CONCURRENT = 10;
    for (let i = 0; i < selectedItems.length; i += MAX_CONCURRENT) {
      if (controller.signal.aborted) break;
      const chunk = selectedItems.slice(i, i + MAX_CONCURRENT);
      await Promise.allSettled(chunk.map((item) => generateCard(item, undefined, controller.signal)));
    }
    // Individual card statuses are cleared in generateCard's finally block
  };

  // ── Image modification handler ──

  const handleImageModified = useCallback(
    (cardId: string, newImageUrl: string, history: import('../types').ImageVersion[]) => {
      const card = findCard(selectedNugget?.cards ?? [], cardId);
      const level = card?.detailLevel || 'Standard';
      const currentContent = card?.synthesisMap?.[level] || '';

      // Build updated album: deactivate existing, add modification as new active entry
      const existingAlbum = card?.albumMap?.[level] || [];
      const deactivated = existingAlbum.map((img) => ({ ...img, isActive: false }));
      const newItem: AlbumImage = {
        id: `mod-${Date.now()}`,
        imageUrl: newImageUrl,
        storagePath: '', // Modification results are local until next server roundtrip
        label: `Modification ${deactivated.filter((i) => i.label.startsWith('Modification')).length + 1}`,
        isActive: true,
        createdAt: Date.now(),
        sortOrder: deactivated.length,
      };

      updateNuggetCard(cardId, (c) => ({
        ...c,
        albumMap: { ...(c.albumMap || {}), [level]: [...deactivated, newItem] },
        activeImageMap: { ...(c.activeImageMap || {}), [level]: newImageUrl },
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
    selectedCount,
    generateCard,
    stopGeneration,
    handleGenerateAll,
    executeBatchCardGeneration,
    handleImageModified,
    lastScreenshot,
    captureScreenshot,
  };
}
