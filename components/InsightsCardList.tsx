import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Card, CardItem, CardFolder, DetailLevel, isCoverLevel, isCardFolder } from '../types';
import { flattenCards, findCard, findParentFolder, cardNamesInScope } from '../utils/cardUtils';
import { isNameTaken } from '../utils/naming';
import { formatTimestampFull } from '../utils/formatTime';
import { DragLocation } from '../hooks/useCardOperations';
import PanelRequirements from './PanelRequirements';
import CardRow from './CardRow';
import FolderRow from './FolderRow';

interface InsightsCardListProps {
  cards: CardItem[];
  activeCardId: string | null;
  onCardClick: (id: string) => void;
  onCardDoubleClick?: (id: string) => void;
  onToggleSelection: (id: string) => void;
  onSelectExclusive: (id: string) => void;
  onSelectRange: (fromId: string, toId: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onDeleteCard: (id: string) => void;
  onDeleteSelectedCards: () => void;
  onRenameCard: (id: string, newName: string) => void;
  // Copy/Move
  onCopyMoveCard?: (cardId: string, targetNuggetId: string, mode: 'copy' | 'move') => void;
  otherNuggets?: { id: string; name: string }[];
  projectNuggets?: { projectId: string; projectName: string; nuggets: { id: string; name: string }[] }[];
  /** The active detail level from the parent — used to look up synthesisMap/activeImageMap for Card Info */
  activeDetailLevel?: DetailLevel;
  onGenerateCardImage?: (card: Card) => void;
  onGenerateBatchCards?: (cards: Card[]) => void;
  onReorderCards?: (fromIndex: number, toIndex: number) => void;
  onReorderCardItem?: (from: DragLocation, to: DragLocation, itemType: 'card' | 'folder') => void;
  // Folder callbacks
  onToggleFolderCollapsed?: (folderId: string) => void;
  onToggleFolderSelection?: (folderId: string) => void;
  onRenameFolder?: (folderId: string, newName: string) => void;
  onDeleteFolder?: (folderId: string) => void;
  onDuplicateFolder?: (folderId: string) => void;
  onCopyMoveFolder?: (folderId: string, targetNuggetId: string, mode: 'copy' | 'move') => void;
  onDownloadContent?: (folderId: string) => void;
  onExportImages?: (folderId: string) => void;
  onCreateEmptyFolder?: () => void;
  onCreateCustomCardInFolder?: (folderId: string, name: string) => void;
}

// -- Inline info content used inside the hover submenu --

interface InfoContentProps {
  card: Card;
  level: DetailLevel;
}

const InfoContent: React.FC<InfoContentProps> = ({ card, level }) => {
  // Album image count and last image timestamp
  const album = card.albumMap?.[level];
  const versionCount = album ? album.length : 0;
  const lastImageTs = album && album.length > 0 ? album[album.length - 1].createdAt : undefined;

  // Image staleness: red if content was modified after the last image generation
  const lastModifiedTs = card.lastEditedAt && card.lastEditedAt !== card.createdAt ? card.lastEditedAt : undefined;
  const imageStale = !!(lastImageTs && lastModifiedTs && lastModifiedTs > lastImageTs);

  return (
    <>
      {/* Header */}
      <div className="px-3 py-2 border-b border-zinc-100 dark:border-zinc-600 flex items-center justify-between">
        <p className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Card Info</p>
        {(() => {
          const cardLevel = card.detailLevel || 'Standard';
          const isCover = isCoverLevel(cardLevel);
          const isDirect = cardLevel === 'DirectContent';
          const label =
            cardLevel === 'TitleCard'
              ? 'Title Card'
              : cardLevel === 'TakeawayCard'
                ? 'Takeaway Card'
                : cardLevel === 'DirectContent'
                  ? 'Direct'
                  : cardLevel;
          return (
            <span
              className={`text-[8px] font-bold uppercase tracking-wider px-1.5 py-[2px] rounded ${
                isCover
                  ? 'text-violet-600 bg-violet-50'
                  : isDirect
                    ? 'text-emerald-600 bg-emerald-50'
                    : 'text-zinc-500 bg-zinc-100'
              }`}
            >
              {label}
            </span>
          );
        })()}
      </div>

      {/* Info rows */}
      <div className="px-3 py-2.5 space-y-2">
        {/* Content generated */}
        <div className="flex items-baseline justify-between">
          <span className="text-[10px] text-zinc-500 dark:text-zinc-400">Content generated</span>
          <span className="text-[10px] text-zinc-600 dark:text-zinc-400">
            {card.createdAt ? formatTimestampFull(card.createdAt) : '—'}
          </span>
        </div>

        {/* Content last modified */}
        <div className="flex items-baseline justify-between">
          <span className="text-[10px] text-zinc-500 dark:text-zinc-400">Content last modified</span>
          <span className="text-[10px] text-zinc-600 dark:text-zinc-400">
            {card.lastEditedAt && card.lastEditedAt !== card.createdAt ? formatTimestampFull(card.lastEditedAt) : '—'}
          </span>
        </div>

        {/* Divider */}
        <div className="border-t border-zinc-100 dark:border-zinc-600" />

        {/* Image versions */}
        <div className="flex items-baseline justify-between">
          <span className="text-[10px] text-zinc-500 dark:text-zinc-400">Image versions</span>
          <span className="text-[10px] text-zinc-600 dark:text-zinc-400">{versionCount > 0 ? versionCount : '—'}</span>
        </div>

        {/* Last image generated — red if stale, green if fresh */}
        <div className="flex items-baseline justify-between">
          <span className="text-[10px] text-zinc-500 dark:text-zinc-400">Last image generated</span>
          <span
            className={`text-[10px] font-medium ${lastImageTs ? (imageStale ? 'text-red-500' : 'text-green-600') : 'text-zinc-600'}`}
          >
            {lastImageTs ? formatTimestampFull(lastImageTs) : '—'}
          </span>
        </div>

        {/* Divider */}
        <div className="border-t border-zinc-100 dark:border-zinc-600" />

        {/* Source documents */}
        {card.sourceDocuments && card.sourceDocuments.length > 0 ? (
          <>
            <div>
              <span className="text-[10px] text-zinc-500 dark:text-zinc-400">Sources</span>
            </div>
            <div className="space-y-1">
              {card.sourceDocuments.map((name, i) => (
                <div
                  key={i}
                  className="flex items-center gap-1.5 text-[10px] text-zinc-600 dark:text-zinc-400"
                  title={name}
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="shrink-0 text-zinc-500 dark:text-zinc-400"
                  >
                    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                  <span className="truncate">{name}</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="flex items-baseline justify-between">
            <span className="text-[10px] text-zinc-500 dark:text-zinc-400">Sources</span>
            <span className="text-[10px] text-zinc-600 dark:text-zinc-400">—</span>
          </div>
        )}
      </div>
    </>
  );
};

/** A single visible row in the card list, mapped to its DragLocation for hit-testing. */
type VisibleItem = {
  type: 'card' | 'folder-header';
  loc: DragLocation;
  label: string;
  isFolder?: boolean;
  folderId?: string; // set on folder-header rows for drop-into-folder detection
};

// -- Main component --

const InsightsCardList: React.FC<InsightsCardListProps> = ({
  cards,
  activeCardId,
  onCardClick,
  onCardDoubleClick,
  onToggleSelection,
  onSelectExclusive: _onSelectExclusive,
  onSelectRange: _onSelectRange,
  onSelectAll,
  onDeselectAll,
  onDeleteCard,
  onDeleteSelectedCards,
  onRenameCard,
  onCopyMoveCard,
  otherNuggets,
  projectNuggets,
  activeDetailLevel,
  onGenerateCardImage,
  onGenerateBatchCards,
  onReorderCards,
  onReorderCardItem,
  onToggleFolderCollapsed,
  onToggleFolderSelection,
  onRenameFolder,
  onDeleteFolder,
  onDuplicateFolder,
  onCopyMoveFolder,
  onDownloadContent,
  onExportImages,
  onCreateEmptyFolder,
  onCreateCustomCardInFolder,
}) => {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; cardId: string } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState('');
  const [showInfoSubmenu, setShowInfoSubmenu] = useState(false);
  const [showCopyMoveSubmenu, setShowCopyMoveSubmenu] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmDeleteSelected, setConfirmDeleteSelected] = useState(false);
  // Folder state
  const [folderContextMenu, setFolderContextMenu] = useState<{ x: number; y: number; folderId: string } | null>(null);
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [folderRenameValue, setFolderRenameValue] = useState('');
  const [folderRenameError, setFolderRenameError] = useState('');
  const [confirmDeleteFolderId, setConfirmDeleteFolderId] = useState<string | null>(null);
  const [showFolderCopyMoveSubmenu, setShowFolderCopyMoveSubmenu] = useState(false);
  // Add card to folder dialog
  const [addCardToFolderId, setAddCardToFolderId] = useState<string | null>(null);
  const [newCardInFolderName, setNewCardInFolderName] = useState('');
  const newCardInFolderInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const folderMenuRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const folderRenameInputRef = useRef<HTMLInputElement>(null);

  const allCards = useMemo(() => flattenCards(cards), [cards]);
  const selectedCount = useMemo(() => allCards.filter((c) => c.selected).length, [allCards]);

  // ── Folder-aware drag-and-drop reordering ──

  // Build a flat list of visible rows with their DragLocations for hit-testing
  const visibleItems = useMemo((): VisibleItem[] => {
    const result: VisibleItem[] = [];
    cards.forEach((item, topIdx) => {
      if (isCardFolder(item)) {
        result.push({
          type: 'folder-header',
          loc: { type: 'root', index: topIdx },
          label: item.name,
          isFolder: true,
          folderId: item.id,
        });
        if (!item.collapsed) {
          item.cards.forEach((card, cardIdx) => {
            result.push({
              type: 'card',
              loc: { type: 'folder', folderId: item.id, index: cardIdx },
              label: card.text,
            });
          });
        }
      } else {
        result.push({
          type: 'card',
          loc: { type: 'root', index: topIdx },
          label: item.text,
        });
      }
    });
    return result;
  }, [cards]);

  const listRef = useRef<HTMLDivElement>(null);

  // Stable refs for drag handlers — avoids recreating callbacks on every cards change
  const visibleItemsRef = useRef(visibleItems);
  visibleItemsRef.current = visibleItems;
  const cardsRef = useRef(cards);
  cardsRef.current = cards;
  const dragState = useRef<{
    active: boolean;
    sourceVisIdx: number;
    currentVisIdx: number;
    sourceLoc: DragLocation;
    currentLoc: DragLocation;
    sourceItemType: 'card' | 'folder';
    startY: number;
    offsetY: number;
    cardHeight: number;
    rowRects: { top: number; height: number }[];
    dropOnFolder: string | null; // folder id if hovering over a folder header
  } | null>(null);
  const [dragSourceVisIdx, setDragSourceVisIdx] = useState<number | null>(null);
  const [dragOverVisIdx, setDragOverVisIdx] = useState<number | null>(null);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const [dragGhostStyle, setDragGhostStyle] = useState<React.CSSProperties | null>(null);
  const dragGhostRef = useRef<HTMLDivElement>(null);
  const dragGhostText = useRef('');

  const handlePointerDown = useCallback(
    (e: React.PointerEvent, visIdx: number, text: string) => {
      // Only left button, skip if renaming, no reorder handler, or modifier keys
      if (e.button !== 0 || !onReorderCardItem || renamingId !== null || renamingFolderId !== null) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey) return;

      const el = e.currentTarget as HTMLElement;
      const rect = el.getBoundingClientRect();

      // Snapshot all row rects for hit-testing during drag
      const rowEls = listRef.current?.querySelectorAll('[data-vis-idx]');
      const rowRects: { top: number; height: number }[] = [];
      rowEls?.forEach((rel) => {
        const r = (rel as HTMLElement).getBoundingClientRect();
        rowRects.push({ top: r.top, height: r.height });
      });

      const item = visibleItemsRef.current[visIdx];
      if (!item) return;

      dragState.current = {
        active: false,
        sourceVisIdx: visIdx,
        currentVisIdx: visIdx,
        sourceLoc: item.loc,
        currentLoc: item.loc,
        sourceItemType: item.isFolder ? 'folder' : 'card',
        startY: e.clientY,
        offsetY: e.clientY - rect.top,
        cardHeight: rect.height,
        rowRects,
        dropOnFolder: null,
      };
      dragGhostText.current = text;

      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [onReorderCardItem, renamingId, renamingFolderId],
  );

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const ds = dragState.current;
    if (!ds) return;

    const dy = Math.abs(e.clientY - ds.startY);

    // Activate drag after 4px movement
    if (!ds.active) {
      if (dy < 4) return;
      ds.active = true;
      setDragSourceVisIdx(ds.sourceVisIdx);
      setDragOverVisIdx(ds.sourceVisIdx);
      document.body.classList.add('cursor-grabbing-override');
    }

    // Update ghost position
    const listRect = listRef.current?.getBoundingClientRect();
    if (listRect) {
      setDragGhostStyle({
        position: 'absolute',
        left: 0,
        right: 0,
        top: e.clientY - listRect.top - ds.offsetY,
        height: ds.cardHeight,
        zIndex: 50,
        pointerEvents: 'none',
        opacity: 0.9,
      });
    }

    // Determine which slot we're over using the row midpoints
    const rects = ds.rowRects;
    let targetVisIdx = ds.sourceVisIdx;
    for (let i = 0; i < rects.length; i++) {
      if (i === ds.sourceVisIdx) continue;
      const mid = rects[i].top + rects[i].height / 2;
      if (ds.sourceVisIdx < i) {
        if (e.clientY > mid) targetVisIdx = i;
      } else {
        if (e.clientY < mid) {
          targetVisIdx = i;
          break;
        }
      }
    }

    // Determine drop target: is this a "drop into folder" or a positional insert?
    const currentVisibleItems = visibleItemsRef.current;
    const currentCards = cardsRef.current;
    const targetItem = currentVisibleItems[targetVisIdx];
    let dropOnFolder: string | null = null;

    if (targetItem && targetItem.isFolder && ds.sourceItemType === 'card') {
      // Dragging a card over a folder header -> drop into folder
      dropOnFolder = targetItem.folderId || null;
    }
    // Folders can't be dropped into other folders
    if (targetItem && targetItem.isFolder && ds.sourceItemType === 'folder' && targetVisIdx !== ds.sourceVisIdx) {
      // Allowed: folder reorder at root level (no dropOnFolder)
      dropOnFolder = null;
    }

    if (targetVisIdx !== ds.currentVisIdx || dropOnFolder !== ds.dropOnFolder) {
      ds.currentVisIdx = targetVisIdx;
      ds.dropOnFolder = dropOnFolder;

      // Compute the target DragLocation
      if (dropOnFolder) {
        // Drop into folder: append to end of folder's cards
        const folder = currentCards.find(
          (item) => isCardFolder(item) && item.id === dropOnFolder,
        ) as CardFolder | undefined;
        ds.currentLoc = { type: 'folder', folderId: dropOnFolder, index: folder?.cards.length ?? 0 };
      } else if (targetItem) {
        // Block cards from being positioned at root level (no loose cards)
        if (ds.sourceItemType === 'card' && targetItem.loc.type === 'root') {
          // Snap to nearest folder: treat as drop-into-folder if target is a folder header
          if (targetItem.isFolder && targetItem.folderId) {
            dropOnFolder = targetItem.folderId;
            ds.dropOnFolder = dropOnFolder;
            const folder = currentCards.find(
              (item) => isCardFolder(item) && item.id === dropOnFolder,
            ) as CardFolder | undefined;
            ds.currentLoc = { type: 'folder', folderId: dropOnFolder, index: folder?.cards.length ?? 0 };
          }
          // else: keep previous valid location (don't update)
        } else {
          ds.currentLoc = targetItem.loc;
        }
      }

      setDragOverVisIdx(targetVisIdx);
      setDragOverFolderId(dropOnFolder);
    }
  }, []);

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      const ds = dragState.current;
      if (!ds) return;

