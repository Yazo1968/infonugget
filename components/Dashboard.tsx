import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Nugget, Project } from '../types';
import { useAuth } from '../context/AuthContext';
import LogoIcon from './LogoIcon';
import UserAvatar from './UserAvatar';
import EditProfileModal from './EditProfileModal';
import './Dashboard.css';

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

  const rv = (delay: number) => `db-rv ${visible ? 'db-vis' : ''} db-rv-d${delay}`;

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
    <div className={`dashboard h-screen w-full flex flex-col overflow-hidden ${darkMode ? '' : 'db-light'}`}>
      {/* ── Navigation ── */}
      <nav className={`db-nav ${rv(0)}`}>
        <div className="db-logo">
          <LogoIcon size={28} darkMode={darkMode} />
          <span>
            <span className="db-logo-italic">info</span>
            <span className="db-logo-bold">nugget</span>
          </span>
        </div>
        <div className="flex items-center gap-3">
          <button
            className="db-nav-btn"
            onClick={toggleDarkMode}
            title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {darkMode ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
              <UserAvatar size={30} profile={profile} email={user?.email} />
            </button>
            {userMenuOpen && (
              <div className="db-user-dropdown">
                <div className="db-user-email">{user?.email}</div>
                <button
                  onClick={() => { setUserMenuOpen(false); setShowEditProfile(true); }}
                  className="db-dropdown-item"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                  Edit Profile
                </button>
                <button
                  onClick={() => { setUserMenuOpen(false); signOut(); }}
                  className="db-dropdown-item"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
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
      </nav>

      {/* ── Main content ── */}
      <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
        <div className="db-main">

          {/* Hero section */}
          <div className={`db-hero ${rv(1)}`}>
            <h1>
              {profile?.displayName
                ? <>Welcome back, <em>{profile.displayName.split(' ')[0]}</em></>
                : <><em>info</em>nugget</>
              }
            </h1>
            <p>
              {profile?.displayName
                ? 'Your content studio is ready. Open a project or create something new.'
                : 'Condense knowledge into digestible insights.'}
            </p>
          </div>

          {/* Section header */}
          <div className={`flex items-center justify-between mb-5 ${rv(3)}`}>
            <span className="db-section-tag">
              Your Projects
            </span>
            {hasProjects && (
              <span className="db-section-count">{projects.length} project{projects.length !== 1 ? 's' : ''}</span>
            )}
          </div>

          {/* Empty state for new users */}
          {!hasProjects && (
            <div className={`text-center py-10 mb-4 ${rv(3)}`}>
              <div className="db-empty-icon">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--db-accent)', opacity: 0.7 }}>
                  <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
                  <line x1="12" y1="10" x2="12" y2="16" /><line x1="9" y1="13" x2="15" y2="13" />
                </svg>
              </div>
              <div className="db-empty-title">Create your first project</div>
              <p className="db-empty-desc">
                Projects organize your sources, nuggets, and generated infographic cards.
              </p>
            </div>
          )}

          {/* Project grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {/* ── Create New Project card (always first) ── */}
            {creating ? (
              <div className={`db-card db-card-creating ${rv(3)}`}>
                <div className="flex items-center gap-3 mb-3">
                  <div className="db-card-icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--db-accent)' }}>
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
                    className="db-create-input"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={handleCreate} disabled={!newName.trim()} className="db-btn-primary">
                    Create
                  </button>
                  <button onClick={() => { setCreating(false); setNewName(''); }} className="db-btn-ghost">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div
                onClick={() => setCreating(true)}
                className={`db-card-create ${!hasProjects ? 'sm:col-span-2 lg:col-span-3' : ''} ${rv(3)}`}
              >
                <div className="db-card-create-icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--db-accent)' }}>
                    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                </div>
                <span className="db-card-create-label">Create New Project</span>
              </div>
            )}

            {sortedProjects.map((project, idx) => {
              const stats = getProjectStats(project);
              const isRenaming = renamingId === project.id;
              const delayClass = Math.min(idx + 4, 8);
              return (
                <div
                  key={project.id}
                  onClick={() => { if (!isRenaming && menuOpenId !== project.id) onOpenProject(project.id); }}
                  className={`db-card ${rv(delayClass)}`}
                  style={menuOpenId === project.id ? { zIndex: 50 } : undefined}
                >
                  {/* Top row: icon + title + kebab */}
                  <div className="flex items-start gap-3 mb-3" style={{ position: 'relative', zIndex: 1 }}>
                    <div className="db-card-icon">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--db-accent)' }}>
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
                          className="db-rename-input"
                        />
                      ) : (
                        <div className="db-card-title truncate">{project.name}</div>
                      )}
                    </div>
                    {/* Kebab button */}
                    <div className="relative" ref={menuOpenId === project.id ? menuRef : undefined}>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenuOpenId((prev) => (prev === project.id ? null : project.id));
                        }}
                        className={`db-card-kebab ${menuOpenId === project.id ? 'db-kebab-open' : ''}`}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                          <circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" />
                        </svg>
                      </button>
                      {/* Dropdown menu */}
                      {menuOpenId === project.id && (
                        <div className="db-dropdown">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setMenuOpenId(null);
                              setRenameValue(project.name);
                              setRenamingId(project.id);
                            }}
                            className="db-dropdown-item"
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
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
                            className="db-dropdown-item db-danger"
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                              <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                            </svg>
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Stats row */}
                  <div className="db-card-stats">
                    <span className="db-card-stat">{stats.nuggetCount} nugget{stats.nuggetCount !== 1 ? 's' : ''}</span>
                    <span className="db-card-divider" />
                    <span className="db-card-stat">{stats.docCount} doc{stats.docCount !== 1 ? 's' : ''}</span>
                    {stats.cardCount > 0 && (
                      <>
                        <span className="db-card-divider" />
                        <span className="db-card-stat">{stats.cardCount} card{stats.cardCount !== 1 ? 's' : ''}</span>
                      </>
                    )}
                    <span className="db-card-time">{formatTimeAgo(project.lastModifiedAt)}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* How it works strip */}
          <div className={`db-how ${rv(6)}`}>
            {[
              { step: '1', label: 'Add Sources' },
              { step: '2', label: 'Set the Brief' },
              { step: '3', label: 'AI Synthesis' },
              { step: '4', label: 'Visual Cards' },
            ].map((item, i) => (
              <React.Fragment key={item.step}>
                {i > 0 && (
                  <span className="db-how-arrow">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </span>
                )}
                <div className="db-how-step">
                  <span className="db-how-num">{item.step}</span>
                  <span className="db-how-label">{item.label}</span>
                </div>
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>

      {/* Version footer */}
      <div className={`db-footer ${rv(7)}`}>v6.1</div>

      {/* Confirm delete dialog */}
      {confirmDeleteId && (() => {
        const proj = projects.find((p) => p.id === confirmDeleteId);
        if (!proj) return null;
        return (
          <div className="db-dialog-overlay" onClick={() => setConfirmDeleteId(null)}>
            <div className="db-dialog-backdrop" />
            <div className="db-dialog" onClick={(e) => e.stopPropagation()}>
              <h3>Delete project?</h3>
              <p>
                <strong style={{ color: 'var(--db-fg)' }}>{proj.name}</strong> and all its nuggets, documents, and cards will be permanently deleted.
              </p>
              <div className="flex items-center justify-end gap-2">
                <button onClick={() => setConfirmDeleteId(null)} className="db-btn-cancel">
                  Cancel
                </button>
                <button
                  onClick={() => {
                    onDeleteProject(confirmDeleteId);
                    setConfirmDeleteId(null);
                  }}
                  className="db-btn-danger"
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
