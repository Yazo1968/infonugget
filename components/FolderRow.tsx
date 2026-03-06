import React from 'react';
import { Card, CardFolder, DetailLevel } from '../types';
import CardRow, { MiddleTruncate } from './CardRow';

export interface FolderRowProps {
  folder: CardFolder;
  folderVisIdx: number;
  firstChildVisIdx: number;
  activeCardId: string | null;
  activeDetailLevel?: DetailLevel;
  gapStyle: React.CSSProperties;
  isDragging: boolean;
  isDropTarget: boolean;
  // Folder rename state
  isRenamingFolder: boolean;
  folderRenameValue: string;
  folderRenameError: string;
  folderRenameInputRef?: React.RefObject<HTMLInputElement | null>;
  // Child card rename state
  renamingId: string | null;
  renameValue: string;
  renameError: string;
  renameInputRef?: React.RefObject<HTMLInputElement | null>;
  // Drag state for children
  dragSourceVisIdx: number | null;
  getGapStyle: (visIdx: number) => React.CSSProperties;
  dragStateRef: React.RefObject<{ active: boolean } | null>;
  // Folder callbacks
  onToggleFolderCollapsed?: (folderId: string) => void;
  onToggleFolderSelection?: (folderId: string) => void;
  onFolderContextMenu: (e: React.MouseEvent, folderId: string) => void;
  onFolderRenameChange: (value: string) => void;
  onFolderRenameCommit: (folderId: string) => void;
  onFolderRenameCancel: () => void;
  // Folder drag
  onPointerDown: (e: React.PointerEvent, visIdx: number, text: string) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  // Card callbacks (passed through to child CardRows)
  onCardClick: (id: string) => void;
  onCardDoubleClick?: (id: string) => void;
  onToggleSelection: (id: string) => void;
  onCardContextMenu: (e: React.MouseEvent, cardId: string) => void;
  onRenameChange: (value: string) => void;
  onRenameCommit: (id: string) => void;
  onRenameCancel: () => void;
}

