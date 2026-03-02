import React from 'react';
import { Card, isCoverLevel } from '../types';

export interface CardRowProps {
  card: Card;
  isActive: boolean;
  isSelected: boolean;
  isGenerating: boolean;
  isSynthesizing: boolean;
  visIdx: number;
  gapStyle: React.CSSProperties;
  isDragging: boolean;
  // Rename state
  isRenaming: boolean;
  renameValue: string;
  renameError: string;
  renameInputRef?: React.RefObject<HTMLInputElement | null>;
  // Drag ref — not compared in memo
  dragStateRef: React.RefObject<{ active: boolean } | null>;
  // Callbacks (must be stable)
  onCardClick: (id: string) => void;
  onCardDoubleClick?: (id: string) => void;
  onToggleSelection: (id: string) => void;
  onPointerDown: (e: React.PointerEvent, visIdx: number, text: string) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onContextMenu: (e: React.MouseEvent, cardId: string) => void;
  onRenameChange: (value: string) => void;
  onRenameCommit: (id: string) => void;
  onRenameCancel: () => void;
}

const CardRow: React.FC<CardRowProps> = ({
  card,
  isActive,
  isSelected,
  isGenerating,
  isSynthesizing,
  visIdx,
  gapStyle,
  isDragging,
  isRenaming,
  renameValue,
  renameError,
  renameInputRef,
  dragStateRef,
  onCardClick,
  onCardDoubleClick,
  onToggleSelection,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onContextMenu,
  onRenameChange,
  onRenameCommit,
  onRenameCancel,
}) => {
  const isTitleCard = card.detailLevel === 'TitleCard';
  const showBadge = isCoverLevel(card.detailLevel || 'Standard');

  return (
    <div
      role="button"
      tabIndex={0}
      data-card-id={card.id}
      data-vis-idx={visIdx}
      onPointerDown={(e) => onPointerDown(e, visIdx, card.text)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      style={{
        ...gapStyle,
        ...(isDragging ? { opacity: 0, pointerEvents: 'none' as const } : {}),
      }}
      className={`group relative flex items-center gap-1 px-1.5 py-1 cursor-pointer select-none transition-all duration-150 ${
        isActive ? 'sidebar-node-active' : 'border border-transparent hover:border-blue-300'
      }`}
      onClick={(e) => {
        if (dragStateRef.current?.active) return;
        e.stopPropagation();
        onCardClick(card.id);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onCardClick(card.id);
        }
      }}
      onDoubleClick={() => onCardDoubleClick?.(card.id)}
    >
      {/* Selection checkbox */}
      <div
        role="checkbox"
        aria-checked={isSelected}
        tabIndex={0}
        onClick={(e) => {
          e.stopPropagation();
          onToggleSelection(card.id);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            onToggleSelection(card.id);
          }
        }}
        className="shrink-0 w-3 h-3 rounded-[2px] border flex items-center justify-center cursor-pointer bg-white dark:bg-zinc-900"
        style={{ borderColor: 'var(--tree-icon-dim)' }}
      >
        {isSelected && (
          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="rgb(42,159,212)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
      </div>

      {isSynthesizing && (
        <div className="shrink-0 w-3.5 h-3.5 rounded-full border-[1.5px] border-zinc-200 dark:border-zinc-600 border-t-blue-500 dark:border-t-blue-400 animate-spin" title="Generating content…" />
      )}

      {isGenerating && (
        <div className="shrink-0 w-3.5 h-3.5 rounded-full border-[1.5px] border-zinc-200 dark:border-zinc-600 border-t-zinc-500 dark:border-t-zinc-400 animate-spin" title="Generating image…" />
      )}

      {showBadge && (
        <div className="flex items-center gap-0.5 shrink-0" title={isTitleCard ? 'Title Card' : 'Takeaway Card'}>
          {isTitleCard ? (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-violet-500">
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <path d="M8 21h8" />
              <path d="M12 17v4" />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-500">
              <path d="M9 18h6" />
              <path d="M10 22h4" />
              <path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z" />
            </svg>
          )}
          <span className={`text-[7px] font-bold uppercase tracking-wider px-1 py-[1px] rounded ${isTitleCard ? 'text-violet-600 bg-violet-50' : 'text-amber-600 bg-amber-50'}`}>
            {isTitleCard ? 'Title' : 'Takeaway'}
          </span>
        </div>
      )}

      {/* Card title or rename input */}
      <div className="flex-1 min-w-0">
        {isRenaming ? (
          <div>
            <input
              ref={renameInputRef}
              value={renameValue}
              onChange={(e) => onRenameChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onRenameCommit(card.id);
                if (e.key === 'Escape') onRenameCancel();
              }}
              onBlur={() => onRenameCommit(card.id)}
              onClick={(e) => e.stopPropagation()}
              className={`w-full text-[11px] font-medium text-zinc-800 dark:text-zinc-200 bg-white dark:bg-zinc-900 border rounded px-1.5 py-0.5 outline-none ${renameError ? 'border-red-400 focus:border-red-400' : 'border-zinc-300 dark:border-zinc-600 focus:border-zinc-400'}`}
              aria-invalid={!!renameError || undefined}
              aria-describedby={renameError ? 'card-rename-error' : undefined}
            />
            {renameError && (
              <p id="card-rename-error" className="text-[9px] text-red-500 mt-0.5">{renameError}</p>
            )}
          </div>
        ) : (
          <p
            className={`text-[11px] truncate ${
              isSynthesizing ? 'font-medium italic' : isActive ? 'font-semibold' : 'font-medium'
            }`}
            style={{
              color: isSynthesizing ? 'var(--tree-icon-dim)' : isActive ? 'var(--tree-active)' : 'var(--tree-text-dim)',
            }}
            title={card.text}
          >
            {card.text}
          </p>
        )}
      </div>

      {/* Kebab menu button */}
      <button
        onClick={(e) => onContextMenu(e, card.id)}
        className="shrink-0 w-5 h-5 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 transition-opacity hover:text-zinc-600 dark:hover:text-zinc-300"
        style={{ color: 'var(--tree-icon-dim)' }}
        aria-label="Card menu"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="5" r="1" />
          <circle cx="12" cy="12" r="1" />
          <circle cx="12" cy="19" r="1" />
        </svg>
      </button>
    </div>
  );
};

export default React.memo(CardRow, (prev, next) => {
  if (
    prev.card.id !== next.card.id ||
    prev.card.text !== next.card.text ||
    prev.card.selected !== next.card.selected ||
    prev.card.detailLevel !== next.card.detailLevel ||
    prev.isActive !== next.isActive ||
    prev.isSelected !== next.isSelected ||
    prev.isGenerating !== next.isGenerating ||
    prev.isSynthesizing !== next.isSynthesizing ||
    prev.isDragging !== next.isDragging ||
    prev.visIdx !== next.visIdx ||
    prev.isRenaming !== next.isRenaming
  ) return false;
  // Only compare rename details when actively renaming this row
  if (next.isRenaming) {
    if (prev.renameValue !== next.renameValue || prev.renameError !== next.renameError) return false;
  }
  // Compare gapStyle transform (changes during drag)
  if ((prev.gapStyle as any).transform !== (next.gapStyle as any).transform) return false;
  return true;
});