      (e.target as HTMLElement).releasePointerCapture(e.pointerId);

      if (ds.active) {
        const fromLoc = ds.sourceLoc;
        const toLoc = ds.currentLoc;
        const itemType = ds.sourceItemType;

        // Check if actually moved
        const isSame =
          fromLoc.type === toLoc.type &&
          (fromLoc.type === 'root' && toLoc.type === 'root'
            ? fromLoc.index === toLoc.index
            : fromLoc.type === 'folder' && toLoc.type === 'folder'
              ? fromLoc.folderId === toLoc.folderId && fromLoc.index === toLoc.index
              : false);

        // Block cards from being dropped at root level (no loose cards)
        const isCardToRoot = itemType === 'card' && toLoc.type === 'root';

        if (!isSame && !isCardToRoot) {
          onReorderCardItem?.(fromLoc, toLoc, itemType);
        }
      }

      dragState.current = null;
      setDragSourceVisIdx(null);
      setDragOverVisIdx(null);
      setDragOverFolderId(null);
      setDragGhostStyle(null);
      document.body.classList.remove('cursor-grabbing-override');
    },
    [onReorderCardItem],
  );

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
        setShowInfoSubmenu(false);
        setShowCopyMoveSubmenu(false);
      }
    };
    window.addEventListener('mousedown', handleClick);
    return () => window.removeEventListener('mousedown', handleClick);
  }, [contextMenu]);

  // Close folder context menu on outside click
  useEffect(() => {
    if (!folderContextMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (folderMenuRef.current && !folderMenuRef.current.contains(e.target as Node)) {
        setFolderContextMenu(null);
      }
    };
    window.addEventListener('mousedown', handleClick);
    return () => window.removeEventListener('mousedown', handleClick);
  }, [folderContextMenu]);

  // Adjust context menu position to stay within viewport
  useEffect(() => {
    if (!contextMenu || !menuRef.current) return;
    const menu = menuRef.current;
    const rect = menu.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let { x, y } = contextMenu;
    if (rect.bottom > vh) y = Math.max(4, vh - rect.height - 4);
    if (rect.right > vw) x = Math.max(4, vw - rect.width - 4);
    if (y !== contextMenu.y || x !== contextMenu.x) {
      menu.style.top = `${y}px`;
      menu.style.left = `${x}px`;
    }
  }, [contextMenu]);

  // Reset submenus when menu closes
  useEffect(() => {
    if (!contextMenu) {
      setShowInfoSubmenu(false);
      setShowCopyMoveSubmenu(false);
    }
  }, [contextMenu]);

  useEffect(() => {
    if (!folderContextMenu) {
      setShowFolderCopyMoveSubmenu(false);
    }
  }, [folderContextMenu]);

  useEffect(() => {
    if (addCardToFolderId) {
      setNewCardInFolderName('');
      const timer = setTimeout(() => newCardInFolderInputRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    }
  }, [addCardToFolderId]);

  // Adjust folder context menu position to stay within viewport
  useEffect(() => {
    if (!folderContextMenu || !folderMenuRef.current) return;
    const menu = folderMenuRef.current;
    const rect = menu.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let { x, y } = folderContextMenu;
    if (rect.bottom > vh) y = Math.max(4, vh - rect.height - 4);
    if (rect.right > vw) x = Math.max(4, vw - rect.width - 4);
    if (y !== folderContextMenu.y || x !== folderContextMenu.x) {
      menu.style.top = `${y}px`;
      menu.style.left = `${x}px`;
    }
  }, [folderContextMenu]);

  // Focus rename input when it appears
  useEffect(() => {
    if (renamingId) renameInputRef.current?.focus();
  }, [renamingId]);

  // Focus folder rename input when it appears
  useEffect(() => {
    if (renamingFolderId) folderRenameInputRef.current?.focus();
  }, [renamingFolderId]);

  // Keyboard shortcuts: Cmd/Ctrl+A to select all
  const allCardsRef = useRef(allCards);
  allCardsRef.current = allCards;
  const onSelectAllRef = useRef(onSelectAll);
  onSelectAllRef.current = onSelectAll;
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'a' && (e.metaKey || e.ctrlKey) && allCardsRef.current.length > 0) {
        // Only handle if no input/textarea is focused
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        e.preventDefault();
        onSelectAllRef.current();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const commitRename = useCallback((id: string) => {
    const trimmed = renameValue.trim();
    if (!trimmed) {
      setRenamingId(null);
      setRenameError('');
      return;
    }
    const currentCard = findCard(cards, id);
    if (trimmed !== currentCard?.text) {
      const parentFolder = findParentFolder(cards, id);
      const siblingNames = cardNamesInScope(cards, parentFolder?.id);
      if (isNameTaken(trimmed, siblingNames, currentCard?.text)) {
        setRenameError('A card with this name already exists');
        return;
      }
      onRenameCard(id, trimmed);
    }
    setRenamingId(null);
    setRenameError('');
  }, [renameValue, cards, allCards, onRenameCard]);

  const commitFolderRename = useCallback((folderId: string) => {
    const trimmed = folderRenameValue.trim();
    if (!trimmed) {
      setRenamingFolderId(null);
      setFolderRenameError('');
      return;
    }
    const folder = cards.find((item): item is CardFolder => isCardFolder(item) && item.id === folderId);
    if (trimmed !== folder?.name) {
      const folderNames = cards.filter(isCardFolder).map((f) => f.name);
      if (isNameTaken(trimmed, folderNames, folder?.name)) {
        setFolderRenameError('A folder with this name already exists');
        return;
      }
      onRenameFolder?.(folderId, trimmed);
    }
    setRenamingFolderId(null);
    setFolderRenameError('');
  }, [folderRenameValue, cards, onRenameFolder]);

  // ── Stable callbacks for CardRow / FolderRow ──

  const handleCardContextMenu = useCallback((e: React.MouseEvent, cardId: string) => {
    e.stopPropagation();
    setShowInfoSubmenu(false);
    setShowCopyMoveSubmenu(false);
    setContextMenu({ x: e.clientX, y: e.clientY, cardId });
  }, []);

  const handleFolderContextMenu = useCallback((e: React.MouseEvent, folderId: string) => {
    e.stopPropagation();
    setFolderContextMenu({ x: e.clientX, y: e.clientY, folderId });
  }, []);

  const handleRenameChange = useCallback((value: string) => {
    setRenameValue(value);
    setRenameError('');
  }, []);

  const handleRenameCancel = useCallback(() => {
    setRenamingId(null);
    setRenameError('');
  }, []);

  const handleFolderRenameChange = useCallback((value: string) => {
    setFolderRenameValue(value);
    setFolderRenameError('');
  }, []);

  const handleFolderRenameCancel = useCallback(() => {
    setRenamingFolderId(null);
    setFolderRenameError('');
  }, []);

  // Compute gap style for smooth card displacement during drag (operates on visIdx)
  const getGapStyle = useCallback((visIdx: number): React.CSSProperties => {
    if (dragSourceVisIdx === null || dragOverVisIdx === null || dragSourceVisIdx === dragOverVisIdx) return {};
    if (dragOverFolderId) return { transition: 'transform 150ms ease' };
    const gap = dragState.current?.cardHeight || 28;
    if (dragSourceVisIdx < dragOverVisIdx) {
      if (visIdx > dragSourceVisIdx && visIdx <= dragOverVisIdx) {
        return { transform: `translateY(-${gap}px)`, transition: 'transform 150ms ease' };
      }
    } else {
      if (visIdx >= dragOverVisIdx && visIdx < dragSourceVisIdx) {
        return { transform: `translateY(${gap}px)`, transition: 'transform 150ms ease' };
      }
    }
    return { transition: 'transform 150ms ease' };
  }, [dragSourceVisIdx, dragOverVisIdx, dragOverFolderId]);

  if (cards.length === 0) {
    return (
      <>
        {onCreateEmptyFolder && (
          <div className="shrink-0 border-b border-zinc-100 dark:border-zinc-600">
            <button
              onClick={() => onCreateEmptyFolder()}
              className="w-full flex items-center gap-1.5 px-3 py-1.5 cursor-pointer transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800"
            >
              <span
                className="text-[11px] font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-400 flex-1 min-w-0 text-left"
                style={{ textShadow: '0 1px 2px rgba(0,0,0,0.15)' }}
              >
                New Folder
              </span>
              <span className="shrink-0 w-5 h-5 rounded flex items-center justify-center text-zinc-600 dark:text-zinc-400">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </span>
            </button>
          </div>
        )}
        <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
          <PanelRequirements level="cards" />
        </div>
      </>
    );
  }

  const folderCount = cards.filter(isCardFolder).length;

  return (
    <>
      {/* New Folder header bar */}
      {onCreateEmptyFolder && (
        <div className="shrink-0 h-[40px] flex items-center justify-center gap-2 px-5 border-b border-zinc-200 dark:border-zinc-700">
          <button
            onClick={() => onCreateEmptyFolder()}
            className="flex items-center gap-1.5 px-3 py-1 rounded-md text-[11px] font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-400 cursor-pointer transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-800 dark:hover:text-zinc-200"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            New Folder
          </button>
          <span className="text-[9px] text-zinc-400 dark:text-zinc-500 font-light">
            {folderCount}
          </span>
        </div>
      )}
    <div className="space-y-0 py-2 relative" ref={listRef}>
      {/* --- Render loop: top-level items (cards + folders) --- */}
      {(() => {
        let visIdx = 0;
        return cards.map((item) => {
          if (isCardFolder(item)) {
            const folder = item;
            const folderVisIdx = visIdx++;
            const firstChildVisIdx = visIdx;
            visIdx += folder.collapsed ? 0 : folder.cards.length;

            return (
              <FolderRow
                key={folder.id}
                folder={folder}
                folderVisIdx={folderVisIdx}
                firstChildVisIdx={firstChildVisIdx}
                activeCardId={activeCardId}
                activeDetailLevel={activeDetailLevel}
                gapStyle={getGapStyle(folderVisIdx)}
                isDragging={dragSourceVisIdx === folderVisIdx}
                isDropTarget={dragOverFolderId === folder.id}
                isRenamingFolder={renamingFolderId === folder.id}
                folderRenameValue={folderRenameValue}
                folderRenameError={folderRenameError}
                folderRenameInputRef={renamingFolderId === folder.id ? folderRenameInputRef : undefined}
                renamingId={renamingId}
                renameValue={renameValue}
                renameError={renameError}
                renameInputRef={renameInputRef}
                dragSourceVisIdx={dragSourceVisIdx}
                getGapStyle={getGapStyle}
                dragStateRef={dragState}
                onToggleFolderCollapsed={onToggleFolderCollapsed}
                onToggleFolderSelection={onToggleFolderSelection}
                onFolderContextMenu={handleFolderContextMenu}
                onFolderRenameChange={handleFolderRenameChange}
                onFolderRenameCommit={commitFolderRename}
                onFolderRenameCancel={handleFolderRenameCancel}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onCardClick={onCardClick}
                onCardDoubleClick={onCardDoubleClick}
                onToggleSelection={onToggleSelection}
                onCardContextMenu={handleCardContextMenu}
                onRenameChange={handleRenameChange}
                onRenameCommit={commitRename}
                onRenameCancel={handleRenameCancel}
              />
            );
          }

          const card = item;
          const rootVisIdx = visIdx++;

          return (
            <CardRow
              key={card.id}
              card={card}
              visIdx={rootVisIdx}
              isActive={card.id === activeCardId}
              isSelected={!!card.selected}
              isGenerating={!!card.isGeneratingMap && Object.values(card.isGeneratingMap).some(Boolean)}
              isSynthesizing={!!card.isSynthesizingMap && Object.values(card.isSynthesizingMap).some(Boolean)}
              gapStyle={getGapStyle(rootVisIdx)}
              isDragging={dragSourceVisIdx === rootVisIdx}
              isRenaming={renamingId === card.id}
              renameValue={renameValue}
              renameError={renameError}
              renameInputRef={renamingId === card.id ? renameInputRef : undefined}
              dragStateRef={dragState}
              onCardClick={onCardClick}
              onCardDoubleClick={onCardDoubleClick}
              onToggleSelection={onToggleSelection}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onContextMenu={handleCardContextMenu}
              onRenameChange={handleRenameChange}
              onRenameCommit={commitRename}
              onRenameCancel={handleRenameCancel}
            />
          );
        });
      })()}

      {/* Floating drag ghost */}
      {dragGhostStyle && (
        <div
          ref={dragGhostRef}
          className="flex items-center gap-1 px-1.5 py-1 rounded bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-600 shadow-lg dark:shadow-black/30"
          style={{ ...dragGhostStyle, cursor: 'grabbing' }}
        >
          <p className="text-[11px] font-semibold text-zinc-800 dark:text-zinc-200 truncate">{dragGhostText.current}</p>
        </div>
      )}

      {/* Context menu — rendered as portal at right-click coordinates */}
      {contextMenu &&
        (() => {
          const card = findCard(cards, contextMenu.cardId);
          if (!card) return null;
          const level = activeDetailLevel || card.detailLevel || 'Standard';
          const _hasCard = !!card.activeImageMap?.[level];
          const _hasSynthesis = !!card.synthesisMap?.[level];
          return createPortal(
            <div
              ref={menuRef}
              className="fixed z-[130] min-w-[180px] bg-white dark:bg-zinc-900 rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-600 py-1 animate-in fade-in zoom-in-95 duration-150"
              style={{ top: contextMenu.y, left: contextMenu.x }}
            >
              {/* ── Active card actions (always shown) ── */}
              {/* Info — hover submenu */}
              <div
                className="relative"
                onMouseEnter={() => setShowInfoSubmenu(true)}
                onMouseLeave={() => setShowInfoSubmenu(false)}
              >
                <button className="w-full text-left px-3 py-2 text-[11px] text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="text-zinc-500"
                    >
                      <circle cx="12" cy="12" r="10" />
                      <path d="M12 16v-4" />
                      <path d="M12 8h.01" />
                    </svg>
                    Card Info
                  </span>
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-zinc-500"
                  >
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>

                {showInfoSubmenu && (
                  <div className="absolute left-full top-0 ml-1 w-56 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-600 rounded-lg shadow-lg z-[140] animate-in fade-in zoom-in-95 duration-100">
                    <InfoContent card={card} level={level} />
                  </div>
                )}
              </div>

              {onGenerateCardImage && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setContextMenu(null);
                    onGenerateCardImage(card);
                  }}
                  className="w-full text-left px-3 py-2 text-[11px] text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors flex items-center gap-2"
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-zinc-500"
                  >
                    <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
                    <circle cx="9" cy="9" r="2" />
                    <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
                  </svg>
                  Generate Card Image
                </button>
              )}

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setRenameValue(card.text);
                  setRenamingId(card.id);
                  setContextMenu(null);
                }}
                className="w-full text-left px-3 py-2 text-[11px] text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors flex items-center gap-2"
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-zinc-500"
                >
                  <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                </svg>
                Rename Card
              </button>

              {/* Copy/Move — hover submenu */}
              {onCopyMoveCard && (
                <div
                  className="relative"
                  onMouseEnter={() => setShowCopyMoveSubmenu(true)}
                  onMouseLeave={() => setShowCopyMoveSubmenu(false)}
                >
                  <button
                    onClick={() => {
                      if (!otherNuggets || otherNuggets.length === 0) {
                        setContextMenu(null);
                      }
                    }}
                    className="w-full text-left px-3 py-2 text-[11px] text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors flex items-center justify-between"
                  >
                    <span className="flex items-center gap-2">
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="text-zinc-500"
                      >
                        <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                        <polyline points="10 17 15 12 10 7" />
                        <line x1="15" y1="12" x2="3" y2="12" />
                      </svg>
                      Copy/Move to Nugget
                    </span>
                    {otherNuggets && otherNuggets.length > 0 && (
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="text-zinc-500"
                      >
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    )}
                  </button>

                  {/* Nugget list submenu */}
                  {showCopyMoveSubmenu && otherNuggets && otherNuggets.length > 0 && (
                    <div className="absolute left-full top-0 ml-1 w-[220px] bg-white dark:bg-zinc-900 rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-600 py-1 z-[140] animate-in fade-in zoom-in-95 duration-100">
                      <div className="px-3 pb-1 border-b border-zinc-100 dark:border-zinc-600 mb-1">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                          Copy/Move to nugget
                        </span>
                      </div>
                      <div className="max-h-[200px] overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
                        {projectNuggets && projectNuggets.length > 0
                          ? projectNuggets.map((pg) => (
                              <div key={pg.projectId}>
                                <div className="px-3 pt-1.5 pb-0.5 flex items-center gap-1.5">
                                  <svg
                                    width="12"
                                    height="12"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    className="text-zinc-500 shrink-0"
                                  >
                                    <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
                                  </svg>
                                  <span className="text-[9px] font-semibold text-zinc-500 dark:text-zinc-400 truncate">
                                    {pg.projectName}
                                  </span>
                                </div>
                                {pg.nuggets.length === 0 ? (
                                  <p className="text-zinc-500 dark:text-zinc-400 text-[9px] font-light pl-6 pr-2 py-0.5 italic">
                                    No other nuggets
                                  </p>
                                ) : (
                                  pg.nuggets.map((n) => (
                                    <div
                                      key={n.id}
                                      className="pl-5 pr-2 py-1 flex items-center gap-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800 rounded-lg mx-1 group"
                                    >
                                      <div className="w-1.5 h-1.5 rounded-full bg-accent-blue shrink-0" />
                                      <span className="flex-1 text-[11px] text-black truncate" title={n.name}>
                                        {n.name}
                                      </span>
                                      <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button
                                          onClick={() => {
                                            const hId = contextMenu.cardId;
                                            setContextMenu(null);
                                            onCopyMoveCard(hId, n.id, 'copy');
                                          }}
                                          className="px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800/50 hover:bg-zinc-200 dark:hover:bg-zinc-700 hover:text-zinc-800 dark:hover:text-zinc-200 rounded transition-colors"
                                        >
                                          Copy
                                        </button>
                                        <button
                                          onClick={() => {
                                            const hId = contextMenu.cardId;
                                            setContextMenu(null);
                                            onCopyMoveCard(hId, n.id, 'move');
                                          }}
                                          className="px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800/50 hover:bg-zinc-200 dark:hover:bg-zinc-700 hover:text-zinc-800 dark:hover:text-zinc-200 rounded transition-colors"
                                        >
                                          Move
                                        </button>
                                      </div>
                                    </div>
                                  ))
                                )}
                              </div>
                            ))
                          : otherNuggets.map((n) => (
                              <div
                                key={n.id}
                                className="px-2 py-1 flex items-center gap-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800 rounded-lg mx-1 group"
                              >
                                <div className="w-1.5 h-1.5 rounded-full bg-accent-blue shrink-0" />
                                <span className="flex-1 text-[11px] text-black truncate" title={n.name}>
                                  {n.name}
                                </span>
                                <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button
                                    onClick={() => {
                                      const hId = contextMenu.cardId;
                                      setContextMenu(null);
                                      onCopyMoveCard(hId, n.id, 'copy');
                                    }}
                                    className="px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800/50 hover:bg-zinc-200 dark:hover:bg-zinc-700 hover:text-zinc-800 dark:hover:text-zinc-200 rounded transition-colors"
                                  >
                                    Copy
                                  </button>
                                  <button
                                    onClick={() => {
                                      const hId = contextMenu.cardId;
                                      setContextMenu(null);
                                      onCopyMoveCard(hId, n.id, 'move');
                                    }}
                                    className="px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800/50 hover:bg-zinc-200 dark:hover:bg-zinc-700 hover:text-zinc-800 dark:hover:text-zinc-200 rounded transition-colors"
                                  >
                                    Move
                                  </button>
                                </div>
                              </div>
                            ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="h-px bg-zinc-100 dark:bg-zinc-700 my-1" />

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setContextMenu(null);
                  setConfirmDeleteId(card.id);
                }}
                className="w-full text-left px-3 py-2 text-[11px] text-red-500 hover:bg-red-50 transition-colors flex items-center gap-2"
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M3 6h18" />
                  <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                  <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                </svg>
                Remove Card
              </button>

              {/* ── Selected cards actions (only when 2+ cards checked) ── */}
              {selectedCount > 1 && (
                <>
                  <div className="h-px bg-zinc-100 dark:bg-zinc-700 my-1" />
                  <div className="px-3 py-1.5 text-[9px] font-black uppercase tracking-[0.15em] text-zinc-500 dark:text-zinc-400">
                    {selectedCount} Cards Selected
                  </div>
                  <div className="h-px bg-zinc-100 dark:bg-zinc-700 my-1" />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setContextMenu(null);
                      onDeselectAll();
                    }}
                    className="w-full text-left px-3 py-2 text-[11px] text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors flex items-center gap-2"
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="text-zinc-500"
                    >
                      <path d="M18 6 6 18" />
                      <path d="m6 6 12 12" />
                    </svg>
                    Deselect All
                  </button>
                  {(onGenerateBatchCards || onGenerateCardImage) && (
                    <>
                      <div className="h-px bg-zinc-100 dark:bg-zinc-700 my-1" />
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setContextMenu(null);
                          const selected = allCards.filter((c) => c.selected);
                          if (selected.length === 0) return;
                          if (onGenerateBatchCards) {
                            onGenerateBatchCards(selected);
                          } else {
                            selected.forEach((c) => onGenerateCardImage!(c));
                          }
                        }}
                        className="w-full text-left px-3 py-2 text-[11px] text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors flex items-center gap-2"
                      >
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="text-zinc-500"
                        >
                          <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
                          <circle cx="9" cy="9" r="2" />
                          <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
                        </svg>
                        Generate {selectedCount} Card Images
                      </button>
                    </>
                  )}
                  <div className="h-px bg-zinc-100 dark:bg-zinc-700 my-1" />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setContextMenu(null);
                      setConfirmDeleteSelected(true);
                    }}
                    className="w-full text-left px-3 py-2 text-[11px] text-red-500 hover:bg-red-50 transition-colors flex items-center gap-2"
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M3 6h18" />
                      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                    </svg>
                    Remove {selectedCount} Cards
                  </button>
                </>
              )}
            </div>,
            document.body,
          );
        })()}

      {/* Delete confirmation modal */}
      {confirmDeleteId &&
        (() => {
          const card = findCard(cards, confirmDeleteId);
          if (!card) return null;
          return createPortal(
            <div
              className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 dark:bg-black/60"
              onClick={() => setConfirmDeleteId(null)}
            >
              <div
                className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl dark:shadow-black/30 mx-4 overflow-hidden"
                style={{ minWidth: 260, maxWidth: 'calc(100vw - 32px)', width: 'fit-content' }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="px-6 pt-6 pb-3 text-center">
                  <div className="w-9 h-9 rounded-full bg-zinc-100 dark:bg-zinc-800/50 flex items-center justify-center mx-auto mb-3">
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      className="text-zinc-500"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M3 6h18" />
                      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                    </svg>
                  </div>
                  <h3 className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 tracking-tight mb-1">
                    Remove Card
                  </h3>
                  <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400 whitespace-nowrap">{card.text}</p>
                  <p className="text-[12px] text-zinc-500 dark:text-zinc-400 mt-2">This cannot be undone.</p>
                </div>
                <div className="px-6 pb-5 pt-1 flex items-center justify-center gap-2">
                  <button
                    onClick={() => setConfirmDeleteId(null)}
                    className="px-4 py-2 text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      setConfirmDeleteId(null);
                      onDeleteCard(card.id);
                    }}
                    className="px-4 py-2 bg-zinc-900 text-white text-xs font-medium rounded-lg hover:bg-zinc-800 transition-colors"
                  >
                    Remove
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          );
        })()}

      {/* Bulk delete confirmation modal */}
      {confirmDeleteSelected &&
        (() => {
          return createPortal(
            <div
              className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 dark:bg-black/60"
              onClick={() => setConfirmDeleteSelected(false)}
            >
              <div
                className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl dark:shadow-black/30 mx-4 overflow-hidden"
                style={{ minWidth: 260, maxWidth: 'calc(100vw - 32px)', width: 'fit-content' }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="px-6 pt-6 pb-3 text-center">
                  <div className="w-9 h-9 rounded-full bg-zinc-100 dark:bg-zinc-800/50 flex items-center justify-center mx-auto mb-3">
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      className="text-zinc-500"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M3 6h18" />
                      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                    </svg>
                  </div>
                  <h3 className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 tracking-tight mb-1">
                    Remove {selectedCount} Cards
                  </h3>
                  <p className="text-[12px] text-zinc-500 dark:text-zinc-400 mt-2">This cannot be undone.</p>
                </div>
                <div className="px-6 pb-5 pt-1 flex items-center justify-center gap-2">
                  <button
                    onClick={() => setConfirmDeleteSelected(false)}
                    className="px-4 py-2 text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      setConfirmDeleteSelected(false);
                      onDeleteSelectedCards();
                    }}
                    className="px-4 py-2 bg-zinc-900 text-white text-xs font-medium rounded-lg hover:bg-zinc-800 transition-colors"
                  >
                    Remove All
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          );
        })()}

      {/* ── Folder context menu — rendered as portal ── */}
      {folderContextMenu &&
        (() => {
          const folder = cards.find((item): item is CardFolder => isCardFolder(item) && item.id === folderContextMenu.folderId);
          if (!folder) return null;
          return createPortal(
            <div
              ref={folderMenuRef}
              className="fixed z-[130] min-w-[180px] bg-white dark:bg-zinc-900 rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-600 py-1 animate-in fade-in zoom-in-95 duration-150"
              style={{ top: folderContextMenu.y, left: folderContextMenu.x }}
            >
              {onCreateCustomCardInFolder && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setFolderContextMenu(null);
                    setAddCardToFolderId(folder.id);
                  }}
                  className="w-full text-left px-3 py-2 text-[11px] text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors flex items-center gap-2"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-500">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <line x1="12" y1="8" x2="12" y2="16" />
                    <line x1="8" y1="12" x2="16" y2="12" />
                  </svg>
                  Add Custom Card
                </button>
              )}

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setFolderRenameValue(folder.name);
                  setRenamingFolderId(folder.id);
                  setFolderContextMenu(null);
                }}
                className="w-full text-left px-3 py-2 text-[11px] text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors flex items-center gap-2"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-500">
                  <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                </svg>
                Rename Folder
              </button>

              {onDuplicateFolder && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setFolderContextMenu(null);
                    onDuplicateFolder(folder.id);
                  }}
                  className="w-full text-left px-3 py-2 text-[11px] text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors flex items-center gap-2"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-500">
                    <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                  </svg>
                  Duplicate Folder
                </button>
              )}

              {/* Copy/Move to Nugget — hover submenu */}
              {onCopyMoveFolder && (
                <div
                  className="relative"
                  onMouseEnter={() => setShowFolderCopyMoveSubmenu(true)}
                  onMouseLeave={() => setShowFolderCopyMoveSubmenu(false)}
                >
                  <button
                    onClick={() => {
                      if (!otherNuggets || otherNuggets.length === 0) {
                        // No other nuggets — just close menu
                        setFolderContextMenu(null);
                      }
                    }}
                    className="w-full text-left px-3 py-2 text-[11px] text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors flex items-center justify-between"
                  >
                    <span className="flex items-center gap-2">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-500">
                        <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                        <polyline points="10 17 15 12 10 7" />
                        <line x1="15" y1="12" x2="3" y2="12" />
                      </svg>
                      Copy/Move to Nugget
                    </span>
                    {otherNuggets && otherNuggets.length > 0 && (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-500">
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    )}
                  </button>

                  {/* Nugget list submenu */}
                  {showFolderCopyMoveSubmenu && otherNuggets && otherNuggets.length > 0 && (
                    <div className="absolute left-full top-0 ml-1 w-[220px] bg-white dark:bg-zinc-900 rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-600 py-1 z-[140] animate-in fade-in zoom-in-95 duration-100">
                      <div className="px-3 pb-1 border-b border-zinc-100 dark:border-zinc-600 mb-1">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                          Copy/Move folder to nugget
                        </span>
                      </div>
                      <div className="max-h-[200px] overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
                        {projectNuggets && projectNuggets.length > 0
                          ? projectNuggets.map((pg) => (
                              <div key={pg.projectId}>
                                <div className="px-3 pt-1.5 pb-0.5 flex items-center gap-1.5">
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-500 shrink-0">
                                    <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
                                  </svg>
                                  <span className="text-[9px] font-semibold text-zinc-500 dark:text-zinc-400 truncate">
                                    {pg.projectName}
                                  </span>
                                </div>
                                {pg.nuggets.length === 0 ? (
                                  <p className="text-zinc-500 dark:text-zinc-400 text-[9px] font-light pl-6 pr-2 py-0.5 italic">
                                    No other nuggets
                                  </p>
                                ) : (
                                  pg.nuggets.map((n) => (
                                    <div key={n.id} className="pl-5 pr-2 py-1 flex items-center gap-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800 rounded-lg mx-1 group">
                                      <div className="w-1.5 h-1.5 rounded-full bg-accent-blue shrink-0" />
                                      <span className="flex-1 text-[11px] text-black truncate" title={n.name}>{n.name}</span>
                                      <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button
                                          onClick={() => { setFolderContextMenu(null); onCopyMoveFolder(folder.id, n.id, 'copy'); }}
                                          className="px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800/50 hover:bg-zinc-200 dark:hover:bg-zinc-700 hover:text-zinc-800 dark:hover:text-zinc-200 rounded transition-colors"
                                        >Copy</button>
                                        <button
                                          onClick={() => { setFolderContextMenu(null); onCopyMoveFolder(folder.id, n.id, 'move'); }}
                                          className="px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800/50 hover:bg-zinc-200 dark:hover:bg-zinc-700 hover:text-zinc-800 dark:hover:text-zinc-200 rounded transition-colors"
                                        >Move</button>
                                      </div>
                                    </div>
                                  ))
                                )}
                              </div>
                            ))
                          : otherNuggets.map((n) => (
                              <div key={n.id} className="px-2 py-1 flex items-center gap-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800 rounded-lg mx-1 group">
                                <div className="w-1.5 h-1.5 rounded-full bg-accent-blue shrink-0" />
                                <span className="flex-1 text-[11px] text-black truncate" title={n.name}>{n.name}</span>
                                <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button
                                    onClick={() => { setFolderContextMenu(null); onCopyMoveFolder(folder.id, n.id, 'copy'); }}
                                    className="px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800/50 hover:bg-zinc-200 dark:hover:bg-zinc-700 hover:text-zinc-800 dark:hover:text-zinc-200 rounded transition-colors"
                                  >Copy</button>
                                  <button
                                    onClick={() => { setFolderContextMenu(null); onCopyMoveFolder(folder.id, n.id, 'move'); }}
                                    className="px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800/50 hover:bg-zinc-200 dark:hover:bg-zinc-700 hover:text-zinc-800 dark:hover:text-zinc-200 rounded transition-colors"
                                  >Move</button>
                                </div>
                              </div>
                            ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {onDownloadContent && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setFolderContextMenu(null);
                    onDownloadContent(folder.id);
                  }}
                  disabled={folder.cards.filter((c) => c.selected).length === 0}
                  className="w-full text-left px-3 py-2 text-[11px] text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors flex items-center gap-2 disabled:opacity-40 disabled:pointer-events-none"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-500">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  Download Content
                </button>
              )}

              {onExportImages && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setFolderContextMenu(null);
                    onExportImages(folder.id);
                  }}
                  disabled={!folder.cards.some((c) => c.albumMap && Object.values(c.albumMap).some((imgs) => imgs && imgs.length > 0))}
                  className="w-full text-left px-3 py-2 text-[11px] text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors flex items-center gap-2 disabled:opacity-40 disabled:pointer-events-none"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-500">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <path d="m21 15-5-5L5 21" />
                  </svg>
                  Export Images
                </button>
              )}

              <div className="h-px bg-zinc-100 dark:bg-zinc-700 my-1" />

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setFolderContextMenu(null);
                  setConfirmDeleteFolderId(folder.id);
                }}
                className="w-full text-left px-3 py-2 text-[11px] text-red-500 hover:bg-red-50 transition-colors flex items-center gap-2"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6h18" />
                  <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                  <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                </svg>
                Remove Folder
              </button>
            </div>,
            document.body,
          );
        })()}

      {/* ── Folder delete confirmation modal ── */}
      {confirmDeleteFolderId &&
        (() => {
          const folder = cards.find((item): item is CardFolder => isCardFolder(item) && item.id === confirmDeleteFolderId);
          if (!folder) return null;
          return createPortal(
            <div
              className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 dark:bg-black/60"
              onClick={() => setConfirmDeleteFolderId(null)}
            >
              <div
                className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl dark:shadow-black/30 mx-4 overflow-hidden"
                style={{ minWidth: 260, maxWidth: 'calc(100vw - 32px)', width: 'fit-content' }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="px-6 pt-6 pb-3 text-center">
                  <div className="w-9 h-9 rounded-full bg-zinc-100 dark:bg-zinc-800/50 flex items-center justify-center mx-auto mb-3">
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      className="text-zinc-500"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M3 6h18" />
                      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                    </svg>
                  </div>
                  <h3 className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 tracking-tight mb-1">
                    Remove Folder
                  </h3>
                  <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400 whitespace-nowrap">
                    {folder.name}
                  </p>
                  <p className="text-[12px] text-zinc-500 dark:text-zinc-400 mt-2">
                    Remove folder &lsquo;{folder.name}&rsquo; and all {folder.cards.length} card{folder.cards.length !== 1 ? 's' : ''} inside?
                  </p>
                  <p className="text-[12px] text-zinc-500 dark:text-zinc-400 mt-1">This cannot be undone.</p>
                </div>
                <div className="px-6 pb-5 pt-1 flex items-center justify-center gap-2">
                  <button
                    onClick={() => setConfirmDeleteFolderId(null)}
                    className="px-4 py-2 text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      setConfirmDeleteFolderId(null);
                      onDeleteFolder?.(folder.id);
                    }}
                    className="px-4 py-2 bg-zinc-900 text-white text-xs font-medium rounded-lg hover:bg-zinc-800 transition-colors"
                  >
                    Remove
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          );
        })()}

      {/* ── Add card to folder dialog ── */}
      {addCardToFolderId && onCreateCustomCardInFolder && createPortal(
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 dark:bg-black/60 animate-in fade-in duration-300"
          onClick={() => setAddCardToFolderId(null)}
        >
          <div
            className="w-full max-w-sm bg-white dark:bg-zinc-900 rounded-[40px] p-10 shadow-2xl dark:shadow-black/30 border border-zinc-100 dark:border-zinc-700 animate-in zoom-in-95 duration-300"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-6 text-center">
              <div className="w-16 h-16 flex items-center justify-center mx-auto">
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-black">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <line x1="12" y1="8" x2="12" y2="16" />
                  <line x1="8" y1="12" x2="16" y2="12" />
                </svg>
              </div>
              <div className="space-y-2">
                <h3 className="text-[15px] font-black tracking-tight text-zinc-800 dark:text-zinc-200">
                  New Card
                </h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 font-light leading-relaxed">
                  Enter a name for the new card.
                </p>
              </div>
              {(() => {
                const nameConflict = isNameTaken(newCardInFolderName.trim(), cardNamesInScope(cards, addCardToFolderId));
                const canSubmit = !!newCardInFolderName.trim() && !nameConflict;
                return (
                  <>
                    <div className="text-left space-y-1.5">
                      <label htmlFor="new-card-in-folder-name" className="text-[9px] font-black uppercase tracking-[0.15em] text-zinc-500 dark:text-zinc-400">
                        Card Name
                      </label>
                      <input
                        id="new-card-in-folder-name"
                        ref={newCardInFolderInputRef}
                        value={newCardInFolderName}
                        onChange={(e) => setNewCardInFolderName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && canSubmit) {
                            onCreateCustomCardInFolder(addCardToFolderId, newCardInFolderName.trim());
                            setAddCardToFolderId(null);
                          }
                          if (e.key === 'Escape') setAddCardToFolderId(null);
                        }}
                        placeholder="Enter a name for this card"
                        className={`w-full px-4 py-3 rounded-2xl border bg-zinc-50 dark:bg-zinc-800 text-xs text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-2 transition-colors placeholder:text-zinc-500 ${
                          nameConflict
                            ? 'border-red-300 focus:border-red-400 focus:ring-red-300/50'
                            : 'border-zinc-200 dark:border-zinc-700 focus:border-black focus:ring-zinc-400/50 dark:focus:ring-zinc-500/50'
                        }`}
                      />
                      {nameConflict && (
                        <p className="text-[10px] text-red-500 mt-1">A card with this name already exists</p>
                      )}
                    </div>
                    <div className="flex flex-col space-y-3 pt-4">
                      <button
                        onClick={() => {
                          onCreateCustomCardInFolder(addCardToFolderId, newCardInFolderName.trim());
                          setAddCardToFolderId(null);
                        }}
                        disabled={!canSubmit}
                        className="w-full py-4 rounded-full bg-black text-white text-[10px] font-black uppercase tracking-widest hover:scale-[1.02] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Create Card
                      </button>
                      <button
                        onClick={() => setAddCardToFolderId(null)}
                        className="w-full py-2 text-zinc-600 dark:text-zinc-400 text-[10px] font-bold uppercase tracking-widest hover:text-zinc-800 dark:hover:text-zinc-200 transition-all"
                      >
                        Cancel
                      </button>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
    </>
  );
};

export default React.memo(InsightsCardList);
