import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Nugget } from '../types';
import NuggetCreationDialog from './NuggetCreationDialog';

interface NuggetTabBarProps {
  projectNuggets: Nugget[];
  allProjectNuggets: Nugget[];
  selectedNuggetId: string | null;
  onSelectNugget: (nuggetId: string) => void;
  onCreateNugget: (name: string, files: File[]) => void;
  onRenameNugget: (nuggetId: string, newName: string) => void;
  onDeleteNugget: (nuggetId: string) => void;
  onDuplicateNugget: (nuggetId: string) => void;
  onCloseTab: (nuggetId: string) => void;
  onOpenTab: (nuggetId: string) => void;
  darkMode: boolean;
}

const NuggetTabBar: React.FC<NuggetTabBarProps> = ({
  projectNuggets,
  allProjectNuggets,
  selectedNuggetId,
  onSelectNugget,
  onCreateNugget,
  onRenameNugget,
  onDeleteNugget,
  onDuplicateNugget,
  onCloseTab,
  onOpenTab,
  darkMode,
}) => {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [menuId, setMenuId] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [addMenuPos, setAddMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  const renameInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const tabButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  // Nuggets not currently shown as tabs
  const nonTabbedNuggets = allProjectNuggets.filter(
    (n) => !projectNuggets.some((pn) => pn.id === n.id),
  );

  // Focus rename input
  useEffect(() => {
    if (renamingId) renameInputRef.current?.focus();
  }, [renamingId]);

  // Close menu on outside click
  useEffect(() => {
    if (!menuId) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuId(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuId]);

  // Close add menu on outside click
  useEffect(() => {
    if (!addMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) {
        setAddMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [addMenuOpen]);

  const handleRenameSubmit = useCallback(
    (nuggetId: string, originalName: string) => {
      const trimmed = renameValue.trim();
      if (trimmed && trimmed !== originalName) {
        onRenameNugget(nuggetId, trimmed);
      }
      setRenamingId(null);
    },
    [renameValue, onRenameNugget],
  );

  return (
    <>
      <div
        className={`shrink-0 flex items-end px-1 ${darkMode ? 'bg-zinc-900' : 'bg-zinc-100'}`}
        style={{ height: 40, borderBottom: '3px solid var(--accent-blue, #2a9fd4)' }}
      >
        {/* Scrollable tab area */}
        <div
          ref={scrollRef}
          className="flex items-end gap-0.5 flex-1 min-w-0 overflow-x-auto"
          style={{ scrollbarWidth: 'none' }}
        >
          {projectNuggets.map((nugget, index) => {
            const isActive = nugget.id === selectedNuggetId;
            const isRenaming = renamingId === nugget.id;

            return (
              <React.Fragment key={nugget.id}>
                {index > 0 && (
                  <div className={`shrink-0 w-px h-3.5 mx-0.5 self-center ${darkMode ? 'bg-zinc-600' : 'bg-zinc-400'}`} />
                )}
                <div
                  className="relative flex items-center shrink-0 group mb-[-1px]"
                >
                {/* Tab button — click selects + opens dropdown menu */}
                <button
                  ref={(el) => { if (el) tabButtonRefs.current.set(nugget.id, el); else tabButtonRefs.current.delete(nugget.id); }}
                  onClick={() => {
                    if (isRenaming) return;
                    onSelectNugget(nugget.id);
                    if (menuId === nugget.id) {
                      setMenuId(null);
                      setMenuPos(null);
                    } else {
                      const btn = tabButtonRefs.current.get(nugget.id);
                      if (btn) {
                        const rect = btn.getBoundingClientRect();
                        setMenuPos({ top: rect.bottom + 2, left: rect.left });
                      }
                      setMenuId(nugget.id);
                    }
                  }}
                  className={`flex items-center gap-1.5 px-3.5 h-[32px] rounded-t-md text-[12px] font-medium transition-colors relative border border-b-0 ${
                    isActive
                      ? darkMode
                        ? 'text-zinc-100 bg-[#2a9fd4] border-[#2a9fd4]'
                        : 'text-white bg-[#2a9fd4] border-[#2a9fd4]'
                      : darkMode
                        ? 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60 border-zinc-700'
                        : 'text-zinc-500 hover:text-zinc-700 hover:bg-white/40 border-zinc-300'
                  }`}
                  style={undefined}
                  title={nugget.name}
                >
                  {/* Nugget diamond icon */}
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${isActive ? 'opacity-70' : 'opacity-40'}`}>
                    <rect x="6" y="6" width="12" height="12" rx="2" transform="rotate(45 12 12)" />
                  </svg>

                  {isRenaming ? (
                    <input
                      ref={renameInputRef}
                      type="text"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === 'Enter') handleRenameSubmit(nugget.id, nugget.name);
                        if (e.key === 'Escape') setRenamingId(null);
                      }}
                      onBlur={() => handleRenameSubmit(nugget.id, nugget.name)}
                      className={`w-24 bg-transparent outline-none border-b text-[11px] font-medium ${
                        darkMode ? 'text-zinc-100 border-zinc-600' : 'text-zinc-900 border-zinc-400'
                      }`}
                    />
                  ) : (
                    <span className="truncate max-w-[120px]">{nugget.name}</span>
                  )}

                  {/* Dropdown chevron */}
                  {!isRenaming && (
                    <svg
                      width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
                      className={`shrink-0 opacity-40 transition-transform ${menuId === nugget.id ? 'rotate-180' : ''}`}
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  )}
                </button>

                {/* Dropdown menu — portalled to body to escape overflow clipping */}
                {menuId === nugget.id && menuPos && createPortal(
                  <div
                    ref={menuRef}
                    className={`fixed w-36 rounded-lg shadow-lg border py-1 z-[140] ${
                      darkMode ? 'bg-zinc-900 border-zinc-700' : 'bg-white border-zinc-200'
                    }`}
                    style={{ top: menuPos.top, left: menuPos.left }}
                  >
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuId(null);
                        setMenuPos(null);
                        onCloseTab(nugget.id);
                      }}
                      className={`w-full text-left px-3 py-1.5 text-[11px] flex items-center gap-2 transition-colors ${
                        darkMode ? 'text-zinc-300 hover:bg-zinc-800' : 'text-zinc-700 hover:bg-zinc-50'
                      }`}
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                      Close Tab
                    </button>
                    <div className={`my-1 h-px ${darkMode ? 'bg-zinc-700' : 'bg-zinc-200'}`} />
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuId(null);
                        setMenuPos(null);
                        setRenameValue(nugget.name);
                        setRenamingId(nugget.id);
                      }}
                      className={`w-full text-left px-3 py-1.5 text-[11px] flex items-center gap-2 transition-colors ${
                        darkMode ? 'text-zinc-300 hover:bg-zinc-800' : 'text-zinc-700 hover:bg-zinc-50'
                      }`}
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                        <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                      </svg>
                      Rename
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuId(null);
                        setMenuPos(null);
                        onDuplicateNugget(nugget.id);
                      }}
                      className={`w-full text-left px-3 py-1.5 text-[11px] flex items-center gap-2 transition-colors ${
                        darkMode ? 'text-zinc-300 hover:bg-zinc-800' : 'text-zinc-700 hover:bg-zinc-50'
                      }`}
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                        <rect width="14" height="14" x="8" y="8" rx="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                      </svg>
                      Duplicate
                    </button>
                    <div className={`my-1 h-px ${darkMode ? 'bg-zinc-700' : 'bg-zinc-200'}`} />
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuId(null);
                        setMenuPos(null);
                        setConfirmDeleteId(nugget.id);
                      }}
                      className={`w-full text-left px-3 py-1.5 text-[11px] flex items-center gap-2 transition-colors ${
                        darkMode ? 'text-red-400 hover:bg-zinc-800' : 'text-red-500 hover:bg-red-50'
                      }`}
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                        <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                      Delete
                    </button>
                  </div>,
                  document.body,
                )}
                </div>
              </React.Fragment>
            );
          })}

          {/* Add nugget: "+" button with dropdown */}
          <button
            ref={addButtonRef}
            onClick={() => {
              if (addMenuOpen) {
                setAddMenuOpen(false);
                setAddMenuPos(null);
              } else {
                const btn = addButtonRef.current;
                if (btn) {
                  const rect = btn.getBoundingClientRect();
                  setAddMenuPos({ top: rect.bottom + 2, left: rect.left });
                }
                setAddMenuOpen(true);
              }
            }}
            className={`shrink-0 w-[26px] h-[26px] rounded-md flex items-center justify-center transition-colors ${
              darkMode
                ? 'text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800'
                : 'text-zinc-400 hover:text-zinc-600 hover:bg-white/50'
            }`}
            title="Add nugget"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Add nugget dropdown menu */}
      {addMenuOpen && addMenuPos && createPortal(
        <div
          ref={addMenuRef}
          className={`fixed w-48 rounded-lg shadow-lg border py-1 z-[140] ${
            darkMode ? 'bg-zinc-900 border-zinc-700' : 'bg-white border-zinc-200'
          }`}
          style={{ top: addMenuPos.top, left: addMenuPos.left }}
        >
          {nonTabbedNuggets.map((nugget) => (
            <button
              key={nugget.id}
              onClick={(e) => {
                e.stopPropagation();
                setAddMenuOpen(false);
                setAddMenuPos(null);
                onOpenTab(nugget.id);
              }}
              className={`w-full text-left px-3 py-1.5 text-[11px] flex items-center gap-2 transition-colors ${
                darkMode ? 'text-zinc-300 hover:bg-zinc-800' : 'text-zinc-700 hover:bg-zinc-50'
              }`}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-50">
                <rect x="6" y="6" width="12" height="12" rx="2" transform="rotate(45 12 12)" />
              </svg>
              <span className="truncate">{nugget.name}</span>
            </button>
          ))}
          {nonTabbedNuggets.length > 0 && (
            <div className={`my-1 h-px ${darkMode ? 'bg-zinc-700' : 'bg-zinc-200'}`} />
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setAddMenuOpen(false);
              setAddMenuPos(null);
              setShowCreateDialog(true);
            }}
            className={`w-full text-left px-3 py-1.5 text-[11px] flex items-center gap-2 transition-colors ${
              darkMode ? 'text-zinc-300 hover:bg-zinc-800' : 'text-zinc-700 hover:bg-zinc-50'
            }`}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Create New Nugget
          </button>
        </div>,
        document.body,
      )}

      {/* Nugget creation dialog */}
      {showCreateDialog && (
        <NuggetCreationDialog
          onSave={(name, files) => {
            setShowCreateDialog(false);
            onCreateNugget(name, files);
          }}
          onCancel={() => setShowCreateDialog(false)}
          darkMode={darkMode}
        />
      )}

      {/* Confirm delete dialog */}
      {confirmDeleteId && (() => {
        const nug = projectNuggets.find((n) => n.id === confirmDeleteId);
        if (!nug) return null;
        return (
          <div className="fixed inset-0 z-[120] flex items-center justify-center" onClick={() => setConfirmDeleteId(null)}>
            <div className="absolute inset-0 bg-black/50" />
            <div
              onClick={(e) => e.stopPropagation()}
              className={`relative z-10 w-80 rounded-xl shadow-2xl border p-5 ${
                darkMode ? 'bg-zinc-900 border-zinc-700' : 'bg-white border-zinc-200'
              }`}
            >
              <h3 className={`text-[14px] font-semibold mb-2 ${darkMode ? 'text-zinc-100' : 'text-zinc-900'}`}>
                Delete nugget?
              </h3>
              <p className={`text-[12px] mb-4 ${darkMode ? 'text-zinc-400' : 'text-zinc-500'}`}>
                <span className="font-medium">{nug.name}</span> and all its documents and cards will be permanently deleted.
              </p>
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => setConfirmDeleteId(null)}
                  className={`px-3 py-1.5 rounded-md text-[11px] font-medium transition-colors ${
                    darkMode
                      ? 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
                      : 'text-zinc-500 hover:text-zinc-700 hover:bg-zinc-100'
                  }`}
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    onDeleteNugget(confirmDeleteId);
                    setConfirmDeleteId(null);
                  }}
                  className="px-3 py-1.5 rounded-md bg-red-500 text-white text-[11px] font-semibold hover:bg-red-600 transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </>
  );
};

export default NuggetTabBar;
