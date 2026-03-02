import React, { useRef, useCallback, useState, useMemo, useEffect, forwardRef, useImperativeHandle } from 'react';
import { createPortal } from 'react-dom';
import { Card, CardItem, DetailLevel, UploadedFile } from '../types';
import { findCard, allFolderNames } from '../utils/cardUtils';
import { isNameTaken } from '../utils/naming';
import { DragLocation } from '../hooks/useCardOperations';
import InsightsCardList from './InsightsCardList';
import DocumentEditorModal, { DocumentEditorHandle } from './DocumentEditorModal';
import { UnsavedChangesDialog } from './Dialogs';
import { useSelectionContext } from '../context/SelectionContext';
import { usePanelOverlay } from '../hooks/usePanelOverlay';

const DEFAULT_SIDEBAR_WIDTH = 220;
const MIN_SIDEBAR_WIDTH = 140;
const MAX_SIDEBAR_WIDTH = 480;

const DEFAULT_CONTENT_WIDTH = 474;
const MIN_CONTENT_WIDTH = 474;
const MAX_CONTENT_WIDTH = 800;

const DEFAULT_ASSETS_WIDTH = 360;
const MIN_ASSETS_WIDTH = 280;
const MAX_ASSETS_WIDTH = 800;

const noop = () => {};

