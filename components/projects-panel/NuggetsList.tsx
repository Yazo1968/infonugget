import React, { useRef, useEffect } from 'react';
import { Nugget } from '../../types';

interface NuggetsListProps {
  nuggets: Nugget[];
  selectedNuggetId: string | null;
  renamingId: string | null;
  renameValue: string;
  renameError: string;
  onSelect: (nuggetId: string) => void;
  onDoubleClick: (nuggetId: string) => void;
  onContextMenu: (nuggetId: string, pos: { x: number; y: number }) => void;
  onRenameChange: (value: string) => void;
  onRenameCommit: () => void;
  onRenameCancel: () => void;
  isCreatingInline: boolean;
  inlineCreateName: string;
  inlineCreateError: string;
  onInlineCreateChange: (name: string) => void;
  onInlineCreateCommit: () => void;
  onInlineCreateCancel: () => void;
  onStartCreate: () => void;
}

const NuggetsList: React.FC<NuggetsListProps> = ({
  nuggets,
  selectedNuggetId,
  renamingId,
  renameValue,
  renameError,
  onSelect,
  onDoubleClick,
  onContextMenu,
  onRenameChange,
  onRenameCommit,
  onRenameCancel,
  isCreatingInline,
  inlineCreateName,
  inlineCreateError,
  onInlineCreateChange,
  onInlineCreateCommit,
  onInlineCreateCancel,
  onStartCreate,
}) => {
  const renameInputRef = useRef<HTMLInputElement>(null);
  const createInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renamingId) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [renamingId]);

  useEffect(() => {
    if (isCreatingInline) {
      createInputRef.current?.focus();
      createInputRef.current?.select();
    }
  }, [isCreatingInline]);

  return (
    <div className="flex-1 overflow-y-auto px-2 py-1" style={{ scrollbarWidth: 'thin' }}>
      {nuggets.map((nugget) => {
        const isSelected = selectedNuggetId === nugget.id;
        const isRenaming = renamingId === nugget.id;
        const docCount = nugget.documents?.length ?? 0;

        return (
          <div
            key={nugget.id}
            role="button"
            tabIndex={0}
            onClick={() => {
              if (isRenaming) return;
              onSelect(nugget.id);
            }}
            onDoubleClick={() => {
              if (isRenaming) return;
              onDoubleClick(nugget.id);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              onSelect(nugget.id);
              onContextMenu(nugget.id, { x: e.clientX, y: e.clientY });
            }}
            onKeyDown={(e) => {
              if (isRenaming) return;
              if (e.key === 'Enter') {
                e.preventDefault();
                onDoubleClick(nugget.id);
              }
            }}
            className={`group relative flex items-center gap-2 px-2.5 py-1.5 cursor-pointer select-none transition-all duration-150 rounded ${
              isSelected ? 'sidebar-node-active' : 'border border-transparent hover:border-blue-300'
            }`}
          >
            {/* Diamond icon */}
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="shrink-0"
              style={{ color: isSelected ? 'var(--tree-icon)' : 'var(--tree-icon-dim)' }}
            >
              <path d="M2.7 10.3a2.41 2.41 0 0 0 0 3.41l7.59 7.59a2.41 2.41 0 0 0 3.41 0l7.59-7.59a2.41 2.41 0 0 0 0-3.41l-7.59-7.59a2.41 2.41 0 0 0-3.41 0Z" />
            </svg>

            {/* Name */}
            <div className="flex-1 min-w-0">
              {isRenaming ? (
                <div>
                  <input
                    ref={renameInputRef}
                    value={renameValue}
                    onChange={(e) => onRenameChange(e.target.value)}
                    onBlur={onRenameCommit}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') onRenameCommit();
                      if (e.key === 'Escape') onRenameCancel();
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className={`w-full text-[11px] font-medium text-zinc-800 dark:text-zinc-200 bg-white dark:bg-zinc-900 border rounded px-1.5 py-0.5 outline-none ${
                      renameError ? 'border-red-400 focus:border-red-400' : 'border-zinc-300 dark:border-zinc-600 focus:border-zinc-400'
                    }`}
                  />
                  {renameError && <p className="text-[9px] text-red-500 mt-0.5">{renameError}</p>}
                </div>
              ) : (
                <p
                  className={`text-[11px] truncate ${isSelected ? 'font-medium' : 'font-normal'}`}
                  style={{ color: isSelected ? 'var(--tree-active)' : 'var(--tree-text-dim)' }}
                  title={nugget.name}
                >
                  {nugget.name}
                </p>
              )}
            </div>

            {/* Doc count */}
            {docCount > 0 && !isRenaming && (
              <span
                className="shrink-0 text-[10px] font-normal"
                style={{ color: isSelected ? 'var(--tree-icon)' : 'var(--tree-icon-dim)' }}
              >
                {docCount}
              </span>
            )}

            {/* Kebab button */}
            {!isRenaming && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onContextMenu(nugget.id, { x: e.clientX, y: e.clientY });
                }}
                className="shrink-0 w-5 h-5 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ color: isSelected ? 'var(--tree-icon)' : 'rgba(100,116,139,0.5)' }}
                aria-label="Nugget menu"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="5" r="1" />
                  <circle cx="12" cy="12" r="1" />
                  <circle cx="12" cy="19" r="1" />
                </svg>
              </button>
            )}
          </div>
        );
      })}

      {/* Inline creation row */}
      {isCreatingInline && (
        <div className="flex items-center gap-2 px-2.5 py-1.5 rounded sidebar-node-active">
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="shrink-0"
            style={{ color: 'var(--tree-icon)' }}
          >
            <path d="M2.7 10.3a2.41 2.41 0 0 0 0 3.41l7.59 7.59a2.41 2.41 0 0 0 3.41 0l7.59-7.59a2.41 2.41 0 0 0 0-3.41l-7.59-7.59a2.41 2.41 0 0 0-3.41 0Z" />
          </svg>
          <div className="flex-1 min-w-0">
            <input
              ref={createInputRef}
              value={inlineCreateName}
              onChange={(e) => onInlineCreateChange(e.target.value)}
              onBlur={() => {
                if (inlineCreateName.trim() && !inlineCreateError) onInlineCreateCommit();
                else onInlineCreateCancel();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && inlineCreateName.trim() && !inlineCreateError) onInlineCreateCommit();
                if (e.key === 'Escape') onInlineCreateCancel();
              }}
              className={`w-full text-[11px] font-medium text-zinc-800 dark:text-zinc-200 bg-white dark:bg-zinc-900 border rounded px-1.5 py-0.5 outline-none ${
                inlineCreateError ? 'border-red-400 focus:border-red-400' : 'border-zinc-300 dark:border-zinc-600 focus:border-zinc-400'
              }`}
            />
            {inlineCreateError && <p className="text-[9px] text-red-500 mt-0.5">{inlineCreateError}</p>}
          </div>
        </div>
      )}

      {/* "+ Create New Nugget" button */}
      {!isCreatingInline && (
        <button
          onClick={onStartCreate}
          className="w-full flex items-center gap-2 px-2.5 py-2 mt-1 text-[11px] font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors"
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
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Create New Nugget
        </button>
      )}
    </div>
  );
};

export default NuggetsList;
