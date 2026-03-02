import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Nugget, Project } from '../types';

interface LandingPageProps {
  projects: Project[];
  nuggets: Nugget[];
  onOpenProject: (projectId: string) => void;
  onCreateProject: (name: string) => void;
  onRenameProject: (id: string, newName: string) => void;
  onDeleteProject: (id: string) => void;
  darkMode: boolean;
  toggleDarkMode: () => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({
  projects,
  nuggets,
  onOpenProject,
  onCreateProject,
  onRenameProject,
  onDeleteProject,
  darkMode,
  toggleDarkMode,
}) => {
  const [visible, setVisible] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Kebab menu state
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close kebab menu on outside click
  useEffect(() => {
    if (!menuOpenId) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpenId(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpenId]);

  // Focus rename input when entering rename mode
  useEffect(() => {
    if (renamingId) renameInputRef.current?.focus();
  }, [renamingId]);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 100);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (creating) inputRef.current?.focus();
  }, [creating]);

  const transition = 'all 0.8s cubic-bezier(0.16, 1, 0.3, 1)';

  const stagger = (delay: number): React.CSSProperties => ({
    opacity: visible ? 1 : 0,
    transform: visible ? 'translateY(0) scale(1)' : 'translateY(12px) scale(0.98)',
    transition,
    transitionDelay: `${delay}ms`,
  });

  const handleCreate = useCallback(() => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    onCreateProject(trimmed);
    setNewName('');
    setCreating(false);
  }, [newName, onCreateProject]);

  /** Compute stats for a project */
  const getProjectStats = useCallback(
    (project: Project) => {
      const projectNuggets = project.nuggetIds
        .map((id) => nuggets.find((n) => n.id === id))
        .filter((n): n is Nugget => !!n);
      const docCount = projectNuggets.reduce((sum, n) => sum + n.documents.length, 0);
      const cardCount = projectNuggets.reduce((sum, n) => sum + (n.cards?.length ?? 0), 0);
      return { nuggetCount: projectNuggets.length, docCount, cardCount };
    },
    [nuggets],
  );

  const hasProjects = projects.length > 0;

  return (
    <div
      className="relative h-screen w-full flex flex-col overflow-hidden"
      style={{ backgroundColor: darkMode ? '#0a0a0a' : '#fafbfc' }}
    >
      {/* Dot grid (dark mode only) */}
      {darkMode && (
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.04]"
          style={{
            backgroundImage: 'radial-gradient(rgba(42,159,212,0.5) 0.5px, transparent 0.5px)',
            backgroundSize: '32px 32px',
          }}
        />
      )}
      {/* Center spotlight (dark mode only) */}
      {darkMode && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'radial-gradient(ellipse at center, rgba(42,159,212,0.03) 0%, transparent 60%)',
          }}
        />
      )}

      {/* ── Compact header ── */}
      <div style={stagger(0)} className="relative z-10 shrink-0 flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-accent-blue rounded-full flex items-center justify-center shadow-lg">
            <div className="w-[10px] h-[10px] bg-white rounded-[2px] rotate-45" />
          </div>
          <span className={`text-xl tracking-tight ${darkMode ? 'text-zinc-100' : 'text-zinc-900'}`}>
            <span className="font-light italic">info</span>
            <span className="font-semibold not-italic">nugget</span>
          </span>
        </div>
        <button
          onClick={toggleDarkMode}
          className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors ${
            darkMode
              ? 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
              : 'text-zinc-400 hover:text-zinc-600 hover:bg-zinc-200'
          }`}
          title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {darkMode ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="5" />
              <line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" />
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
              <line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          )}
        </button>
      </div>

      {/* ── Main content ── */}
      <div className="relative z-10 flex-1 overflow-y-auto px-6 pb-8" style={{ scrollbarWidth: 'thin' }}>
        <div className="max-w-3xl mx-auto">

          {/* Hero section */}
          <div style={stagger(100)} className="text-center mt-8 mb-10">
            <h1 className={`text-3xl tracking-tight mb-2 ${darkMode ? 'text-zinc-100' : 'text-zinc-900'}`}>
              <span className="font-light italic">info</span>
              <span className="font-semibold not-italic">nugget</span>
            </h1>
            <p className={`text-[13px] font-light ${darkMode ? 'text-zinc-500' : 'text-zinc-500'}`}>
              Condense knowledge into digestible insights.
            </p>
          </div>

          {/* Section header */}
          <div style={stagger(200)} className="flex items-center justify-between mb-4">
            <h2 className={`text-[13px] font-semibold uppercase tracking-wider ${darkMode ? 'text-zinc-400' : 'text-zinc-500'}`}>
              Your Projects {hasProjects && <span className="font-normal">({projects.length})</span>}
            </h2>
          </div>

          {/* Project grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {/* ── Create New Project card (always first) ── */}
            {creating ? (
              <div
                style={stagger(250)}
                className={`p-4 rounded-xl border-2 border-dashed ${
                  darkMode ? 'border-zinc-600 bg-zinc-900/50' : 'border-zinc-300 bg-zinc-50'
                }`}
              >
                <div className="flex items-center gap-2.5 mb-3">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                    darkMode ? 'bg-zinc-800' : 'bg-zinc-100'
                  }`}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-accent-blue">
                      <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
                    </svg>
                  </div>
                  <input
                    ref={inputRef}
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleCreate();
                      if (e.key === 'Escape') { setCreating(false); setNewName(''); }
                    }}
                    placeholder="Project name..."
                    className={`flex-1 min-w-0 text-[13px] font-semibold bg-transparent outline-none border-b ${
                      darkMode ? 'text-zinc-100 placeholder-zinc-600 border-zinc-600' : 'text-zinc-900 placeholder-zinc-400 border-zinc-300'
                    }`}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCreate}
                    disabled={!newName.trim()}
                    className="px-3 py-1 rounded-md bg-accent-blue text-white text-[10px] font-semibold uppercase tracking-wider disabled:opacity-40 hover:brightness-110 transition-all"
                  >
                    Create
                  </button>
                  <button
                    onClick={() => { setCreating(false); setNewName(''); }}
                    className={`px-2 py-1 rounded-md text-[10px] font-semibold uppercase tracking-wider transition-colors ${
                      darkMode ? 'text-zinc-500 hover:text-zinc-300' : 'text-zinc-400 hover:text-zinc-600'
                    }`}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div
                style={stagger(250)}
                onClick={() => setCreating(true)}
                className={`flex flex-col items-center justify-center p-4 rounded-xl border-2 border-dashed cursor-pointer transition-all duration-200 ${
                  darkMode
                    ? 'border-zinc-700 hover:border-zinc-500 hover:bg-zinc-900/50'
                    : 'border-zinc-200 hover:border-zinc-400 hover:bg-zinc-50'
                }`}
              >
                <div className={`w-10 h-10 rounded-full flex items-center justify-center mb-2 ${
                  darkMode ? 'bg-zinc-800' : 'bg-zinc-100'
                }`}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent-blue">
                    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                </div>
                <span className={`text-[11px] font-semibold ${darkMode ? 'text-zinc-400' : 'text-zinc-500'}`}>
                  Create New Project
                </span>
              </div>
            )}
              {projects.map((project, idx) => {
                const stats = getProjectStats(project);
                const isRenaming = renamingId === project.id;
                return (
                  <div
                    key={project.id}
                    style={stagger(300 + idx * 80)}
                    onClick={() => { if (!isRenaming && menuOpenId !== project.id) onOpenProject(project.id); }}
                    className={`relative text-left p-4 rounded-xl border transition-all duration-200 group cursor-pointer ${
                      darkMode
                        ? 'bg-zinc-900/80 border-zinc-800 hover:border-zinc-600 hover:bg-zinc-800/80'
                        : 'bg-white border-zinc-200 hover:border-zinc-300 hover:shadow-md'
                    }`}
                  >
                    {/* Project icon + name + kebab */}
                    <div className="flex items-start gap-2.5 mb-3">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                        darkMode ? 'bg-zinc-800 group-hover:bg-zinc-700' : 'bg-zinc-100 group-hover:bg-zinc-200'
                      } transition-colors`}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-accent-blue">
                          <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
                        </svg>
                      </div>
                      <div className="min-w-0 flex-1">
                        {isRenaming ? (
                          <input
                            ref={renameInputRef}
                            type="text"
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => {
                              e.stopPropagation();
                              if (e.key === 'Enter') {
                                const trimmed = renameValue.trim();
                                if (trimmed && trimmed !== project.name) onRenameProject(project.id, trimmed);
                                setRenamingId(null);
                              }
                              if (e.key === 'Escape') setRenamingId(null);
                            }}
                            onBlur={() => {
                              const trimmed = renameValue.trim();
                              if (trimmed && trimmed !== project.name) onRenameProject(project.id, trimmed);
                              setRenamingId(null);
                            }}
                            className={`w-full text-[13px] font-semibold bg-transparent outline-none border-b ${
                              darkMode ? 'text-zinc-100 border-zinc-600' : 'text-zinc-900 border-zinc-300'
                            }`}
                          />
                        ) : (
                          <h3 className={`text-[13px] font-semibold truncate ${darkMode ? 'text-zinc-100' : 'text-zinc-900'}`}>
                            {project.name}
                          </h3>
                        )}
                      </div>
                      {/* Kebab button */}
                      <div className="relative" ref={menuOpenId === project.id ? menuRef : undefined}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setMenuOpenId((prev) => (prev === project.id ? null : project.id));
                          }}
                          className={`shrink-0 w-6 h-6 rounded-md flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all ${
                            menuOpenId === project.id ? 'opacity-100' : ''
                          } ${
                            darkMode
                              ? 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700'
                              : 'text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100'
                          }`}
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                            <circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" />
                          </svg>
                        </button>
                        {/* Dropdown menu */}
                        {menuOpenId === project.id && (
                          <div className={`absolute right-0 top-full mt-1 w-36 rounded-lg shadow-lg border py-1 z-20 ${
                            darkMode
                              ? 'bg-zinc-900 border-zinc-700'
                              : 'bg-white border-zinc-200'
                          }`}>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setMenuOpenId(null);
                                setRenameValue(project.name);
                                setRenamingId(project.id);
                              }}
                              className={`w-full text-left px-3 py-1.5 text-[11px] flex items-center gap-2 transition-colors ${
                                darkMode
                                  ? 'text-zinc-300 hover:bg-zinc-800'
                                  : 'text-zinc-700 hover:bg-zinc-50'
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
                                setMenuOpenId(null);
                                setConfirmDeleteId(project.id);
                              }}
                              className={`w-full text-left px-3 py-1.5 text-[11px] flex items-center gap-2 transition-colors ${
                                darkMode
                                  ? 'text-red-400 hover:bg-zinc-800'
                                  : 'text-red-500 hover:bg-red-50'
                              }`}
                            >
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                                <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                              </svg>
                              Delete
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Stats row */}
                    <div className="flex items-center gap-3">
                      <span className={`text-[10px] font-medium ${darkMode ? 'text-zinc-500' : 'text-zinc-400'}`}>
                        {stats.nuggetCount} nugget{stats.nuggetCount !== 1 ? 's' : ''}
                      </span>
                      <span className={`text-[10px] ${darkMode ? 'text-zinc-700' : 'text-zinc-300'}`}>·</span>
                      <span className={`text-[10px] font-medium ${darkMode ? 'text-zinc-500' : 'text-zinc-400'}`}>
                        {stats.docCount} doc{stats.docCount !== 1 ? 's' : ''}
                      </span>
                      {stats.cardCount > 0 && (
                        <>
                          <span className={`text-[10px] ${darkMode ? 'text-zinc-700' : 'text-zinc-300'}`}>·</span>
                          <span className={`text-[10px] font-medium ${darkMode ? 'text-zinc-500' : 'text-zinc-400'}`}>
                            {stats.cardCount} card{stats.cardCount !== 1 ? 's' : ''}
                          </span>
                        </>
                      )}
                    </div>

                  </div>
                );
              })}
          </div>

          {/* Feature pills */}
          <div style={stagger(hasProjects ? 300 + projects.length * 80 + 100 : 500)} className="flex items-center justify-center gap-8 mt-12">
            <div className={`flex items-center gap-2 ${darkMode ? 'text-zinc-600' : 'text-zinc-400'}`}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              <span className="text-[9px] font-bold uppercase tracking-widest">MD / PDF</span>
            </div>
            <div className={`flex items-center gap-2 ${darkMode ? 'text-zinc-600' : 'text-zinc-400'}`}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3l1.912 5.813a2 2 0 0 0 1.275 1.275L21 12l-5.813 1.912a2 2 0 0 0-1.275 1.275L12 21l-1.912-5.813a2 2 0 0 0-1.275-1.275L3 12l5.813-1.912a2 2 0 0 0 1.275-1.275L12 3Z" />
              </svg>
              <span className="text-[9px] font-bold uppercase tracking-widest">AI Synthesis</span>
            </div>
            <div className={`flex items-center gap-2 ${darkMode ? 'text-zinc-600' : 'text-zinc-400'}`}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="16" height="16" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
              <span className="text-[9px] font-bold uppercase tracking-widest">Infographic Cards</span>
            </div>
          </div>
        </div>
      </div>

      {/* Version */}
      <div style={stagger(hasProjects ? 300 + projects.length * 80 + 200 : 600)} className="relative z-10 shrink-0 py-3 text-center">
        <p className={`text-[10px] font-light tracking-wide ${darkMode ? 'text-zinc-600' : 'text-zinc-400'}`}>v6.0</p>
      </div>

      {/* Confirm delete dialog */}
      {confirmDeleteId && (() => {
        const proj = projects.find((p) => p.id === confirmDeleteId);
        if (!proj) return null;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => setConfirmDeleteId(null)}>
            <div className="absolute inset-0 bg-black/50" />
            <div
              onClick={(e) => e.stopPropagation()}
              className={`relative z-10 w-80 rounded-xl shadow-2xl border p-5 ${
                darkMode ? 'bg-zinc-900 border-zinc-700' : 'bg-white border-zinc-200'
              }`}
            >
              <h3 className={`text-[14px] font-semibold mb-2 ${darkMode ? 'text-zinc-100' : 'text-zinc-900'}`}>
                Delete project?
              </h3>
              <p className={`text-[12px] mb-4 ${darkMode ? 'text-zinc-400' : 'text-zinc-500'}`}>
                <span className="font-medium">{proj.name}</span> and all its nuggets, documents, and cards will be permanently deleted.
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
                    onDeleteProject(confirmDeleteId);
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
    </div>
  );
};