interface CardsPanelProps {
  isOpen: boolean;
  onToggle: () => void;
  tabBarRef?: React.RefObject<HTMLElement | null>;
  cards: CardItem[];
  hasSelectedNugget: boolean;
  onToggleSelection: (id: string) => void;
  onSelectExclusive: (id: string) => void;
  onSelectRange: (fromId: string, toId: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onDeleteCard: (id: string) => void;
  onDeleteSelectedCards: () => void;
  onRenameCard: (id: string, newName: string) => void;
  onCopyMoveCard?: (cardId: string, targetNuggetId: string, mode: 'copy' | 'move') => void;
  otherNuggets?: { id: string; name: string }[];
  projectNuggets?: { projectId: string; projectName: string; nuggets: { id: string; name: string }[] }[];
  onSaveCardContent: (cardId: string, level: DetailLevel, newContent: string) => void;
  detailLevel: DetailLevel;
  onGenerateCardImage?: (card: Card) => void;
  onReorderCards?: (fromIndex: number, toIndex: number) => void;
  onReorderCardItem?: (from: DragLocation, to: DragLocation, itemType: 'card' | 'folder') => void;
  // Folder callbacks
  onToggleFolderCollapsed?: (folderId: string) => void;
  onToggleFolderSelection?: (folderId: string) => void;
  onRenameFolder?: (folderId: string, newName: string) => void;
  onDeleteFolder?: (folderId: string) => void;
  onDuplicateFolder?: (folderId: string) => void;
  onCopyMoveFolder?: (folderId: string, targetNuggetId: string, mode: 'copy' | 'move') => void;
  onCreateEmptyFolder?: (name: string) => void;
  onCreateCustomCardInFolder?: (folderId: string, name: string) => void;
  /** Assets panel content rendered as the right section of this combined panel. */
  assetsSlot?: React.ReactNode;
}

/** Ensure markdown content starts with an H1 heading matching cardTitle.
 *  - If no H1 exists, prepend one using cardTitle.
 *  - If an H1 exists but differs from cardTitle, replace it. */
function ensureH1(content: string, cardTitle: string): string {
  const trimmed = content.trimStart();
  const h1Match = trimmed.match(/^#\s+(.+)$/m);
  if (h1Match) {
    const existingTitle = h1Match[1].trim();
    if (existingTitle === cardTitle) return content; // already synced
    // Replace first H1 with current card title
    return content.replace(/^#\s+.+$/m, `# ${cardTitle}`);
  }
  return `# ${cardTitle}\n\n${content}`;
}

/** Extract the first H1 text from markdown content. */
function extractH1(markdown: string): string | null {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : null;
}

export interface PanelEditorHandle {
  isDirty: boolean;
  save: () => void;
  discard: () => void;
}

const CardsPanel = forwardRef<PanelEditorHandle, CardsPanelProps>(
  (
    {
      isOpen,
      onToggle,
      tabBarRef,
      cards,
      hasSelectedNugget,
      onToggleSelection,
      onSelectExclusive,
      onSelectRange,
      onSelectAll,
      onDeselectAll,
      onDeleteCard,
      onDeleteSelectedCards,
      onRenameCard,
      onCopyMoveCard,
      otherNuggets,
      projectNuggets,
      onSaveCardContent,
      detailLevel,
      onGenerateCardImage,
      onReorderCards,
      onReorderCardItem,
      onToggleFolderCollapsed,
      onToggleFolderSelection,
      onRenameFolder,
      onDeleteFolder,
      onDuplicateFolder,
      onCopyMoveFolder,
      onCreateEmptyFolder,
      onCreateCustomCardInFolder,
      assetsSlot,
    },
    ref,
  ) => {
    const { activeCardId, setActiveCardId } = useSelectionContext();
    const { shouldRender, isClosing, overlayStyle } = usePanelOverlay({
      isOpen,
      defaultWidth: Math.min(window.innerWidth * 0.75, 1200),
      minWidth: 300,
      anchorRef: tabBarRef,
    });
    const editorHandleRef = useRef<DocumentEditorHandle>(null);
    // Stable ref for activeCardId — keeps callbacks stable across card switches
    const activeCardIdRef = useRef(activeCardId);
    activeCardIdRef.current = activeCardId;

    useImperativeHandle(
      ref,
      () => ({
        get isDirty() {
          return editorHandleRef.current?.isDirty ?? false;
        },
        save: () => editorHandleRef.current?.save(),
        discard: () => editorHandleRef.current?.discard(),
      }),
      [],
    );
    const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

    // ── Card content collapse state ──
    const [contentCollapsed, setContentCollapsed] = useState(false);

    // ── Imperative editor content swap ──
    // Instead of remounting the editor (400-560ms), swap content via resetContent.
    // Track previous card ID to detect changes.
    const prevCardIdRef = useRef(activeCardId);
    useEffect(() => {
      if (activeCardId === prevCardIdRef.current) return;
      prevCardIdRef.current = activeCardId;
      if (!activeCardId) return;
      // Swap editor content imperatively — no unmount/remount
      const card = findCard(cards, activeCardId);
      if (card) {
        const raw = card.synthesisMap?.[detailLevel] || '';
        const content = ensureH1(raw, card.text);
        editorHandleRef.current?.resetContent(content);
      }
    }, [activeCardId, cards, detailLevel]);

    // ── Sidebar resize state ──
    const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
    const isDragging = useRef(false);
    const startX = useRef(0);
    const startWidth = useRef(0);

    // ── Divider drag handlers ──
    const handleDividerPointerDown = useCallback(
      (e: React.PointerEvent) => {
        e.preventDefault();
        isDragging.current = true;
        startX.current = e.clientX;
        startWidth.current = sidebarWidth;
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      },
      [sidebarWidth],
    );

    const handleDividerPointerMove = useCallback((e: React.PointerEvent) => {
      if (!isDragging.current) return;
      const delta = e.clientX - startX.current;
      const newWidth = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, startWidth.current + delta));
      setSidebarWidth(newWidth);
    }, []);

    const handleDividerPointerUp = useCallback((e: React.PointerEvent) => {
      if (!isDragging.current) return;
      isDragging.current = false;
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    }, []);

    // ── Content panel resize state (divider between content & assets) ──
    const [contentWidth, setContentWidth] = useState(DEFAULT_CONTENT_WIDTH);
    const assetsContainerRef = useRef<HTMLDivElement>(null);
    const isContentDragging = useRef(false);
    const contentStartX = useRef(0);
    const contentStartWidth = useRef(0);

    const handleContentDividerDown = useCallback(
      (e: React.PointerEvent) => {
        e.preventDefault();
        isContentDragging.current = true;
        contentStartX.current = e.clientX;
        contentStartWidth.current = contentWidth;
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      },
      [contentWidth],
    );

    const handleContentDividerMove = useCallback((e: React.PointerEvent) => {
      if (!isContentDragging.current) return;
      const delta = e.clientX - contentStartX.current;
      const newWidth = Math.min(MAX_CONTENT_WIDTH, Math.max(MIN_CONTENT_WIDTH, contentStartWidth.current + delta));
      setContentWidth(newWidth);
    }, []);

    const handleContentDividerUp = useCallback((e: React.PointerEvent) => {
      if (!isContentDragging.current) return;
      isContentDragging.current = false;
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    }, []);

    const activeCard = activeCardId ? findCard(cards, activeCardId) ?? null : null;

    // Stable document for the editor — only set on first mount, subsequent
    // card switches use resetContent imperatively so the editor never re-renders.
    const initialDocRef = useRef<UploadedFile | null>(null);
    if (activeCard && !initialDocRef.current) {
      const raw = activeCard.synthesisMap?.[detailLevel] || '';
      initialDocRef.current = { id: activeCard.id, name: activeCard.text, content: ensureH1(raw, activeCard.text) } as UploadedFile;
    }
    // Reset when no card is selected so next card gets a fresh initial
    if (!activeCard) initialDocRef.current = null;

    // Unsaved-changes gating: if editor is dirty, show dialog before running action
    const gatedAction = useCallback((action: () => void) => {
      if (editorHandleRef.current?.isDirty) {
        setPendingAction(() => action);
      } else {
        action();
      }
    }, []);

    const handleCardClick = useCallback(
      (id: string) => {
        if (id === activeCardIdRef.current) return;
        gatedAction(() => setActiveCardId(id));
      },
      [gatedAction, setActiveCardId],
    );

    // On save: extract H1 → sync card title, then save content.
    // Uses a ref so the callback identity never changes — prevents editor re-renders.
    const saveRef = useRef({ activeCard, detailLevel, onSaveCardContent, onRenameCard });
    saveRef.current = { activeCard, detailLevel, onSaveCardContent, onRenameCard };
    const handleSave = useCallback(
      (newContent: string) => {
        const { activeCard: card, detailLevel: level, onSaveCardContent: save, onRenameCard: rename } = saveRef.current;
        if (!card) return;
        const h1Text = extractH1(newContent);
        if (h1Text && h1Text !== card.text) {
          rename(card.id, h1Text);
        }
        save(card.id, level, newContent);
      },
      [], // stable — reads from ref
    );

    // Wrap onRenameCard: when the active card is renamed from the list, also update the live editor H1.
    const handleRenameCard = useCallback(
      (id: string, newName: string) => {
        onRenameCard(id, newName);
        if (id === activeCardIdRef.current) {
          editorHandleRef.current?.updateH1(newName);
        }
      },
      [onRenameCard],
    );

    // ── Gated wrappers for destructive/unmounting actions ──
    const handleDeleteCard = useCallback(
      (id: string) => {
        gatedAction(() => onDeleteCard(id));
      },
      [gatedAction, onDeleteCard],
    );

    const handleDeleteSelectedCards = useCallback(() => {
      gatedAction(() => onDeleteSelectedCards());
    }, [gatedAction, onDeleteSelectedCards]);

    const handleReorderCards = useCallback(
      (fromIndex: number, toIndex: number) => {
        gatedAction(() => onReorderCards?.(fromIndex, toIndex));
      },
      [gatedAction, onReorderCards],
    );

    const handleReorderCardItem = useCallback(
      (from: DragLocation, to: DragLocation, itemType: 'card' | 'folder') => {
        gatedAction(() => onReorderCardItem?.(from, to, itemType));
      },
      [gatedAction, onReorderCardItem],
    );

    // ── New folder dialog state ──
    const [showNewFolderDialog, setShowNewFolderDialog] = useState(false);
    const [newFolderName, setNewFolderName] = useState('');
    const newFolderInputRef = useRef<HTMLInputElement>(null);
    useEffect(() => {
      if (showNewFolderDialog) {
        setNewFolderName('');
        setTimeout(() => newFolderInputRef.current?.focus(), 50);
      }
    }, [showNewFolderDialog]);

    const handleCreateFolder = useCallback(() => {
      gatedAction(() => setShowNewFolderDialog(true));
    }, [gatedAction]);

    const commitNewFolder = useCallback(() => {
      const trimmed = newFolderName.trim();
      if (!trimmed) return;
      onCreateEmptyFolder?.(trimmed);
      setShowNewFolderDialog(false);
    }, [newFolderName, onCreateEmptyFolder]);

    const handleCardDoubleClick = useCallback(
      (id: string) => setActiveCardId(id),
      [setActiveCardId],
    );

    const handleSelectExclusive = useCallback(
      (id: string) => {
        if (id === activeCardIdRef.current) {
          onSelectExclusive(id);
        } else {
          gatedAction(() => {
            onSelectExclusive(id);
            setActiveCardId(id);
          });
        }
      },
      [onSelectExclusive, gatedAction, setActiveCardId],
    );

    // Card list rendered inside the editor's sidebar slot
    const cardListSidebar = (
      <div className="px-2 pb-4">
        <InsightsCardList
          cards={cards}
          activeCardId={activeCardId}
          onCardClick={handleCardClick}
          onCardDoubleClick={handleCardDoubleClick}
          onToggleSelection={onToggleSelection}
          onSelectExclusive={handleSelectExclusive}
          onSelectRange={onSelectRange}
          onSelectAll={onSelectAll}
          onDeselectAll={onDeselectAll}
          onDeleteCard={handleDeleteCard}
          onDeleteSelectedCards={handleDeleteSelectedCards}
          onRenameCard={handleRenameCard}
          onCopyMoveCard={onCopyMoveCard}
          otherNuggets={otherNuggets}
          projectNuggets={projectNuggets}
          activeDetailLevel={detailLevel}
          onGenerateCardImage={onGenerateCardImage}
          onReorderCards={handleReorderCards}
          onReorderCardItem={handleReorderCardItem}
          onToggleFolderCollapsed={onToggleFolderCollapsed}
          onToggleFolderSelection={onToggleFolderSelection}
          onRenameFolder={onRenameFolder}
          onDeleteFolder={onDeleteFolder}
          onDuplicateFolder={onDuplicateFolder}
          onCopyMoveFolder={onCopyMoveFolder}
          onCreateEmptyFolder={handleCreateFolder}
          onCreateCustomCardInFolder={onCreateCustomCardInFolder}
        />
      </div>
    );

    // Reusable divider element
    const divider = (
      <div
        className="shrink-0 w-[5px] cursor-col-resize group relative select-none flex items-center justify-center"
        onPointerDown={handleDividerPointerDown}
        onPointerMove={handleDividerPointerMove}
        onPointerUp={handleDividerPointerUp}
      >
        <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-zinc-200 dark:bg-zinc-600 group-hover:bg-zinc-400 dark:group-hover:bg-zinc-500 transition-colors" />
        <div className="w-[5px] h-6 rounded-full bg-zinc-300 dark:bg-zinc-500 group-hover:bg-zinc-400 dark:group-hover:bg-zinc-400 transition-colors" />
      </div>
    );

    return (
      <>
        {shouldRender &&
          createPortal(
            <>
              <div
                data-panel-overlay
                className="fixed z-[103] flex flex-col bg-white dark:bg-zinc-900 border-4 shadow-[5px_0_6px_rgba(0,0,0,0.35)] overflow-hidden"
                style={{
                  borderColor: 'rgb(120,170,230)',
                  ...overlayStyle,
                }}
              >
                {/* Combined Cards & Assets content */}
                <div className="flex-1 flex overflow-hidden min-h-0">
                  {/* Left: Cards section (card list + card content) — both fixed widths */}
                  <div className="flex flex-col shrink-0 overflow-hidden">
                    {/* Cards content area */}
                    {hasSelectedNugget ? (
                      <div className="flex-1 flex overflow-hidden">
                        {/* Sidebar — lives outside keyed editor so scroll position is never lost */}
                        <aside
                          className="shrink-0 overflow-y-auto bg-white dark:bg-zinc-900"
                          style={{ width: sidebarWidth }}
                        >
                          <div className="shrink-0 sticky top-0 z-10 bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-600">
                            <div className="shrink-0 flex flex-row items-center pt-2 pb-1">
                              <div className="w-8 shrink-0 flex items-center justify-center">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-zinc-500 dark:text-zinc-400">
                                  <line x1="8" y1="6" x2="21" y2="6" />
                                  <line x1="8" y1="12" x2="21" y2="12" />
                                  <line x1="8" y1="18" x2="21" y2="18" />
                                  <line x1="3" y1="6" x2="3.01" y2="6" />
                                  <line x1="3" y1="12" x2="3.01" y2="12" />
                                  <line x1="3" y1="18" x2="3.01" y2="18" />
                                </svg>
                              </div>
                              <span className="text-[13px] font-bold uppercase tracking-wider text-zinc-800 dark:text-zinc-200">Cards List</span>
                            </div>
                          </div>
                          {cardListSidebar}
                        </aside>
                        {divider}
                        {activeCard && initialDocRef.current ? (
                          <DocumentEditorModal
                            ref={editorHandleRef}
                            document={initialDocRef.current}
                            mode="inline"
                            hideSidebar
                            onSave={handleSave}
                            onClose={noop}
                            contentCollapsed={contentCollapsed}
                            onContentCollapsedChange={setContentCollapsed}
                            contentMinWidth={contentWidth}
                          />
                        ) : (
                          <div className="flex-1 flex items-center justify-center">
                            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 font-light">Select a card to edit</p>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="flex-1" />
                    )}
                  </div>

                  {/* Right: Assets section with resizable divider */}
                  {assetsSlot && (
                    <>
                      <div
                        className="shrink-0 w-[5px] cursor-col-resize group relative select-none flex items-center justify-center"
                        onPointerDown={handleContentDividerDown}
                        onPointerMove={handleContentDividerMove}
                        onPointerUp={handleContentDividerUp}
                      >
                        <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-zinc-200 dark:bg-zinc-600 group-hover:bg-zinc-400 dark:group-hover:bg-zinc-500 transition-colors" />
                        <div className="w-[5px] h-6 rounded-full bg-zinc-300 dark:bg-zinc-500 group-hover:bg-zinc-400 dark:group-hover:bg-zinc-400 transition-colors" />
                      </div>
                      <div
                        ref={assetsContainerRef}
                        className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden bg-white dark:bg-zinc-900"
                        style={{ minWidth: MIN_ASSETS_WIDTH }}
                      >
                        {assetsSlot}
                      </div>
                    </>
                  )}
                </div>

                {/* Unsaved changes dialog */}
                {pendingAction && (
                  <UnsavedChangesDialog
                    onSave={() => {
                      editorHandleRef.current?.save();
                      const action = pendingAction;
                      setPendingAction(null);
                      action();
                    }}
                    onDiscard={() => {
                      editorHandleRef.current?.discard();
                      const action = pendingAction;
                      setPendingAction(null);
                      action();
                    }}
                    onCancel={() => setPendingAction(null)}
                  />
                )}
              </div>

            </>,
            document.body,
          )}

        {/* New folder name dialog — portalled to body */}
        {showNewFolderDialog && createPortal(
          <div
            className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 dark:bg-black/60 animate-in fade-in duration-300"
            onClick={() => setShowNewFolderDialog(false)}
          >
            <div
              className="w-full max-w-sm bg-white dark:bg-zinc-900 rounded-[40px] p-10 shadow-2xl dark:shadow-black/30 border border-zinc-100 dark:border-zinc-700 animate-in zoom-in-95 duration-300"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="space-y-6 text-center">
                <div className="w-16 h-16 flex items-center justify-center mx-auto">
                  <svg
                    width="36"
                    height="36"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-black"
                  >
                    <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
                    <line x1="12" y1="10" x2="12" y2="16" />
                    <line x1="9" y1="13" x2="15" y2="13" />
                  </svg>
                </div>
                <div className="space-y-2">
                  <h3 className="text-[15px] font-black tracking-tight text-zinc-800 dark:text-zinc-200">
                    New Folder
                  </h3>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 font-light leading-relaxed">
                    Enter a name for the new folder.
                  </p>
                </div>
                {(() => {
                  const nameConflict = isNameTaken(newFolderName.trim(), allFolderNames(cards));
                  const canSubmit = !!newFolderName.trim() && !nameConflict;
                  return (
                    <>
                      <div className="text-left space-y-1.5">
                        <label
                          htmlFor="new-folder-name"
                          className="text-[9px] font-black uppercase tracking-[0.15em] text-zinc-500 dark:text-zinc-400"
                        >
                          Folder Name
                        </label>
                        <input
                          id="new-folder-name"
                          ref={newFolderInputRef}
                          value={newFolderName}
                          onChange={(e) => setNewFolderName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && canSubmit) commitNewFolder();
                            if (e.key === 'Escape') setShowNewFolderDialog(false);
                          }}
                          placeholder="Enter a name for this folder"
                          className={`w-full px-4 py-3 rounded-2xl border bg-zinc-50 dark:bg-zinc-800 text-xs text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-2 transition-colors placeholder:text-zinc-500 ${
                            nameConflict
                              ? 'border-red-300 focus:border-red-400 focus:ring-red-300/50'
                              : 'border-zinc-200 dark:border-zinc-700 focus:border-black focus:ring-zinc-400/50 dark:focus:ring-zinc-500/50'
                          }`}
                        />
                        {nameConflict && (
                          <p className="text-[10px] text-red-500 mt-1">A folder with this name already exists</p>
                        )}
                      </div>
                      <div className="flex flex-col space-y-3 pt-4">
                        <button
                          onClick={commitNewFolder}
                          disabled={!canSubmit}
                          className="w-full py-4 rounded-full bg-black text-white text-[10px] font-black uppercase tracking-widest hover:scale-[1.02] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          Create Folder
                        </button>
                        <button
                          onClick={() => setShowNewFolderDialog(false)}
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
      </>
    );
  },
);

export default React.memo(CardsPanel);
