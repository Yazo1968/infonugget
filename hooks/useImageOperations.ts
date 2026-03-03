import { useState, useCallback } from 'react';
import JSZip from 'jszip';
import { useNuggetContext } from '../context/NuggetContext';
import { useSelectionContext } from '../context/SelectionContext';
import { Card, DetailLevel, StylingOptions, ZoomState, ReferenceImage } from '../types';
import { findCard, findParentFolder, flattenCards, mapCards, mapCardById } from '../utils/cardUtils';
import { detectSettingsMismatch } from '../utils/ai';
import { manageImagesApi } from '../utils/api';
import { createLogger } from '../utils/logger';

const log = createLogger('ImageOps');

export interface UseImageOperationsParams {
  activeCard: Card | null;
  activeLogicTab: DetailLevel;
  committedSettings: StylingOptions;
  menuDraftOptions: StylingOptions;
  referenceImage: ReferenceImage | null;
  setReferenceImage: React.Dispatch<React.SetStateAction<ReferenceImage | null>>;
  useReferenceImage: boolean;
  setUseReferenceImage: React.Dispatch<React.SetStateAction<boolean>>;
  generateCard: (card: Card, skipReference?: boolean) => Promise<void>;
  executeBatchCardGeneration: () => Promise<void>;
}

/**
 * Image operations — zoom, reference image, card image CRUD, downloads, generation wrappers.
 * Extracted from App.tsx for domain separation (item 4.2).
 */