const FolderRow: React.FC<FolderRowProps> = ({
  folder,
  folderVisIdx,
  firstChildVisIdx,
  activeCardId,
  activeDetailLevel,
  gapStyle,
  isDragging,
  isDropTarget,
  isRenamingFolder,
  folderRenameValue,
  folderRenameError,
  folderRenameInputRef,
  renamingId,
  renameValue,
  renameError,
  renameInputRef,
  dragSourceVisIdx,
  getGapStyle,
  dragStateRef,
  onToggleFolderCollapsed,
  onToggleFolderSelection,
  onFolderContextMenu,
  onFolderRenameChange,
  onFolderRenameCommit,
  onFolderRenameCancel,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onCardClick,
  onCardDoubleClick,
  onToggleSelection,
  onCardContextMenu,
  onRenameChange,
  onRenameCommit,
  onRenameCancel,
}) => {
  const allChildrenSelected = folder.cards.length > 0 && folder.cards.every((c) => c.selected);
  const someChildrenSelected = !allChildrenSelected && folder.cards.some((c) => c.selected);
  const containsActiveCard = activeCardId !== null && folder.cards.some((c) => c.id === activeCardId);

  return (
    <React.Fragment>
      {/* Folder header */}
      <div
        data-vis-idx={folderVisIdx}
        onPointerDown={(e) => onPointerDown(e, folderVisIdx, folder.name)}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        style={{
          ...gapStyle,
          ...(isDragging ? { opacity: 0, pointerEvents: 'none' as const } : {}),
        }}
        className={`group flex items-center gap-1 px-1.5 py-1 cursor-pointer select-none ${
          isDropTarget
            ? 'bg-blue-50 dark:bg-blue-950/30 border border-blue-400 dark:border-blue-500 rounded'
            : containsActiveCard
              ? 'sidebar-node-active-dim'
              : ''
        }`}
      >
        {/* Chevron */}
        <button
          onClick={(e) => { e.stopPropagation(); onToggleFolderCollapsed?.(folder.id); }}
          className="shrink-0 w-4 h-4 flex items-center justify-center"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            className={`transition-transform duration-150 ${folder.collapsed ? '-rotate-90' : ''}`}
            style={{ color: 'var(--tree-icon)' }}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        {/* Checkbox */}
        <div
          role="checkbox"
          aria-checked={allChildrenSelected}
          onClick={(e) => { e.stopPropagation(); onToggleFolderSelection?.(folder.id); }}
          className="shrink-0 w-3 h-3 rounded-[2px] border flex items-center justify-center cursor-pointer bg-white dark:bg-zinc-900"
          style={{ borderColor: 'var(--tree-icon-dim)' }}
        >
          {allChildrenSelected ? (
            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="rgb(42,159,212)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : someChildrenSelected ? (
            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="rgb(42,159,212)" strokeWidth="3.5" strokeLinecap="round">
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          ) : null}
        </div>

        {/* Wallet-cards icon */}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" style={{ color: 'var(--tree-text)' }}>
          <rect width="18" height="18" x="3" y="3" rx="2" />
          <path d="M3 9a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2" />
          <path d="M3 11h3c.8 0 1.6.3 2.1.9l1.1.9c1.6 1.6 4.1 1.6 5.7 0l1.1-.9c.5-.5 1.3-.9 2.1-.9H21" />
        </svg>

        {/* Folder name or rename input */}
        <div className="flex-1 min-w-0">
          {isRenamingFolder ? (
            <div>
              <input
                ref={folderRenameInputRef}
                value={folderRenameValue}
                onChange={(e) => onFolderRenameChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onFolderRenameCommit(folder.id);
                  if (e.key === 'Escape') onFolderRenameCancel();
                }}
                onBlur={() => onFolderRenameCommit(folder.id)}
                onClick={(e) => e.stopPropagation()}
                className={`w-full text-[11px] font-semibold text-zinc-700 dark:text-zinc-300 bg-white dark:bg-zinc-900 border rounded px-1.5 py-0.5 outline-none ${folderRenameError ? 'border-red-400 focus:border-red-400' : 'border-zinc-300 dark:border-zinc-600 focus:border-zinc-400'}`}
                aria-invalid={!!folderRenameError || undefined}
              />
              {folderRenameError && (
                <p className="text-[9px] text-red-500 mt-0.5">{folderRenameError}</p>
              )}
            </div>
          ) : (
            <MiddleTruncate
              text={folder.name}
              className="text-[11px] font-semibold"
              style={{ color: 'var(--tree-text)' }}
            />
          )}
        </div>

        {/* Card count badge */}
        <span className="text-[9px] font-medium tabular-nums" style={{ color: 'var(--tree-icon-dim)' }}>
          {folder.cards.length}
        </span>

        {/* Kebab menu */}
        <button
          onClick={(e) => onFolderContextMenu(e, folder.id)}
          className="shrink-0 w-5 h-5 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 transition-opacity hover:text-zinc-600 dark:hover:text-zinc-300"
          style={{ color: 'var(--tree-icon-dim)' }}
          aria-label="Folder menu"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="5" r="1" />
            <circle cx="12" cy="12" r="1" />
            <circle cx="12" cy="19" r="1" />
          </svg>
        </button>
      </div>

      {/* Folder children */}
      {!folder.collapsed && (
        <div className="ml-5 pl-3 border-l" style={{ borderColor: 'var(--tree-icon-dim)' }}>
          {folder.cards.map((card, cardIndex) => {
            const childVisIdx = firstChildVisIdx + cardIndex;
            return (
              <CardRow
                key={card.id}
                card={card}
                visIdx={childVisIdx}
                isActive={card.id === activeCardId}
                isSelected={!!card.selected}
                isGenerating={!!(activeDetailLevel && card.isGeneratingMap?.[activeDetailLevel])}
                isSynthesizing={!!(activeDetailLevel && card.isSynthesizingMap?.[activeDetailLevel])}
                gapStyle={getGapStyle(childVisIdx)}
                isDragging={dragSourceVisIdx === childVisIdx}
                isRenaming={renamingId === card.id}
                renameValue={renameValue}
                renameError={renameError}
                renameInputRef={renamingId === card.id ? renameInputRef : undefined}
                dragStateRef={dragStateRef}
                onCardClick={onCardClick}
                onCardDoubleClick={onCardDoubleClick}
                onToggleSelection={onToggleSelection}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onContextMenu={onCardContextMenu}
                onRenameChange={onRenameChange}
                onRenameCommit={onRenameCommit}
                onRenameCancel={onRenameCancel}
              />
            );
          })}
        </div>
      )}
    </React.Fragment>
  );
};

export default React.memo(FolderRow);
