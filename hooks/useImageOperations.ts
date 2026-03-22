import { useState, useCallback, useRef } from 'react';
import { useNuggetContext } from '../context/NuggetContext';
import { useSelectionContext } from '../context/SelectionContext';
import { Card, DetailLevel, StylingOptions, ZoomState, ReferenceImage, AlbumImage } from '../types';
import { findCard, flattenCards, mapCardById } from '../utils/cardUtils';
import { detectSettingsMismatch } from '../utils/ai';
import { manageImagesApi } from '../utils/api';
import { extractBase64, extractMime } from '../utils/modificationEngine';
import { createLogger } from '../utils/logger';

const log = createLogger('ImageOps');
const SET_ACTIVE_DEBOUNCE_MS = 300;

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
  const [albumActionPending, setAlbumActionPending] = useState<string | null>(null);

  // Sequence counter for album browsing — prevents stale API responses from causing re-renders
  const setActiveSeqRef = useRef(0);
  const setActiveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Zoom ──

  const openZoom = useCallback(
    (imageUrl: string) => {
      const settings = committedSettings;
      const cardLevel = activeCard?.detailLevel || activeLogicTab;
      setZoomState({
        imageUrl,
        cardId: activeCard?.id || null,
        cardText: activeCard?.text || null,
        palette: settings.palette || null,
        album: activeCard?.albumMap?.[cardLevel],
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
    const cardUrl = activeCard?.activeImageMap?.[activeLogicTab];
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
    (cardId: string, newImageUrl: string, _history: any[]) => {
      if (!selectedNugget) return;
      const card = findCard(selectedNugget.cards, cardId);
      const level = card?.detailLevel || activeLogicTab;

      // Build updated album: deactivate existing, add modification as new active entry
      const existingAlbum = card?.albumMap?.[level] || [];
      const deactivated = existingAlbum.map((img) => ({ ...img, isActive: false }));
      const modLabel = `Modification ${deactivated.filter((i) => i.label.startsWith('Modification')).length + 1}`;
      const newItem: AlbumImage = {
        id: `mod-${Date.now()}`,
        imageUrl: newImageUrl,
        storagePath: '',
        label: modLabel,
        isActive: true,
        createdAt: Date.now(),
        sortOrder: deactivated.length,
      };

      // Optimistic local update — user sees the modified image immediately
      updateNugget(selectedNugget.id, (n) => ({
        ...n,
        cards: mapCardById(n.cards, cardId, (c) => ({
          ...c,
          albumMap: { ...(c.albumMap || {}), [level]: [...deactivated, newItem] },
          activeImageMap: { ...(c.activeImageMap || {}), [level]: newImageUrl },
        })),
        lastModifiedAt: Date.now(),
      }));

      // Background upload to server — persists the image to Storage + card_images table
      const nuggetId = selectedNugget.id;
      (async () => {
        try {
          const base64 = extractBase64(newImageUrl);
          const mimeType = extractMime(newImageUrl);
          const response = await manageImagesApi({
            action: 'upload_image',
            nuggetId,
            cardId,
            detailLevel: level,
            imageBase64: base64,
            imageMimeType: mimeType,
            label: modLabel,
          });
          // Reconcile: replace local mod-* entry with real server album
          if (response.album) {
            updateNugget(nuggetId, (n) => ({
              ...n,
              cards: mapCardById(n.cards, cardId, (c) => ({
                ...c,
                albumMap: { ...(c.albumMap || {}), [level]: response.album! },
                activeImageMap: {
                  ...(c.activeImageMap || {}),
                  [level]: response.activeImageUrl || c.activeImageMap?.[level] || '',
                },
              })),
            }));
          }
        } catch (err) {
          log.warn('Failed to upload modified image to server:', err);
          // Graceful degradation: local entry remains for the session
        }
      })();
    },
    [selectedNugget, updateNugget, activeLogicTab],
  );

  // ── Album browsing ──

  const handleSetActiveImage = useCallback(
    (imageId: string) => {
      if (!activeCardId || !selectedNugget) return;
      const cardId = activeCardId;
      const nuggetId = selectedNugget.id;
      const card = findCard(selectedNugget.cards, cardId);
      const level = card?.detailLevel || activeLogicTab;
      const album = card?.albumMap?.[level] || [];
      const targetImage = album.find((img) => img.id === imageId);
      if (!targetImage || targetImage.isActive) return;

      // Increment sequence — any in-flight API response with a stale seq is ignored
      const seq = ++setActiveSeqRef.current;

      // Optimistic: toggle isActive flags + update activeImageMap (instant)
      updateNugget(nuggetId, (n) => ({
        ...n,
        cards: mapCardById(n.cards, cardId, (c) => ({
          ...c,
          albumMap: {
            ...(c.albumMap || {}),
            [level]: (c.albumMap?.[level] || []).map((img) => ({
              ...img,
              isActive: img.id === imageId,
            })),
          },
          activeImageMap: { ...(c.activeImageMap || {}), [level]: targetImage.imageUrl },
        })),
        lastModifiedAt: Date.now(),
      }));

      // Debounce the API call — only the last click within the window fires
      if (setActiveTimerRef.current) clearTimeout(setActiveTimerRef.current);
      setActiveTimerRef.current = setTimeout(async () => {
        try {
          const response = await manageImagesApi({
            action: 'set_active',
            nuggetId,
            cardId,
            detailLevel: level,
            imageId,
          });
          // Only reconcile if no newer click has happened since this call fired
          if (setActiveSeqRef.current !== seq) return;
          if (response.album) {
            updateNugget(nuggetId, (n) => ({
              ...n,
              cards: mapCardById(n.cards, cardId, (c) => ({
                ...c,
                albumMap: { ...(c.albumMap || {}), [level]: response.album! },
                activeImageMap: {
                  ...(c.activeImageMap || {}),
                  [level]: response.activeImageUrl || targetImage.imageUrl,
                },
              })),
            }));
          }
        } catch (err) {
          log.warn('Failed to set active image via API:', err);
        }
      }, SET_ACTIVE_DEBOUNCE_MS);
    },
    [activeCardId, selectedNugget, activeLogicTab, updateNugget],
  );

  const handleDeleteAlbumImage = useCallback(
    async (imageId: string) => {
      if (!activeCardId || !selectedNugget) return;
      const cardForLevel = findCard(selectedNugget.cards, activeCardId);
      const level = cardForLevel?.detailLevel || activeLogicTab;
      const cardId = activeCardId;
      const nuggetId = selectedNugget.id;
      const card = findCard(selectedNugget.cards, cardId);
      const album = card?.albumMap?.[level] || [];
      const targetImage = album.find((img) => img.id === imageId);
      if (!targetImage) return;

      setAlbumActionPending(imageId);

      // Optimistic: remove image, auto-promote if was active
      const remaining = album.filter((img) => img.id !== imageId);
      let newActiveUrl: string | undefined;
      if (targetImage.isActive && remaining.length > 0) {
        const sorted = [...remaining].sort((a, b) => b.sortOrder - a.sortOrder);
        sorted[0] = { ...sorted[0], isActive: true };
        newActiveUrl = sorted[0].imageUrl;
        // Update remaining array with the promoted item
        const promotedId = sorted[0].id;
        remaining.forEach((img, i) => {
          if (img.id === promotedId) remaining[i] = { ...img, isActive: true };
        });
      } else if (!targetImage.isActive) {
        newActiveUrl = card?.activeImageMap?.[level];
      }

      updateNugget(nuggetId, (n) => ({
        ...n,
        cards: mapCardById(n.cards, cardId, (c) => {
          const newAlbumMap = { ...(c.albumMap || {}) };
          if (remaining.length > 0) {
            newAlbumMap[level] = remaining;
          } else {
            delete newAlbumMap[level];
          }
          const newActiveMap = { ...(c.activeImageMap || {}) };
          if (newActiveUrl) {
            newActiveMap[level] = newActiveUrl;
          } else if (remaining.length === 0) {
            delete newActiveMap[level];
          }
          return { ...c, albumMap: newAlbumMap, activeImageMap: newActiveMap };
        }),
        lastModifiedAt: Date.now(),
      }));

      try {
        const response = await manageImagesApi({
          action: 'delete_image',
          nuggetId,
          cardId,
          detailLevel: level,
          imageId,
        });
        // Reconcile with server response
        if (response.album) {
          updateNugget(nuggetId, (n) => ({
            ...n,
            cards: mapCardById(n.cards, cardId, (c) => ({
              ...c,
              albumMap: {
                ...(c.albumMap || {}),
                [level]: response.album!.length > 0 ? response.album! : undefined as any,
              },
              activeImageMap: {
                ...(c.activeImageMap || {}),
                [level]: response.activeImageUrl ?? '',
              },
            })),
          }));
        }
      } catch (err) {
        log.warn('Failed to delete album image via API:', err);
      } finally {
        setAlbumActionPending(null);
      }
    },
    [activeCardId, selectedNugget, activeLogicTab, updateNugget],
  );


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
    // Album browsing
    handleSetActiveImage,
    handleDeleteAlbumImage,
    albumActionPending,
    // Generation wrappers
    wrappedGenerateCard,
    wrappedExecuteBatch,
    mismatchDialog,
    setMismatchDialog,
  };
}
