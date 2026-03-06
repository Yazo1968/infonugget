import { useCallback, useMemo } from 'react';
import { useNuggetContext } from '../context/NuggetContext';
import { useProjectContext } from '../context/ProjectContext';
import { useSelectionContext } from '../context/SelectionContext';
import { Card, CardFolder, CardItem, DetailLevel, ChatMessage, Nugget, isCardFolder } from '../types';
import { resolveEnabledDocs } from '../utils/documentResolution';
import { getUniqueName } from '../utils/naming';
import { manageImagesApi } from '../utils/api';
import { createLogger } from '../utils/logger';
import {
  flattenCards,
  findCard,
  findFolder,
  mapCards,
  removeCard,
  removeCardsWhere,
  removeFolder,
  allFolderNames,
  cardNamesInScope,
} from '../utils/cardUtils';

const log = createLogger('CardOps');

/** Location of a card/folder within the card tree (root-level or inside a folder). */
export type DragLocation =
  | { type: 'root'; index: number }
  | { type: 'folder'; folderId: string; index: number };

/**
 * Card operations — selection, manipulation, creation, folder ops, and cross-nugget copy/move.
 * Extracted from App.tsx for domain separation (item 4.2).
 */
export function useCardOperations() {
  const { selectedNugget, updateNugget, updateNuggetCard, nuggets } = useNuggetContext();
  const { projects } = useProjectContext();
  const { activeCardId, setActiveCardId } = useSelectionContext();

  // ── Selection ──

  const toggleInsightsCardSelection = useCallback(
    (cardId: string) => {
      if (!selectedNugget) return;
      updateNugget(selectedNugget.id, (n) => ({
        ...n,
        cards: mapCards(n.cards, (c) => (c.id === cardId ? { ...c, selected: !c.selected } : c)),
        lastModifiedAt: Date.now(),
      }));
    },
    [selectedNugget, updateNugget],
  );

  const toggleSelectAllInsightsCards = useCallback(() => {
    if (!selectedNugget) return;
    const flat = flattenCards(selectedNugget.cards);
    const allSelected = flat.length > 0 && flat.every((c) => c.selected);
    const newSelected = !allSelected;
    updateNugget(selectedNugget.id, (n) => ({
      ...n,
      cards: mapCards(n.cards, (c) => ({ ...c, selected: newSelected })),
      lastModifiedAt: Date.now(),
    }));
  }, [selectedNugget, updateNugget]);

  const selectInsightsCardExclusive = useCallback(
    (cardId: string) => {
      if (!selectedNugget) return;
      updateNugget(selectedNugget.id, (n) => ({
        ...n,
        cards: mapCards(n.cards, (c) => ({ ...c, selected: c.id === cardId })),
        lastModifiedAt: Date.now(),
      }));
    },
    [selectedNugget, updateNugget],
  );

  const selectInsightsCardRange = useCallback(
    (fromId: string, toId: string) => {
      if (!selectedNugget) return;
      // Use flattened list for index calculation, then apply via Set
      const flat = flattenCards(selectedNugget.cards);
      const fromIdx = flat.findIndex((c) => c.id === fromId);
      const toIdx = flat.findIndex((c) => c.id === toId);
      if (fromIdx === -1 || toIdx === -1) return;
      const minIdx = Math.min(fromIdx, toIdx);
      const maxIdx = Math.max(fromIdx, toIdx);
      const selectedIds = new Set(flat.slice(minIdx, maxIdx + 1).map((c) => c.id));
      updateNugget(selectedNugget.id, (n) => ({
        ...n,
        cards: mapCards(n.cards, (c) => ({ ...c, selected: selectedIds.has(c.id) })),
        lastModifiedAt: Date.now(),
      }));
    },
    [selectedNugget, updateNugget],
  );

  const deselectAllInsightsCards = useCallback(() => {
    if (!selectedNugget) return;
    updateNugget(selectedNugget.id, (n) => ({
      ...n,
      cards: mapCards(n.cards, (c) => ({ ...c, selected: false })),
      lastModifiedAt: Date.now(),
    }));
  }, [selectedNugget, updateNugget]);

  const insightsSelectedCount = useMemo(() => {
    return flattenCards(selectedNugget?.cards ?? []).filter((c) => c.selected).length;
  }, [selectedNugget]);

  // ── Manipulation ──

  const reorderInsightsCards = useCallback(
    (fromIndex: number, toIndex: number) => {
      if (!selectedNugget || fromIndex === toIndex) return;
      const reorder = (items: CardItem[]) => {
        const next = [...items];
        const [moved] = next.splice(fromIndex, 1);
        next.splice(toIndex, 0, moved);
        return next;
      };
      updateNugget(selectedNugget.id, (n) => ({
        ...n,
        cards: reorder(n.cards),
        lastModifiedAt: Date.now(),
      }));
    },
    [selectedNugget, updateNugget],
  );

  /**
   * Reorder a card or folder across the card tree — supports root-to-root,
   * root-to-folder, folder-to-root, folder-to-folder, and within-folder moves.
   * Folders can only be placed at root level (no nesting).
   */
  const reorderCardItem = useCallback(
    (from: DragLocation, to: DragLocation, itemType: 'card' | 'folder') => {
      if (!selectedNugget) return;
      // No-op when source and target are identical
      if (from.type === to.type) {
        if (from.type === 'root' && to.type === 'root' && from.index === to.index) return;
        if (
          from.type === 'folder' &&
          to.type === 'folder' &&
          from.folderId === to.folderId &&
          from.index === to.index
        ) return;
      }
      updateNugget(selectedNugget.id, (n) => {
        const items = [...n.cards];

        // 1. Extract the item from its source location
        let movedItem: CardItem | Card | undefined;
        if (from.type === 'root') {
          [movedItem] = items.splice(from.index, 1);
        } else {
          const folderIdx = items.findIndex(
            (i) => isCardFolder(i) && i.id === from.folderId,
          );
          if (folderIdx === -1) return n;
          const folder = {
            ...(items[folderIdx] as CardFolder),
            cards: [...(items[folderIdx] as CardFolder).cards],
          };
          [movedItem] = folder.cards.splice(from.index, 1);
          items[folderIdx] = folder;
        }
        if (!movedItem) return n;

        // 2. Insert at target location
        if (to.type === 'root') {
          items.splice(to.index, 0, movedItem as CardItem);
        } else {
          const folderIdx = items.findIndex(
            (i) => isCardFolder(i) && i.id === to.folderId,
          );
          if (folderIdx === -1) return n;
          // Don't allow dropping a folder into another folder
          if (isCardFolder(movedItem)) return n;
          const folder = {
            ...(items[folderIdx] as CardFolder),
            cards: [...(items[folderIdx] as CardFolder).cards],
          };
          folder.cards.splice(to.index, 0, movedItem as Card);
          items[folderIdx] = folder;
        }

        return { ...n, cards: items, lastModifiedAt: Date.now() };
      });
    },
    [selectedNugget, updateNugget],
  );

  const deleteInsightsCard = useCallback(
    (cardId: string) => {
      if (!selectedNugget) return;
      const nuggetId = selectedNugget.id;
      updateNugget(nuggetId, (n) => ({
        ...n,
        cards: removeCard(n.cards, cardId),
        lastModifiedAt: Date.now(),
      }));
      // Cascade-delete all album images for this card
      manageImagesApi({ action: 'delete_card_albums', nuggetId, cardId }).catch((err) => {
        log.warn('Failed to cascade-delete card albums:', err);
      });
      // Fall back to first remaining card (or null)
      const remaining = flattenCards(removeCard(selectedNugget.cards, cardId));
      setActiveCardId(remaining.length > 0 ? remaining[0].id : null);
    },
    [selectedNugget, updateNugget, setActiveCardId],
  );

  const deleteSelectedInsightsCards = useCallback(() => {
    if (!selectedNugget) return;
    const nuggetId = selectedNugget.id;
    const selectedIds = new Set(flattenCards(selectedNugget.cards).filter((c) => c.selected).map((c) => c.id));
    if (selectedIds.size === 0) return;
    updateNugget(nuggetId, (n) => ({
      ...n,
      cards: removeCardsWhere(n.cards, (c) => selectedIds.has(c.id)),
      lastModifiedAt: Date.now(),
    }));
    // Cascade-delete albums for each deleted card
    for (const cardId of selectedIds) {
      manageImagesApi({ action: 'delete_card_albums', nuggetId, cardId }).catch((err) => {
        log.warn('Failed to cascade-delete card albums:', err);
      });
    }
    const remaining = flattenCards(removeCardsWhere(selectedNugget.cards, (c) => selectedIds.has(c.id)));
    setActiveCardId(remaining.length > 0 ? remaining[0].id : null);
  }, [selectedNugget, updateNugget, setActiveCardId]);

  // ── Editing ──

  const renameInsightsCard = useCallback(
    (cardId: string, newName: string) => {
      updateNuggetCard(cardId, (c) => {
        const updated: Card = { ...c, text: newName, lastEditedAt: Date.now() };
        // Sync H1 heading across all detail levels that have content
        if (c.synthesisMap) {
          const newMap = { ...c.synthesisMap };
          for (const level of Object.keys(newMap) as DetailLevel[]) {
            const content = newMap[level];
            if (!content) continue;
            // Replace existing H1 or prepend one
            const h1Match = content.match(/^(#\s+)(.+)$/m);
            if (h1Match) {
              newMap[level] = content.replace(/^#\s+.+$/m, `# ${newName}`);
            }
            // If no H1 exists, don't add one — ensureH1 in CardsPanel handles that
          }
          updated.synthesisMap = newMap;
        }
        return updated;
      });
    },
    [updateNuggetCard],
  );

  const handleSaveCardContent = useCallback(
    (cardId: string, level: DetailLevel, newContent: string) => {
      updateNuggetCard(cardId, (c) => ({
        ...c,
        synthesisMap: { ...(c.synthesisMap || {}), [level]: newContent },
        lastEditedAt: Date.now(),
      }));
    },
    [updateNuggetCard],
  );

  // ── Creation ──

  const handleCreateCustomCard = useCallback(
    (name: string) => {
      if (!selectedNugget) return;
      const newId = crypto.randomUUID();
      const existingNames = cardNamesInScope(selectedNugget.cards);
      const newCard: Card = {
        id: newId,
        level: 1,
        text: getUniqueName(name, existingNames),
        synthesisMap: { Standard: '' },
        createdAt: Date.now(),
        lastEditedAt: Date.now(),
      };
      // Add card to nugget (root level)
      updateNugget(selectedNugget.id, (n) => ({
        ...n,
        cards: [...n.cards, newCard],
        lastModifiedAt: Date.now(),
      }));
      setActiveCardId(newId);
    },
    [selectedNugget, updateNugget, setActiveCardId],
  );

  const createCustomCardInFolder = useCallback(
    (folderId: string, name: string) => {
      if (!selectedNugget) return;
      const newId = crypto.randomUUID();
      const existingNames = cardNamesInScope(selectedNugget.cards, folderId);
      const now = Date.now();
      const newCard: Card = {
        id: newId,
        level: 1,
        text: getUniqueName(name, existingNames),
        synthesisMap: { Standard: '' },
        createdAt: now,
        lastEditedAt: now,
      };
      updateNugget(selectedNugget.id, (n) => ({
        ...n,
        cards: n.cards.map((item) =>
          isCardFolder(item) && item.id === folderId
            ? { ...item, cards: [...item.cards, newCard], lastModifiedAt: now }
            : item,
        ),
        lastModifiedAt: now,
      }));
      setActiveCardId(newId);
    },
    [selectedNugget, updateNugget, setActiveCardId],
  );

  const handleSaveAsCard = useCallback(
    (message: ChatMessage, editedContent: string, targetFolderId?: string) => {
      if (!selectedNugget || selectedNugget.type !== 'insights') return;
      const content = editedContent || message.content;

      // Extract title from first # heading line, auto-increment if duplicate
      const titleMatch = content.match(/^#\s+(.+)$/m);
      const rawTitle = titleMatch ? titleMatch[1].trim() : 'Untitled Card';
      const existingCardNames = cardNamesInScope(selectedNugget.cards, targetFolderId);
      const title = getUniqueName(rawTitle, existingCardNames);

      // Remove the title line from content body
      const bodyContent = content.replace(/^#\s+.+\n*/, '').trim();

      const cardId = `card-${Math.random().toString(36).substr(2, 9)}`;
      const level = message.detailLevel || 'Standard';
      const now = Date.now();

      const activeDocNames = resolveEnabledDocs(selectedNugget.documents)
        .map((d) => d.name);

      const newCard: Card = {
        id: cardId,
        text: title,
        level: 1,
        selected: false,
        synthesisMap: { [level]: `# ${title}\n\n${bodyContent}` },
        isSynthesizingMap: {},
        detailLevel: level,
        createdAt: now,
        sourceDocuments: activeDocNames,
      };

      // Add card to folder or root + mark message as saved
      updateNugget(selectedNugget.id, (n) => ({
        ...n,
        cards: targetFolderId
          ? n.cards.map((item) =>
              isCardFolder(item) && item.id === targetFolderId
                ? { ...item, cards: [...item.cards, newCard], lastModifiedAt: now }
                : item,
            )
          : [...n.cards, newCard],
        messages: (n.messages || []).map((m) => (m.id === message.id ? { ...m, savedAsCardId: cardId } : m)),
        lastModifiedAt: now,
      }));

      // Select the new card
      setActiveCardId(cardId);
    },
    [selectedNugget, updateNugget, setActiveCardId],
  );

  // ── Placeholder lifecycle (used by all generation paths) ──

  /**
   * Insert placeholder cards into the current nugget (root level). Each card gets
   * `isSynthesizingMap: { [level]: true }` so the card list shows a spinner.
   * Returns `{ id, title }[]` so callers can map card IDs to AI calls.
   */
  const createPlaceholderCards = useCallback(
    (
      titles: string[],
      detailLevel: DetailLevel,
      options?: { sourceDocuments?: string[]; autoDeckSessionId?: string; targetFolderId?: string },
    ): { id: string; title: string }[] => {
      if (!selectedNugget || titles.length === 0) return [];

      const targetFolderId = options?.targetFolderId;
      const existingNames = cardNamesInScope(selectedNugget.cards, targetFolderId);
      const newCards: Card[] = [];
      const result: { id: string; title: string }[] = [];

      for (const rawTitle of titles) {
        const uniqueName = getUniqueName(rawTitle, [
          ...existingNames,
          ...newCards.map((c) => c.text),
        ]);
        const cardId = `card-${Math.random().toString(36).substr(2, 9)}`;

        newCards.push({
          id: cardId,
          text: uniqueName,
          level: 1,
          selected: false,
          detailLevel,
          synthesisMap: {},
          isSynthesizingMap: { [detailLevel]: true },
          createdAt: Date.now(),
          sourceDocuments: options?.sourceDocuments,
          autoDeckSessionId: options?.autoDeckSessionId,
        });
        result.push({ id: cardId, title: rawTitle });
      }

      const now = Date.now();

      if (targetFolderId) {
        // Insert placeholders into the specified folder
        updateNugget(selectedNugget.id, (n) => ({
          ...n,
          cards: n.cards.map((item) =>
            isCardFolder(item) && item.id === targetFolderId
              ? { ...item, cards: [...item.cards, ...newCards], lastModifiedAt: now }
              : item,
          ),
          lastModifiedAt: now,
        }));
      } else {
        // Add to root level (legacy / batch-handled-elsewhere path)
        updateNugget(selectedNugget.id, (n) => ({
          ...n,
          cards: [...n.cards, ...newCards],
          lastModifiedAt: now,
        }));
      }

      if (result.length > 0) {
        setActiveCardId(result[0].id);
      }

      return result;
    },
    [selectedNugget, updateNugget, setActiveCardId],
  );

  /**
   * Create a folder with placeholder cards inside. Used by batch generation (2+ cards).
   * The folder name defaults to the current nugget name with uniqueness suffix.
   * Returns `{ folderId, cards: { id, title }[] }` so callers can map card IDs to AI calls.
   */
  const createPlaceholderCardsInFolder = useCallback(
    (
      titles: string[],
      detailLevel: DetailLevel | DetailLevel[],
      options?: { sourceDocuments?: string[]; autoDeckSessionId?: string; folderName?: string },
    ): { folderId: string; cards: { id: string; title: string }[] } | null => {
      if (!selectedNugget || titles.length < 2) return null;

      const existingFolderNames = allFolderNames(selectedNugget.cards);
      const folderName = getUniqueName(
        options?.folderName || selectedNugget.name,
        existingFolderNames,
      );
      const folderId = crypto.randomUUID();
      const now = Date.now();

      const newCards: Card[] = [];
      const result: { id: string; title: string }[] = [];

      // New folder — only check uniqueness among siblings being created
      for (let i = 0; i < titles.length; i++) {
        const rawTitle = titles[i];
        const level = Array.isArray(detailLevel) ? detailLevel[i] : detailLevel;
        const uniqueName = getUniqueName(rawTitle, newCards.map((c) => c.text));
        const cardId = `card-${Math.random().toString(36).substr(2, 9)}`;

        newCards.push({
          id: cardId,
          text: uniqueName,
          level: 1,
          selected: false,
          detailLevel: level,
          synthesisMap: {},
          isSynthesizingMap: { [level]: true },
          createdAt: now,
          sourceDocuments: options?.sourceDocuments,
          autoDeckSessionId: options?.autoDeckSessionId,
        });
        result.push({ id: cardId, title: rawTitle });
      }

      const folder: CardFolder = {
        kind: 'folder',
        id: folderId,
        name: folderName,
        cards: newCards,
        collapsed: false,
        createdAt: now,
        lastModifiedAt: now,
        autoDeckSessionId: options?.autoDeckSessionId,
      };

      updateNugget(selectedNugget.id, (n) => ({
        ...n,
        cards: [...n.cards, folder],
        lastModifiedAt: now,
      }));

      if (result.length > 0) {
        setActiveCardId(result[0].id);
      }

      return { folderId, cards: result };
    },
    [selectedNugget, updateNugget, setActiveCardId],
  );

  /**
   * Fill a placeholder card with generated content.
   * Turns off the synthesis spinner and populates synthesisMap.
   */
  const fillPlaceholderCard = useCallback(
    (cardId: string, detailLevel: DetailLevel, content: string, newTitle?: string) => {
      updateNuggetCard(cardId, (c) => ({
        ...c,
        ...(newTitle ? { text: newTitle } : {}),
        synthesisMap: { ...(c.synthesisMap || {}), [detailLevel]: content },
        isSynthesizingMap: { ...(c.isSynthesizingMap || {}), [detailLevel]: false },
        lastEditedAt: Date.now(),
      }));
    },
    [updateNuggetCard],
  );

  /**
   * Remove a placeholder card on error (only if it still has no content).
   * Searches inside folders too.
   */
  const removePlaceholderCard = useCallback(
    (cardId: string, detailLevel: DetailLevel) => {
      if (!selectedNugget) return;
      const card = findCard(selectedNugget.cards, cardId);
      if (!card || card.synthesisMap?.[detailLevel]) return;

      updateNugget(selectedNugget.id, (n) => ({
        ...n,
        cards: removeCard(n.cards, cardId),
        lastModifiedAt: Date.now(),
      }));
    },
    [selectedNugget, updateNugget],
  );

  // ── Folder operations ──

  const createEmptyFolder = useCallback(
    (name: string): string | null => {
      if (!selectedNugget) return null;
      const now = Date.now();
      const existingFolderNames = allFolderNames(selectedNugget.cards);
      const uniqueName = getUniqueName(name, existingFolderNames);
      const folderId = crypto.randomUUID();
      const newFolder: CardFolder = {
        kind: 'folder',
        id: folderId,
        name: uniqueName,
        cards: [],
        collapsed: false,
        createdAt: now,
        lastModifiedAt: now,
      };
      updateNugget(selectedNugget.id, (n) => ({
        ...n,
        cards: [newFolder, ...n.cards],
        lastModifiedAt: now,
      }));
      return folderId;
    },
    [selectedNugget, updateNugget],
  );

  const renameFolder = useCallback(
    (folderId: string, newName: string) => {
      if (!selectedNugget) return;
      updateNugget(selectedNugget.id, (n) => ({
        ...n,
        cards: n.cards.map((item) =>
          isCardFolder(item) && item.id === folderId
            ? { ...item, name: newName, lastModifiedAt: Date.now() }
            : item,
        ),
        lastModifiedAt: Date.now(),
      }));
    },
    [selectedNugget, updateNugget],
  );

  const deleteFolder = useCallback(
    (folderId: string) => {
      if (!selectedNugget) return;
      const nuggetId = selectedNugget.id;
      // If active card is inside this folder, clear it
      const folder = selectedNugget.cards.find(
        (item): item is CardFolder => isCardFolder(item) && item.id === folderId,
      );
      const folderCardIds = folder ? new Set(folder.cards.map((c) => c.id)) : new Set<string>();

      updateNugget(nuggetId, (n) => ({
        ...n,
        cards: removeFolder(n.cards, folderId),
        lastModifiedAt: Date.now(),
      }));

      // Cascade-delete albums for each card in the folder
      for (const cardId of folderCardIds) {
        manageImagesApi({ action: 'delete_card_albums', nuggetId, cardId }).catch((err) => {
          log.warn('Failed to cascade-delete card albums:', err);
        });
      }

      if (activeCardId && folderCardIds.has(activeCardId)) {
        const remaining = flattenCards(removeFolder(selectedNugget.cards, folderId));
        setActiveCardId(remaining.length > 0 ? remaining[0].id : null);
      }
    },
    [selectedNugget, updateNugget, activeCardId, setActiveCardId],
  );

  const duplicateFolder = useCallback(
    (folderId: string) => {
      if (!selectedNugget) return;
      const folder = selectedNugget.cards.find(
        (item): item is CardFolder => isCardFolder(item) && item.id === folderId,
      );
      if (!folder) return;

      const now = Date.now();
      const existingFolderNames = allFolderNames(selectedNugget.cards);
      // Card names only need to be unique within the new folder copy
      const usedNames: string[] = [];

      const newFolder: CardFolder = {
        kind: 'folder',
        id: crypto.randomUUID(),
        name: getUniqueName(folder.name, existingFolderNames),
        cards: folder.cards.map((c) => {
          const uniqueName = getUniqueName(c.text, usedNames);
          usedNames.push(uniqueName);
          return {
            ...c,
            id: `card-${Math.random().toString(36).substr(2, 9)}`,
            text: uniqueName,
            selected: false,
            createdAt: now,
            lastEditedAt: now,
          };
        }),
        collapsed: false,
        createdAt: now,
        lastModifiedAt: now,
        autoDeckSessionId: folder.autoDeckSessionId,
      };

      updateNugget(selectedNugget.id, (n) => {
        // Insert copy right after the original folder
        const idx = n.cards.findIndex((item) => isCardFolder(item) && item.id === folderId);
        const items = [...n.cards];
        items.splice(idx + 1, 0, newFolder);
        return { ...n, cards: items, lastModifiedAt: now };
      });
    },
    [selectedNugget, updateNugget],
  );

  const toggleFolderCollapsed = useCallback(
    (folderId: string) => {
      if (!selectedNugget) return;
      updateNugget(selectedNugget.id, (n) => ({
        ...n,
        cards: n.cards.map((item) =>
          isCardFolder(item) && item.id === folderId
            ? { ...item, collapsed: !item.collapsed }
            : item,
        ),
      }));
    },
    [selectedNugget, updateNugget],
  );

  const toggleFolderSelection = useCallback(
    (folderId: string) => {
      if (!selectedNugget) return;
      const folder = selectedNugget.cards.find(
        (item): item is CardFolder => isCardFolder(item) && item.id === folderId,
      );
      if (!folder) return;
      const allSelected = folder.cards.length > 0 && folder.cards.every((c) => c.selected);
      const newSelected = !allSelected;

      updateNugget(selectedNugget.id, (n) => ({
        ...n,
        cards: n.cards.map((item) =>
          isCardFolder(item) && item.id === folderId
            ? { ...item, cards: item.cards.map((c) => ({ ...c, selected: newSelected })) }
            : item,
        ),
        lastModifiedAt: Date.now(),
      }));
    },
    [selectedNugget, updateNugget],
  );

  // ── Cross-nugget copy/move ──

  const handleCopyMoveCard = useCallback(
    (cardId: string, targetNuggetId: string, mode: 'copy' | 'move') => {
      if (!selectedNugget) return;
      const card = findCard(selectedNugget.cards, cardId);
      if (!card) return;
      const targetNugget = nuggets.find((n) => n.id === targetNuggetId);
      // Find the target folder to scope uniqueness within it
      const targetFirstFolder = (targetNugget?.cards ?? []).find(
        (item): item is CardFolder => isCardFolder(item),
      );
      const targetScopeNames = targetFirstFolder
        ? cardNamesInScope(targetNugget?.cards ?? [], targetFirstFolder.id)
        : []; // New "Imported" folder — no existing names
      const uniqueName = getUniqueName(card.text, targetScopeNames);
      const now = Date.now();
      const newCardId = `card-${Math.random().toString(36).substr(2, 9)}`;
      const copiedCard: Card = {
        ...card,
        id: newCardId,
        text: uniqueName,
        selected: false,
        createdAt: now,
        lastEditedAt: now,
      };
      // Add to first folder in target nugget (or create "Imported" folder if none exist)
      updateNugget(targetNuggetId, (n) => {
        const firstFolder = n.cards.find((item): item is CardFolder => isCardFolder(item));
        if (firstFolder) {
          return {
            ...n,
            cards: n.cards.map((item) =>
              isCardFolder(item) && item.id === firstFolder.id
                ? { ...item, cards: [...item.cards, copiedCard], lastModifiedAt: now }
                : item,
            ),
            lastModifiedAt: now,
          };
        }
        // No folders — create an "Imported" folder
        const newFolder: CardFolder = {
          kind: 'folder',
          id: crypto.randomUUID(),
          name: 'Imported',
          cards: [copiedCard],
          collapsed: false,
          createdAt: now,
          lastModifiedAt: now,
        };
        return {
          ...n,
          cards: [...n.cards, newFolder],
          lastModifiedAt: now,
        };
      });
      // If move, also remove from source nugget
      if (mode === 'move') {
        updateNugget(selectedNugget.id, (n) => ({
          ...n,
          cards: removeCard(n.cards, cardId),
          lastModifiedAt: now,
        }));
        // Fall back to first remaining card
        if (activeCardId === cardId) {
          const remaining = flattenCards(removeCard(selectedNugget.cards, cardId));
          setActiveCardId(remaining.length > 0 ? remaining[0].id : null);
        }
      }
    },
    [selectedNugget, nuggets, updateNugget, activeCardId, setActiveCardId],
  );

  const handleCopyMoveFolder = useCallback(
    (folderId: string, targetNuggetId: string, mode: 'copy' | 'move') => {
      if (!selectedNugget) return;
      const folder = findFolder(selectedNugget.cards, folderId);
      if (!folder) return;
      const targetNugget = nuggets.find((n) => n.id === targetNuggetId);
      const targetFolderNames = targetNugget ? allFolderNames(targetNugget.cards) : [];
      const now = Date.now();
      // Cards in copied folder only need uniqueness among themselves
      const usedNames: string[] = [];

      const newFolder: CardFolder = {
        kind: 'folder',
        id: crypto.randomUUID(),
        name: getUniqueName(folder.name, targetFolderNames),
        cards: folder.cards.map((c) => {
          const uniqueName = getUniqueName(c.text, usedNames);
          usedNames.push(uniqueName);
          return {
            ...c,
            id: `card-${Math.random().toString(36).substr(2, 9)}`,
            text: uniqueName,
            selected: false,
            createdAt: now,
            lastEditedAt: now,
          };
        }),
        collapsed: false,
        createdAt: now,
        lastModifiedAt: now,
        autoDeckSessionId: folder.autoDeckSessionId,
      };

      // Add folder to target nugget
      updateNugget(targetNuggetId, (n) => ({
        ...n,
        cards: [...n.cards, newFolder],
        lastModifiedAt: now,
      }));

      // If move, remove from source nugget
      if (mode === 'move') {
        updateNugget(selectedNugget.id, (n) => ({
          ...n,
          cards: removeFolder(n.cards, folderId),
          lastModifiedAt: now,
        }));
        // If active card was inside the moved folder, clear selection
        if (activeCardId && folder.cards.some((c) => c.id === activeCardId)) {
          const remaining = flattenCards(removeFolder(selectedNugget.cards, folderId));
          setActiveCardId(remaining.length > 0 ? remaining[0].id : null);
        }
      }
    },
    [selectedNugget, nuggets, updateNugget, activeCardId, setActiveCardId],
  );

  return {
    // Selection
    toggleInsightsCardSelection,
    toggleSelectAllInsightsCards,
    selectInsightsCardExclusive,
    selectInsightsCardRange,
    deselectAllInsightsCards,
    insightsSelectedCount,
    // Manipulation
    reorderInsightsCards,
    reorderCardItem,
    deleteInsightsCard,
    deleteSelectedInsightsCards,
    // Editing
    renameInsightsCard,
    handleSaveCardContent,
    // Creation
    handleCreateCustomCard,
    createCustomCardInFolder,
    handleSaveAsCard,
    // Cross-nugget
    handleCopyMoveCard,
    handleCopyMoveFolder,
    // Placeholder lifecycle
    createPlaceholderCards,
    createPlaceholderCardsInFolder,
    fillPlaceholderCard,
    removePlaceholderCard,
    // Folder operations
    createEmptyFolder,
    renameFolder,
    deleteFolder,
    duplicateFolder,
    toggleFolderCollapsed,
    toggleFolderSelection,
  };
}
