import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Nugget, Project } from '../types';
import { useAuth } from '../context/AuthContext';
import LogoIcon from './LogoIcon';
import UserAvatar from './UserAvatar';
import EditProfileModal from './EditProfileModal';

/** Relative time formatter — no dependency needed */
function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

interface DashboardProps {
  projects: Project[];
  nuggets: Nugget[];
  onOpenProject: (projectId: string) => void;
  onCreateProject: (name: string) => void;
  onRenameProject: (id: string, newName: string) => void;
  onDeleteProject: (id: string) => void;
  darkMode: boolean;
  toggleDarkMode: () => void;
}

export const Dashboard: React.FC<DashboardProps> = ({
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

  // User menu state
  const { user, profile, signOut } = useAuth();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const [showEditProfile, setShowEditProfile] = useState(false);

  // Close kebab menu on outside click
  useEffect(() => {
    if (!menuOpenId && !userMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuOpenId && menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpenId(null);
      }
      if (userMenuOpen && userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpenId, userMenuOpen]);

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
  const sortedProjects = [...projects].sort((a, b) => b.lastModifiedAt - a.lastModifiedAt);

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
      <div style={stagger(0)} className="relative z-20 shrink-0 flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2.5">
          <LogoIcon size={32} darkMode={darkMode} />
          <span className={`text-xl tracking-tight ${darkMode ? 'text-zinc-100' : 'text-zinc-900'}`}>
            <span className="font-light italic">info</span>
            <span className="font-semibold not-italic">nugget</span>
          </span>
        </div>
        <div className="flex items-center gap-2">
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

          {/* User menu */}
          <div className="relative" ref={userMenuRef}>
            <button
              onClick={() => setUserMenuOpen((prev) => !prev)}
              title={user?.email ?? 'Account'}
              className="rounded-full transition-opacity hover:opacity-80"
            >
              <UserAvatar size={28} profile={profile} email={user?.email} />
            </button>
            {userMenuOpen && (
              <div className={`absolute right-0 top-full mt-1.5 w-52 rounded-lg shadow-lg border py-1 z-20 ${
                darkMode
                  ? 'bg-zinc-900 border-zinc-700'
                  : 'bg-white border-zinc-200'
              }`}>
                <div className={`px-3 py-2 text-[11px] truncate border-b ${
                  darkMode
                    ? 'text-zinc-400 border-zinc-700'
                    : 'text-zinc-500 border-zinc-100'
                }`}>
                  {user?.email}
                </div>
                <button
                  onClick={() => { setUserMenuOpen(false); setShowEditProfile(true); }}
                  className={`w-full text-left px-3 py-2 text-[11px] flex items-center gap-2 transition-colors ${
                    darkMode
                      ? 'text-zinc-300 hover:bg-zinc-800'
                      : 'text-zinc-700 hover:bg-zinc-50'
                  }`}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                  Edit Profile
                </button>
                <button
                  onClick={() => { setUserMenuOpen(false); signOut(); }}
                  className={`w-full text-left px-3 py-2 text-[11px] flex items-center gap-2 transition-colors ${
                    darkMode
                      ? 'text-zinc-300 hover:bg-zinc-800'
                      : 'text-zinc-700 hover:bg-zinc-50'
                  }`}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <polyline points="16 17 21 12 16 7" />
                    <line x1="21" y1="12" x2="9" y2="12" />
                  </svg>
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Main content ── */}
      <div className="relative z-10 flex-1 overflow-y-auto px-6 pb-8" style={{ scrollbarWidth: 'thin' }}>
        <div className="max-w-3xl mx-auto">

          {/* Hero section */}
          <div style={stagger(100)} className={`text-center ${hasProjects ? 'mt-4 mb-6' : 'mt-8 mb-8'}`}>
            <h1 className={`text-3xl tracking-tight mb-2 ${darkMode ? 'text-zinc-100' : 'text-zinc-900'}`}>
              <span className="font-light italic">info</span>
              <span className="font-semibold not-italic">nugget</span>
            </h1>
            <p className={`text-[13px] font-light ${darkMode ? 'text-zinc-500' : 'text-zinc-500'}`}>
              {profile?.displayName
                ? `Welcome back, ${profile.displayName.split(' ')[0]}.`
                : 'Condense knowledge into digestible insights.'}
            </p>
          </div>

          {/* Section header */}
          <div style={stagger(200)} className="flex items-center justify-between mb-4">
            <h2 className={`text-[13px] font-semibold uppercase tracking-wider ${darkMode ? 'text-zinc-400' : 'text-zinc-500'}`}>
              Your Projects {hasProjects && <span className="font-normal">({projects.length})</span>}
            </h2>
          </div>

          {/* Empty state for new users */}
          {!hasProjects && (
            <div style={stagger(250)} className="text-center py-10 mb-4">
              <div className={`mx-auto w-16 h-16 rounded-2xl flex items-center justify-center mb-4 ${
                darkMode ? 'bg-accent-blue/10' : 'bg-accent-blue/8'
              }`}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-accent-blue">
                  <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
                  <line x1="12" y1="10" x2="12" y2="16" /><line x1="9" y1="13" x2="15" y2="13" />
                </svg>
              </div>
              <h3 className={`text-[15px] font-semibold mb-1.5 ${darkMode ? 'text-zinc-100' : 'text-zinc-900'}`}>
                Create your first project
              </h3>
              <p className={`text-[12px] max-w-xs mx-auto ${darkMode ? 'text-zinc-500' : 'text-zinc-500'}`}>
                Projects organize your sources, nuggets, and generated infographic cards.
              </p>
            </div>
          )}

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
                  !hasProjects ? 'sm:col-span-2 lg:col-span-3' : ''
                } ${
                  darkMode
                    ? 'border-zinc-700 hover:border-accent-blue/50 hover:bg-zinc-900/50'
                    : 'border-zinc-200 hover:border-accent-blue/50 hover:bg-accent-blue/3'
                }`}
              >
                <div className="w-10 h-10 rounded-full flex items-center justify-center mb-2 bg-accent-blue/10">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent-blue">
                    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                </div>
                <span className={`text-[11px] font-semibold ${darkMode ? 'text-zinc-400' : 'text-zinc-500'}`}>
                  Create New Project
                </span>
              </div>
            )}
              {sortedProjects.map((project, idx) => {
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
                      <span className={`text-[10px] ml-auto ${darkMode ? 'text-zinc-600' : 'text-zinc-400'}`}>
                        {formatTimeAgo(project.lastModifiedAt)}
                      </span>
                    </div>

                  </div>
                );
              })}
          </div>

          {/* How it works strip */}
          <div style={stagger(hasProjects ? 300 + sortedProjects.length * 80 + 100 : 500)} className="flex items-center justify-center gap-3 mt-8">
            {[
              { step: '1', label: 'Add sources', sub: 'MD / PDF' },
              { step: '2', label: 'AI synthesizes', sub: 'insights' },
              { step: '3', label: 'Get infographic', sub: 'cards' },
            ].map((item, i) => (
              <React.Fragment key={item.step}>
                {i > 0 && (
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={darkMode ? 'text-zinc-700' : 'text-zinc-300'}>
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                )}
                <div className="flex items-center gap-2">
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold border ${
                    darkMode ? 'border-zinc-700 text-zinc-500' : 'border-zinc-300 text-zinc-400'
                  }`}>
                    {item.step}
                  </span>
                  <span className={`text-[9px] font-bold uppercase tracking-widest ${darkMode ? 'text-zinc-600' : 'text-zinc-400'}`}>
                    {item.label} <span className="font-normal normal-case tracking-normal">{item.sub}</span>
                  </span>
                </div>
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>

      {/* Version */}
      <div style={stagger(hasProjects ? 300 + sortedProjects.length * 80 + 200 : 600)} className="relative z-10 shrink-0 py-3 text-center">
        <p className={`text-[10px] font-light tracking-wide ${darkMode ? 'text-zinc-600' : 'text-zinc-400'}`}>v6.1</p>
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

      {/* Edit Profile modal */}
      {showEditProfile && (
        <EditProfileModal darkMode={darkMode} onClose={() => setShowEditProfile(false)} />
      )}
    </div>
  );
};
