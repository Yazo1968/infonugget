import { useState, useRef, useEffect, useMemo } from 'react';
import { DEFAULT_STYLING } from '../utils/ai';
import { flattenCards } from '../utils/cardUtils';
import type { StylingOptions, DetailLevel, CardItem } from '../types';
import { useNuggetContext } from '../context/NuggetContext';
import { useSelectionContext } from '../context/SelectionContext';

interface UseStylingParams {
  activeLogicTab: DetailLevel;
  setActiveLogicTab: (level: DetailLevel) => void;
}

export function useStylingSync({
  activeLogicTab,
  setActiveLogicTab,
}: UseStylingParams) {
  const { nuggets, selectedNuggetId, selectedNugget, updateNugget } = useNuggetContext();
  const { activeCardId, setActiveCardId, activeCard } = useSelectionContext();

  // ── State ──
  const [menuDraftOptions, setMenuDraftOptions] = useState<StylingOptions>(
    () => selectedNugget?.stylingOptions || DEFAULT_STYLING,
  );
  const skipStylingWritebackRef = useRef(false);

  // ── Derived ──
  const committedSettings = useMemo(() => {
    return selectedNugget?.stylingOptions || DEFAULT_STYLING;
  }, [selectedNugget?.stylingOptions]);

  const nuggetCards = useMemo(() => selectedNugget?.cards ?? [], [selectedNugget?.cards]);

  // ── Effects ──

  // Auto-select first card when cards exist but none is active
  useEffect(() => {
    const allCards = flattenCards(nuggetCards);
    if (allCards.length > 0 && (!activeCardId || !allCards.find((c) => c.id === activeCardId))) {
      setActiveCardId(allCards[0].id);
    }
  }, [nuggetCards, activeCardId, setActiveCardId]);

  // Sync logic tab with card's structural detail level whenever card changes
  useEffect(() => {
    if (activeCard?.detailLevel) {
      setActiveLogicTab(activeCard.detailLevel);
    }
  }, [activeCardId, activeCard?.detailLevel, setActiveLogicTab]);

  // Keep menuDraftOptions.levelOfDetail in sync with activeLogicTab
  useEffect(() => {
    setMenuDraftOptions((prev) =>
      prev.levelOfDetail !== activeLogicTab ? { ...prev, levelOfDetail: activeLogicTab } : prev,
    );
  }, [activeLogicTab]);

  // ── Nugget <-> toolbar styling sync ──
  // Read: sync toolbar FROM nugget on nugget selection change
  useEffect(() => {
    const nugget = nuggets.find((n) => n.id === selectedNuggetId);
    skipStylingWritebackRef.current = true;
    setMenuDraftOptions(nugget?.stylingOptions || DEFAULT_STYLING);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally sync only on selection change; including nuggets would re-trigger on every card generation
  }, [selectedNuggetId]);

  // Write: persist toolbar changes TO nugget (no lastModifiedAt bump — styling is a preference)
  useEffect(() => {
    if (skipStylingWritebackRef.current) {
      skipStylingWritebackRef.current = false;
      return;
    }
    if (!selectedNuggetId) return;
    updateNugget(selectedNuggetId, (n) => ({
      ...n,
      stylingOptions: menuDraftOptions,
    }));
  }, [menuDraftOptions, selectedNuggetId, updateNugget]);

  return {
    menuDraftOptions,
    setMenuDraftOptions,
    committedSettings,
    nuggetCards,
  };
}
