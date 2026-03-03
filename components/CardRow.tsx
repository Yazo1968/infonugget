import React, { useRef, useState, useEffect } from 'react';
import { Card, isCoverLevel } from '../types';

/** Middle-truncate text: show start + "..." + end when it overflows its container. */
export const MiddleTruncate: React.FC<{ text: string; className?: string; style?: React.CSSProperties }> = ({ text, className, style }) => {
  const containerRef = useRef<HTMLParagraphElement>(null);
  const [display, setDisplay] = useState(text);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const measure = () => {
      // Reset to full text to measure true scrollWidth
      el.textContent = text;
      if (el.scrollWidth <= el.clientWidth) {
        setDisplay(text);
        return;
      }
      // Binary search for the max chars that fit with "..." + last 3
      const tail = text.slice(-3);
      let lo = 0, hi = text.length - 3;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        el.textContent = text.slice(0, mid) + '\u2026' + tail;
        if (el.scrollWidth <= el.clientWidth) lo = mid;
        else hi = mid - 1;
      }
      setDisplay(lo > 0 ? text.slice(0, lo) + '\u2026' + tail : text);
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text]);

  return (
    <p
      ref={containerRef}
      className={className}
      style={{ ...style, overflow: 'hidden', whiteSpace: 'nowrap' }}
      title={text}
    >
      {display}
    </p>
  );
};

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
  const level = card.detailLevel || 'Standard';
  const badgeLetter =
    level === 'TitleCard' ? 'T'
    : level === 'TakeawayCard' ? 'A'
    : level === 'DirectContent' ? 'S'
    : level === 'Executive' ? 'E'
    : level === 'Detailed' ? 'D'
    : 'S'; // Standard
  const badgeTitle =
    level === 'TitleCard' ? 'Title Card'
    : level === 'TakeawayCard' ? 'Takeaway Card'
    : level === 'DirectContent' ? 'Snapshot'
    : level;
  const badgeColor =
    level === 'TitleCard'      ? 'text-violet-600 bg-violet-100 dark:text-violet-400 dark:bg-violet-900/40 border-violet-200 dark:border-violet-700'
    : level === 'TakeawayCard' ? 'text-amber-600 bg-amber-100 dark:text-amber-400 dark:bg-amber-900/40 border-amber-200 dark:border-amber-700'
    : level === 'Executive'    ? 'text-blue-600 bg-blue-100 dark:text-blue-400 dark:bg-blue-900/40 border-blue-200 dark:border-blue-700'
    : level === 'Detailed'     ? 'text-cyan-600 bg-cyan-100 dark:text-cyan-400 dark:bg-cyan-900/40 border-cyan-200 dark:border-cyan-700'
    : level === 'DirectContent'? 'text-emerald-600 bg-emerald-100 dark:text-emerald-400 dark:bg-emerald-900/40 border-emerald-200 dark:border-emerald-700'
    :                            'text-slate-600 bg-slate-100 dark:text-slate-400 dark:bg-slate-800 border-slate-200 dark:border-slate-600';

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

      {/* Detail level badge — single letter */}
      <span
        className={`shrink-0 w-3.5 h-3.5 flex items-center justify-center rounded-[3px] border text-[8px] font-bold leading-none ${badgeColor}`}
        title={badgeTitle}
      >
        {badgeLetter}
      </span>

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
          <MiddleTruncate
            text={card.text}
            className={`text-[11px] ${
              isSynthesizing ? 'font-medium italic' : isActive ? 'font-semibold' : 'font-medium'
            }`}
            style={{
              color: isSynthesizing ? 'var(--tree-icon-dim)' : isActive ? 'var(--tree-active)' : 'var(--tree-text-dim)',
            }}
          />
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