export function useImageOperations({
  activeCard,
  activeLogicTab,
  committedSettings,
  menuDraftOptions,
  referenceImage,
  setReferenceImage,
  useReferenceImage,
  setUseReferenceImage,
  generateCard,
  executeBatchCardGeneration,
}: UseImageOperationsParams) {
  const { selectedNugget, updateNugget } = useNuggetContext();
  const { activeCardId } = useSelectionContext();

  // ── Private state ──
  const [zoomState, setZoomState] = useState<ZoomState>({ imageUrl: null, cardId: null, cardText: null });
  const [mismatchDialog, setMismatchDialog] = useState<{
    resolve: (decision: 'disable' | 'skip' | 'cancel') => void;
  } | null>(null);

  // ── Zoom ──

  const openZoom = useCallback(
    (imageUrl: string) => {
      const settings = committedSettings;
      setZoomState({
        imageUrl,
        cardId: activeCard?.id || null,
        cardText: activeCard?.text || null,
        palette: settings.palette || null,
        imageHistory: activeCard?.imageHistoryMap?.[activeLogicTab],
        aspectRatio: settings.aspectRatio,
        resolution: settings.resolution,
      });
    },
    [activeCard, committedSettings, activeLogicTab],
  );

  const closeZoom = useCallback(() => {
    setZoomState({ imageUrl: null, cardId: null, cardText: null });
  }, []);

  // ── Reference image ──

  const handleStampReference = useCallback(() => {
    const cardUrl = activeCard?.cardUrlMap?.[activeLogicTab];
    if (!cardUrl) return;
    setReferenceImage({ url: cardUrl, settings: { ...menuDraftOptions } });
    setUseReferenceImage(true);
  }, [activeCard, activeLogicTab, menuDraftOptions, setReferenceImage, setUseReferenceImage]);

  const handleReferenceImageModified = useCallback((newImageUrl: string) => {
    setReferenceImage((prev) => (prev ? { ...prev, url: newImageUrl } : prev));
  }, [setReferenceImage]);

  const handleDeleteReference = useCallback(() => {
    setReferenceImage(null);
    setUseReferenceImage(false);
  }, [setReferenceImage, setUseReferenceImage]);

  // ── Card image CRUD ──

  const handleInsightsImageModified = useCallback(
    (cardId: string, newImageUrl: string, history: any[]) => {
      if (!selectedNugget) return;
      const card = findCard(selectedNugget.cards, cardId);
      const level = card?.detailLevel || activeLogicTab;

      updateNugget(selectedNugget.id, (n) => ({
        ...n,
        cards: mapCardById(n.cards, cardId, (c) => ({
          ...c,
          cardUrlMap: { ...(c.cardUrlMap || {}), [level]: newImageUrl },
          imageHistoryMap: { ...(c.imageHistoryMap || {}), [level]: history },
        })),
        lastModifiedAt: Date.now(),
      }));
    },
    [selectedNugget, updateNugget, activeLogicTab],
  );

  const handleDeleteCardImage = useCallback(() => {
    if (!activeCardId || !selectedNugget) return;
    const level = activeLogicTab;
    const cardId = activeCardId;
    const nuggetId = selectedNugget.id;
    // Optimistic local update: clear current image, preserve history
    updateNugget(nuggetId, (n) => ({
      ...n,
      cards: mapCardById(n.cards, cardId, (c) => {
        const newUrlMap = { ...(c.cardUrlMap || {}) };
        delete newUrlMap[level];
        return { ...c, cardUrlMap: newUrlMap };
      }),
      lastModifiedAt: Date.now(),
    }));
    // Persist to backend via Edge Function
    manageImagesApi({ action: 'delete_active', nuggetId, cardId, detailLevel: level }).catch((err) => {
      log.warn('Failed to delete active image via API:', err);
    });
  }, [activeCardId, selectedNugget, activeLogicTab, updateNugget]);

  const handleDeleteCardVersions = useCallback(() => {
    if (!activeCardId || !selectedNugget) return;
    const level = activeLogicTab;
    const nuggetId = selectedNugget.id;
    const cardId = activeCardId;
    const cardUpdater = (c: Card) => {
      const newUrlMap = { ...(c.cardUrlMap || {}) };
      delete newUrlMap[level];
      const newHistoryMap = { ...(c.imageHistoryMap || {}) };
      delete newHistoryMap[level];
      const newPlanMap = { ...(c.visualPlanMap || {}) };
      delete newPlanMap[level];
      const newPromptMap = { ...(c.lastPromptMap || {}) };
      delete newPromptMap[level];
      const newGenContentMap = { ...(c.lastGeneratedContentMap || {}) };
      delete newGenContentMap[level];
      return {
        ...c,
        cardUrlMap: newUrlMap,
        imageHistoryMap: newHistoryMap,
        visualPlanMap: newPlanMap,
        lastPromptMap: newPromptMap,
        lastGeneratedContentMap: newGenContentMap,
      };
    };
    // Optimistic local update
    updateNugget(nuggetId, (n) => ({
      ...n,
      cards: mapCardById(n.cards, cardId, cardUpdater),
      lastModifiedAt: Date.now(),
    }));
    // Persist via Edge Function (deletes storage files + DB row)
    manageImagesApi({ action: 'delete_versions', nuggetId, cardId, detailLevel: level }).catch((err) => {
      log.warn('Failed to delete versions via API:', err);
    });
  }, [activeCardId, selectedNugget, activeLogicTab, updateNugget]);

  const handleDeleteAllCardImages = useCallback(() => {
    if (!selectedNugget) return;
    const level = activeLogicTab;
    const nuggetId = selectedNugget.id;
    // Optimistic local update: clear all cards' image data at this level
    updateNugget(nuggetId, (n) => ({
      ...n,
      cards: mapCards(n.cards, (c) => {
        const newUrlMap = { ...(c.cardUrlMap || {}) };
        delete newUrlMap[level];
        const newHistoryMap = { ...(c.imageHistoryMap || {}) };
        delete newHistoryMap[level];
        const newPlanMap = { ...(c.visualPlanMap || {}) };
        delete newPlanMap[level];
        const newPromptMap = { ...(c.lastPromptMap || {}) };
        delete newPromptMap[level];
        const newGenContentMap = { ...(c.lastGeneratedContentMap || {}) };
        delete newGenContentMap[level];
        return {
          ...c,
          cardUrlMap: newUrlMap,
          imageHistoryMap: newHistoryMap,
          visualPlanMap: newPlanMap,
          lastPromptMap: newPromptMap,
          lastGeneratedContentMap: newGenContentMap,
        };
      }),
      lastModifiedAt: Date.now(),
    }));
    // Persist via Edge Function (deletes all storage files + DB rows at this level)
    manageImagesApi({ action: 'delete_all', nuggetId, detailLevel: level }).catch((err) => {
      log.warn('Failed to delete all images via API:', err);
    });
  }, [selectedNugget, activeLogicTab, updateNugget]);

  // ── Downloads ──

  const downloadDataUrl = useCallback((dataUrl: string, filename: string) => {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    a.click();
  }, []);

  const handleDownloadImage = useCallback(() => {
    const url = activeCard?.cardUrlMap?.[activeLogicTab];
    if (!url) return;
    const slug = activeCard!.text
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase()
      .slice(0, 40);
    downloadDataUrl(url, `${slug}-${activeLogicTab.toLowerCase()}.png`);
  }, [activeCard, activeLogicTab, downloadDataUrl]);

  const handleDownloadSelectedImages = useCallback(async () => {
    if (!selectedNugget || !activeCardId) return;

    // Find the folder containing the active card
    const parentFolder = findParentFolder(selectedNugget.cards, activeCardId);
    if (!parentFolder) {
      // Card is at root level — fall back to single card download
      handleDownloadImage();
      return;
    }

    // Collect all cards in the folder that have an image at the current detail level
    const cardsWithImages = parentFolder.cards.filter(
      (c) => c.cardUrlMap?.[activeLogicTab],
    );
    if (cardsWithImages.length === 0) return;

    const slugify = (text: string) =>
      text
        .replace(/[^a-zA-Z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .toLowerCase()
        .slice(0, 40);

    // Build zip
    const zip = new JSZip();
    for (const card of cardsWithImages) {
      const dataUrl = card.cardUrlMap![activeLogicTab]!;
      // Strip "data:image/png;base64," prefix to get raw base64
      const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
      const filename = `${slugify(card.text)}-${activeLogicTab.toLowerCase()}.png`;
      zip.file(filename, base64, { base64: true });
    }

    const blob = await zip.generateAsync({ type: 'blob' });
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = `${slugify(parentFolder.name)}.zip`;
    a.click();
    URL.revokeObjectURL(blobUrl);
  }, [selectedNugget, activeCardId, activeLogicTab, handleDownloadImage]);

  // ── Generation wrappers (mismatch detection) ──

  const showMismatchDialog = useCallback(() => {
    return new Promise<'disable' | 'skip' | 'cancel'>((resolve) => {
      setMismatchDialog({ resolve });
    });
  }, []);

  const wrappedGenerateCard = useCallback(
    async (card: Card) => {
      if (referenceImage && useReferenceImage) {
        if (detectSettingsMismatch(menuDraftOptions, referenceImage.settings)) {
          const decision = await showMismatchDialog();
          if (decision === 'cancel') return;
          if (decision === 'disable') setUseReferenceImage(false);
          if (decision === 'disable' || decision === 'skip') {
            await generateCard(card, true);
            return;
          }
        }
      }
      await generateCard(card);
    },
    [referenceImage, useReferenceImage, menuDraftOptions, generateCard, showMismatchDialog, setUseReferenceImage],
  );

  const wrappedExecuteBatch = useCallback(async () => {
    if (referenceImage && useReferenceImage) {
      if (detectSettingsMismatch(menuDraftOptions, referenceImage.settings)) {
        const decision = await showMismatchDialog();
        if (decision === 'cancel') return;
        if (decision === 'disable') setUseReferenceImage(false);
      }
    }
    await executeBatchCardGeneration();
  }, [referenceImage, useReferenceImage, menuDraftOptions, executeBatchCardGeneration, showMismatchDialog, setUseReferenceImage]);

  return {
    // Zoom
    zoomState,
    setZoomState,
    openZoom,
    closeZoom,
    // Reference image
    handleStampReference,
    handleReferenceImageModified,
    handleDeleteReference,
    // Card image CRUD
    handleInsightsImageModified,
    handleDeleteCardImage,
    handleDeleteCardVersions,
    handleDeleteAllCardImages,
    // Downloads
    handleDownloadImage,
    handleDownloadSelectedImages,
    // Generation wrappers
    wrappedGenerateCard,
    wrappedExecuteBatch,
    mismatchDialog,
    setMismatchDialog,
  };
}
