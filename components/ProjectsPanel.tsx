import React, { useRef, useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Nugget, Project } from '../types';
import { isNameTaken, getUniqueName } from '../utils/naming';
import { useNuggetContext } from '../context/NuggetContext';
import { useProjectContext } from '../context/ProjectContext';
import { useSelectionContext } from '../context/SelectionContext';
import ProjectsList from './projects-panel/ProjectsList';
import NuggetsList from './projects-panel/NuggetsList';
import DocumentsList from './projects-panel/DocumentsList';
import ProjectKebabMenu from './projects-panel/ProjectKebabMenu';
import NuggetKebabMenu from './projects-panel/NuggetKebabMenu';
import DocumentKebabMenu from './projects-panel/DocumentKebabMenu';
import ConfirmDeleteDialog from './projects-panel/ConfirmDeleteDialog';

type ActiveTab = 'projects' | 'nuggets' | 'documents';

interface ProjectsPanelProps {
  isOpen: boolean;
  onToggle: () => void;
  onSelectProject: (projectId: string) => void;
  onSelectNugget: (id: string) => void;
  onInlineCreateProject: (name: string) => void;
  onInlineCreateNugget: (name: string, projectId: string) => void;
  onRenameProject: (id: string, newName: string) => void;
  onRenameNugget: (id: string, newName: string) => void;
  onCopyNuggetToProject: (nuggetId: string, targetProjectId: string) => void;
  onMoveNuggetToProject: (nuggetId: string, sourceProjectId: string, targetProjectId: string) => void;
  onCreateProjectForNugget: (
    nuggetId: string,
    projectName: string,
    mode: 'copy' | 'move',
    sourceProjectId: string,
  ) => void;
  onDuplicateProject: (id: string) => void;
  onRenameDocument?: (docId: string, newName: string) => void;
  onRemoveDocument?: (docId: string) => void;
  onCopyMoveDocument?: (docId: string, targetNuggetId: string, mode: 'copy' | 'move') => void;
  onCreateNuggetWithDoc?: (nuggetName: string, docId: string) => void;
  onUploadDocuments?: (files: FileList) => void;
  onEditSubject?: (nuggetId: string) => void;
  onOpenSourcesPanel?: () => void;
  otherNuggets?: { id: string; name: string }[];
  projectNuggets?: { projectId: string; projectName: string; nuggets: { id: string; name: string }[] }[];
  /** When set, forces activeTab to this value on next open. Cleared after consumption. */
  requestedTab?: ActiveTab | null;
  onClearRequestedTab?: () => void;
}

const ProjectsPanel: React.FC<ProjectsPanelProps> = ({
  isOpen,
  onToggle,
  onSelectProject,
  onSelectNugget,
  onInlineCreateProject,
  onInlineCreateNugget,
  onRenameProject,
  onRenameNugget,
  onCopyNuggetToProject,
  onMoveNuggetToProject,
  onCreateProjectForNugget,
  onDuplicateProject,
  onRenameDocument,
  onRemoveDocument,
  onCopyMoveDocument,
  onCreateNuggetWithDoc,
  onUploadDocuments,
  onEditSubject,
  onOpenSourcesPanel,
  otherNuggets,
  projectNuggets,
  requestedTab,
  onClearRequestedTab,
}) => {
  const { nuggets, selectedNuggetId, deleteNugget } = useNuggetContext();
  const { projects, deleteProject } = useProjectContext();
  const { selectedProjectId, selectEntity } = useSelectionContext();

  // ── Tree expansion state ──
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [expandedNuggets, setExpandedNuggets] = useState<Set<string>>(new Set());
  type TreeSelection = { type: 'root' } | { type: 'project'; id: string } | { type: 'nugget'; id: string } | { type: 'document'; id: string };
  const [treeSelection, setTreeSelectionRaw] = useState<TreeSelection>({ type: 'root' });

  // ── Navigation history (back/forward) ──
  const navHistoryRef = useRef<TreeSelection[]>([{ type: 'root' }]);
  const navCursorRef = useRef(0);
  const isNavJumpRef = useRef(false);

  const setTreeSelection = useCallback((sel: TreeSelection) => {
    if (!isNavJumpRef.current) {
      // Trim forward history and push new entry
      navHistoryRef.current = navHistoryRef.current.slice(0, navCursorRef.current + 1);
      navHistoryRef.current.push(sel);
      navCursorRef.current = navHistoryRef.current.length - 1;
    }
    isNavJumpRef.current = false;
    setTreeSelectionRaw(sel);
    setToolbarPicker(null);
  }, []);

  const canGoBack = navCursorRef.current > 0;
  const canGoForward = navCursorRef.current < navHistoryRef.current.length - 1;

  const goBack = useCallback(() => {
    if (navCursorRef.current <= 0) return;
    navCursorRef.current--;
    isNavJumpRef.current = true;
    setTreeSelection(navHistoryRef.current[navCursorRef.current]);
  }, [setTreeSelection]);

  const goForward = useCallback(() => {
    if (navCursorRef.current >= navHistoryRef.current.length - 1) return;
    navCursorRef.current++;
    isNavJumpRef.current = true;
    setTreeSelection(navHistoryRef.current[navCursorRef.current]);
  }, [setTreeSelection]);

  // Consume requestedTab when modal opens
  useEffect(() => {
    if (isOpen && requestedTab) {
      if (requestedTab === 'nuggets' && selectedProjectId) {
        setExpandedProjects((prev) => new Set(prev).add(selectedProjectId));
        setTreeSelection({ type: 'project', id: selectedProjectId });
      } else if (requestedTab === 'documents' && selectedNuggetId) {
        // Expand the parent project too
        const parentProj = projects.find((p) => p.nuggetIds.includes(selectedNuggetId));
        if (parentProj) setExpandedProjects((prev) => new Set(prev).add(parentProj.id));
        setExpandedNuggets((prev) => new Set(prev).add(selectedNuggetId));
        setTreeSelection({ type: 'nugget', id: selectedNuggetId });
      }
      onClearRequestedTab?.();
    }
  }, [isOpen, requestedTab, onClearRequestedTab, selectedProjectId, selectedNuggetId, projects]);

  // Derive which view the right pane shows
  const rightPaneView = (treeSelection.type === 'nugget' || treeSelection.type === 'document') ? 'documents' as const
    : treeSelection.type === 'project' ? 'nuggets' as const
    : 'projects' as const;

  // ── Rename state (shared for project/nugget/document) ──
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renamingType, setRenamingType] = useState<'project' | 'nugget' | 'document'>('project');
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState('');

  // ── Inline creation state ──
  const [isCreatingInline, setIsCreatingInline] = useState(false);
  const [inlineCreateName, setInlineCreateName] = useState('');
  const [inlineCreateError, setInlineCreateError] = useState('');

  // ── Kebab menu state ──
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [menuType, setMenuType] = useState<'project' | 'nugget' | 'document'>('project');

  // ── Confirm delete state ──
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmDeleteType, setConfirmDeleteType] = useState<'project' | 'nugget' | 'document'>('project');

  // ── No-projects / No-nuggets modals ──
  const [noProjectsNuggetId, setNoProjectsNuggetId] = useState<string | null>(null);
  const [newProjectName, setNewProjectName] = useState('');
  const [noNuggetsModalDocId, setNoNuggetsModalDocId] = useState<string | null>(null);
  const [newNuggetName, setNewNuggetName] = useState('');

  // ── Toolbar copy/move picker ──
  const [toolbarPicker, setToolbarPicker] = useState<'copy' | 'move' | null>(null);
  const [toolbarPickerPos, setToolbarPickerPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Upload file input ref
  const uploadInputRef = useRef<HTMLInputElement>(null);

  // ── Derived data ──
  const nuggetMap = new Map(nuggets.map((n) => [n.id, n]));

  // Tree-derived: find parent nugget when a document is selected
  const treeDocParent = treeSelection.type === 'document'
    ? (() => { for (const n of nuggets) { if (n.documents?.some((d) => d.id === treeSelection.id)) return n; } return null; })()
    : null;

  // Tree-derived project/nugget for right pane (independent of global selection)
  const treeProject = treeSelection.type === 'project' ? projects.find((p) => p.id === treeSelection.id) ?? null
    : treeSelection.type === 'nugget' ? projects.find((p) => p.nuggetIds.includes(treeSelection.id)) ?? null
    : treeSelection.type === 'document' && treeDocParent ? projects.find((p) => p.nuggetIds.includes(treeDocParent.id)) ?? null
    : null;
  const treeNugget = treeSelection.type === 'nugget' ? nuggets.find((n) => n.id === treeSelection.id) ?? null
    : treeDocParent;
  const treeDoc = treeSelection.type === 'document' ? treeNugget?.documents?.find((d) => d.id === treeSelection.id) ?? null : null;

  const projectNuggetsList = treeProject
    ? treeProject.nuggetIds.map((id) => nuggetMap.get(id)).filter((n): n is Nugget => !!n)
    : [];

  const nuggetDocuments = treeNugget?.documents ?? [];

  // Derived: toolbar picker targets for selected nugget
  const treeSelNugget = treeSelection.type === 'nugget' ? nuggets.find((n) => n.id === treeSelection.id) ?? null : null;
  const treeSelNuggetSourceProject = treeSelNugget ? projects.find((p) => p.nuggetIds.includes(treeSelNugget.id)) ?? null : null;
  const treeSelNuggetOtherProjects = treeSelNugget ? projects.filter((p) => !p.nuggetIds.includes(treeSelNugget.id)) : [];

  // Helper: find a document and its parent nugget
  const findDocAcrossNuggets = useCallback((docId: string) => {
    for (const n of nuggets) {
      const doc = n.documents?.find((d) => d.id === docId);
      if (doc) return { doc, nugget: n };
    }
    return null;
  }, [nuggets]);

  // ── Rename commit ──
  const commitRename = useCallback(() => {
    if (!renamingId || !renameValue.trim()) {
      setRenamingId(null);
      setRenameValue('');
      setRenameError('');
      return;
    }
    const trimmed = renameValue.trim();

    if (renamingType === 'project') {
      const project = projects.find((p) => p.id === renamingId);
      if (project && trimmed !== project.name) {
        if (isNameTaken(trimmed, projects.map((p) => p.name), project.name)) {
          setRenameError('A project with this name already exists');
          return;
        }
        onRenameProject(renamingId, trimmed);
      }
    } else if (renamingType === 'nugget') {
      const nugget = nuggets.find((n) => n.id === renamingId);
      if (nugget && trimmed !== nugget.name) {
        const parentProject = projects.find((p) => p.nuggetIds.includes(renamingId));
        const siblingNames = parentProject
          ? parentProject.nuggetIds.map((nid) => nuggets.find((n) => n.id === nid)?.name || '').filter(Boolean)
          : nuggets.map((n) => n.name);
        if (isNameTaken(trimmed, siblingNames, nugget.name)) {
          setRenameError('A nugget with this name already exists');
          return;
        }
        onRenameNugget(renamingId, trimmed);
      }
    } else if (renamingType === 'document') {
      const found = findDocAcrossNuggets(renamingId);
      if (found) {
        const currentDoc = found.doc;
        if (currentDoc && trimmed !== currentDoc.name) {
          const siblingNames = found.nugget.documents.map((d) => d.name);
          if (isNameTaken(trimmed, siblingNames, currentDoc.name)) {
            setRenameError('A document with this name already exists');
            return;
          }
        }
      }
      onRenameDocument?.(renamingId, trimmed);
    }

    setRenamingId(null);
    setRenameValue('');
    setRenameError('');
  }, [renamingId, renamingType, renameValue, projects, nuggets, onRenameProject, onRenameNugget, onRenameDocument, findDocAcrossNuggets]);

  // ── Inline creation handlers ──
  const handleStartCreate = useCallback(() => {
    if (rightPaneView === 'projects') {
      const existingNames = projects.map((p) => p.name);
      setInlineCreateName(getUniqueName('New Project', existingNames));
    } else if (rightPaneView === 'nuggets' && treeProject) {
      const existingNames = treeProject.nuggetIds
        .map((id) => nuggetMap.get(id)?.name || '')
        .filter(Boolean);
      setInlineCreateName(getUniqueName('New Nugget', existingNames));
    }
    setInlineCreateError('');
    setIsCreatingInline(true);
  }, [rightPaneView, projects, treeProject, nuggetMap]);

  const handleInlineCreateChange = useCallback((name: string) => {
    setInlineCreateName(name);
    if (!name.trim()) {
      setInlineCreateError('');
      return;
    }
    if (rightPaneView === 'projects') {
      if (isNameTaken(name.trim(), projects.map((p) => p.name))) {
        setInlineCreateError('A project with this name already exists');
      } else {
        setInlineCreateError('');
      }
    } else if (rightPaneView === 'nuggets' && treeProject) {
      const siblingNames = treeProject.nuggetIds
        .map((id) => nuggetMap.get(id)?.name || '')
        .filter(Boolean);
      if (isNameTaken(name.trim(), siblingNames)) {
        setInlineCreateError('A nugget with this name already exists');
      } else {
        setInlineCreateError('');
      }
    }
  }, [rightPaneView, projects, treeProject, nuggetMap]);

  const handleInlineCreateCommit = useCallback(() => {
    if (!inlineCreateName.trim() || inlineCreateError) {
      setIsCreatingInline(false);
      setInlineCreateName('');
      setInlineCreateError('');
      return;
    }
    const trimmed = inlineCreateName.trim();
    if (rightPaneView === 'projects') {
      onInlineCreateProject(trimmed);
    } else if (rightPaneView === 'nuggets' && treeProject) {
      onInlineCreateNugget(trimmed, treeProject.id);
    }
    setIsCreatingInline(false);
    setInlineCreateName('');
    setInlineCreateError('');
  }, [rightPaneView, inlineCreateName, inlineCreateError, treeProject, onInlineCreateProject, onInlineCreateNugget]);

  const handleInlineCreateCancel = useCallback(() => {
    setIsCreatingInline(false);
    setInlineCreateName('');
    setInlineCreateError('');
  }, []);

  // ── Context menu handler ──
  const handleContextMenu = useCallback((id: string, pos: { x: number; y: number }, type: 'project' | 'nugget' | 'document') => {
    setMenuPos(pos);
    setMenuType(type);
    setMenuOpenId(id);
  }, []);

  // ── Download handler ──
  const handleDownloadDocument = useCallback((docId: string) => {
    const found = findDocAcrossNuggets(docId);
    if (!found) return;
    const doc = found.doc;
    if (doc.content) {
      const blob = new Blob([doc.content], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement('a'), {
        href: url,
        download: `${doc.name.replace(/\.[^.]+$/, '')}.md`,
      });
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  }, [findDocAcrossNuggets]);

  // ── Double-click handlers — select + close modal + go work ──
  const handleProjectDoubleClick = useCallback((projectId: string) => {
    const proj = projects.find((p) => p.id === projectId);
    if (!proj) return;
    const firstNuggetId = proj.nuggetIds[0];
    const firstNugget = firstNuggetId ? nuggets.find((n) => n.id === firstNuggetId) : undefined;
    const firstDocId = firstNugget?.documents?.[0]?.id;
    selectEntity({
      projectId,
      nuggetId: firstNuggetId,
      documentId: firstDocId,
    });
    if (firstDocId) onOpenSourcesPanel?.();
    onToggle();
  }, [projects, nuggets, selectEntity, onOpenSourcesPanel, onToggle]);

  const handleNuggetDoubleClick = useCallback((nuggetId: string) => {
    const nug = nuggets.find((n) => n.id === nuggetId);
    const firstDocId = nug?.documents?.[0]?.id;
    selectEntity({
      nuggetId,
      documentId: firstDocId,
    });
    if (firstDocId) onOpenSourcesPanel?.();
    onToggle();
  }, [nuggets, selectEntity, onOpenSourcesPanel, onToggle]);

  const handleDocumentDoubleClick = useCallback((docId: string) => {
    selectEntity({ documentId: docId });
    onOpenSourcesPanel?.();
    onToggle();
  }, [selectEntity, onOpenSourcesPanel, onToggle]);


  // ── Kebab menu context data ──
  const menuNugget = menuOpenId && menuType === 'nugget' ? nuggets.find((n) => n.id === menuOpenId) : null;
  const menuSourceProject = menuNugget ? projects.find((p) => p.nuggetIds.includes(menuNugget.id)) ?? null : null;
  const menuOtherProjects = menuNugget ? projects.filter((p) => !p.nuggetIds.includes(menuNugget.id)) : [];
  const menuDoc = menuOpenId && menuType === 'document' ? findDocAcrossNuggets(menuOpenId)?.doc : null;

  return (
    <>
      {/* Hidden file input for document upload */}
      <input
        ref={uploadInputRef}
        type="file"
        accept=".md,.pdf"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) {
            onUploadDocuments?.(e.target.files);
            e.target.value = '';
          }
        }}
      />

      {/* Modal window */}
      {isOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-[120] flex items-center justify-center"
            onClick={(e) => { if (e.target === e.currentTarget) onToggle(); }}
          >
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/30" />

            {/* Modal content */}
            <div
              className="relative z-10 flex flex-col bg-white dark:bg-zinc-900 rounded-lg shadow-2xl border border-zinc-200 dark:border-zinc-700 overflow-hidden"
              style={{ width: 740, height: 'min(520px, calc(100vh - 120px))' }}
            >
              {/* Header — breadcrumb address bar */}
              <div className="shrink-0 border-b border-zinc-100 dark:border-zinc-600 px-3 py-2 flex items-center gap-0 min-h-[36px]">
                {/* Back / Forward buttons */}
                <button
                  onClick={goBack}
                  disabled={!canGoBack}
                  className={`shrink-0 w-5 h-5 rounded flex items-center justify-center transition-colors mr-0.5 ${
                    canGoBack ? 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800' : 'text-zinc-300 dark:text-zinc-700 cursor-default'
                  }`}
                  title="Back"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                </button>
                <button
                  onClick={goForward}
                  disabled={!canGoForward}
                  className={`shrink-0 w-5 h-5 rounded flex items-center justify-center transition-colors mr-1.5 ${
                    canGoForward ? 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800' : 'text-zinc-300 dark:text-zinc-700 cursor-default'
                  }`}
                  title="Forward"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>

                {/* Home crumb — always present */}
                <button
                  onClick={() => setTreeSelection({ type: 'root' })}
                  className={`text-[11px] font-semibold px-1 py-0.5 rounded transition-colors inline-flex items-center gap-1 shrink-0 ${
                    treeSelection.type === 'root'
                      ? 'text-zinc-700 dark:text-zinc-200'
                      : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                  }`}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                    <polyline points="9 22 9 12 15 12 15 22" />
                  </svg>
                  Home
                </button>

                {/* Project crumb */}
                {treeProject && treeSelection.type !== 'root' && (
                  <>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-300 dark:text-zinc-600 shrink-0 mx-0.5">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                    <button
                      onClick={() => { setTreeSelection({ type: 'project', id: treeProject.id }); }}
                      className={`text-[11px] font-semibold px-1 py-0.5 rounded transition-colors truncate max-w-[120px] ${
                        treeSelection.type === 'project'
                          ? 'text-zinc-700 dark:text-zinc-200'
                          : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                      }`}
                      title={treeProject.name}
                    >
                      {treeProject.name}
                    </button>
                  </>
                )}

                {/* Nugget crumb */}
                {treeNugget && (treeSelection.type === 'nugget' || treeSelection.type === 'document') && (
                  <>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-300 dark:text-zinc-600 shrink-0 mx-0.5">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                    <button
                      onClick={() => { setTreeSelection({ type: 'nugget', id: treeNugget.id }); }}
                      className={`text-[11px] font-semibold px-1 py-0.5 rounded transition-colors truncate max-w-[120px] ${
                        treeSelection.type === 'nugget'
                          ? 'text-zinc-700 dark:text-zinc-200'
                          : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                      }`}
                      title={treeNugget.name}
                    >
                      {treeNugget.name}
                    </button>
                  </>
                )}

                {/* Document crumb */}
                {treeDoc && treeSelection.type === 'document' && (
                  <>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-300 dark:text-zinc-600 shrink-0 mx-0.5">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                    <span
                      className="text-[11px] font-semibold text-zinc-700 dark:text-zinc-200 px-1 py-0.5 truncate max-w-[120px]"
                      title={treeDoc.name}
                    >
                      {treeDoc.name}
                    </span>
                  </>
                )}

                <span className="flex-1" />
                <button
                  onClick={onToggle}
                  className="w-5 h-5 rounded flex items-center justify-center text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors shrink-0"
                  title="Close"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>

              {/* Toolbar */}
              {(() => {
                const sel = treeSelection;
                // For selected item actions
                const selProject = sel.type === 'project' ? projects.find((p) => p.id === sel.id) : null;
                const selNugget = sel.type === 'nugget' ? nuggets.find((n) => n.id === sel.id) : null;
                const selDoc = sel.type === 'document' ? treeDoc : null;
                const hasAnyItem = !!selProject || !!selNugget || !!selDoc;
                // For copy/move: find source project and other projects for the selected nugget
                const nuggetSourceProject = selNugget ? projects.find((p) => p.nuggetIds.includes(selNugget.id)) ?? null : null;
                const nuggetOtherProjects = selNugget ? projects.filter((p) => !p.nuggetIds.includes(selNugget.id)) : [];

                const btnClass = (enabled: boolean) =>
                  `shrink-0 flex items-center gap-1 px-1.5 py-1 rounded text-[10px] transition-colors ${
                    enabled
                      ? 'text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40 hover:text-blue-700 dark:hover:text-blue-300 cursor-pointer'
                      : 'text-zinc-300 dark:text-zinc-700 cursor-default'
                  }`;
                const sep = <div className="w-px h-4 bg-zinc-200 dark:bg-zinc-700 mx-0.5 shrink-0" />;

                return (
                  <div className="shrink-0 border-b border-zinc-100 dark:border-zinc-700 px-2 py-1 flex items-center gap-0 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
                    {/* ── Create group ── */}
                    <button className={btnClass(sel.type === 'root')} onClick={() => { if (sel.type === 'root') handleStartCreate(); }} title={sel.type === 'root' ? 'New Project' : 'Navigate to Home first'}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                      Project
                    </button>
                    <button className={btnClass(sel.type === 'project')} onClick={() => { if (sel.type === 'project') handleStartCreate(); }} title={sel.type === 'project' ? 'New Nugget' : 'Select a project first'}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                      Nugget
                    </button>
                    <button className={btnClass(sel.type === 'nugget')} onClick={() => { if (sel.type === 'nugget') uploadInputRef.current?.click(); }} title={sel.type === 'nugget' ? 'Upload document' : 'Select a nugget first'}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
                      Upload
                    </button>

                    {sep}

                    {/* ── Edit group ── */}
                    <button
                      className={btnClass(hasAnyItem)}
                      onClick={() => {
                        if (selProject) { setRenamingId(selProject.id); setRenamingType('project'); setRenameValue(selProject.name); }
                        else if (selNugget) { setRenamingId(selNugget.id); setRenamingType('nugget'); setRenameValue(selNugget.name); }
                        else if (selDoc) { setRenamingId(selDoc.id); setRenamingType('document'); setRenameValue(selDoc.name); }
                      }}
                      title={hasAnyItem ? 'Rename' : 'Select an item first'}
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                      Rename
                    </button>
                    <button
                      className={btnClass(!!selNugget)}
                      onClick={() => { if (selNugget) onEditSubject?.(selNugget.id); }}
                      title={selNugget ? 'Edit subject' : 'Select a nugget first'}
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>
                      Subject
                    </button>
                    <button
                      className={btnClass(!!selDoc)}
                      onClick={() => { if (selDoc) { selectEntity({ documentId: selDoc.id }); onOpenSourcesPanel?.(); } }}
                      title={selDoc ? 'Open in Sources' : 'Select a document first'}
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" /></svg>
                      Open
                    </button>
                    <button
                      className={btnClass(!!selDoc)}
                      onClick={() => { if (selDoc) handleDownloadDocument(selDoc.id); }}
                      title={selDoc ? 'Download document' : 'Select a document first'}
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                      Download
                    </button>

                    {sep}

                    {/* ── Organize group ── */}
                    {(() => {
                      const canCopyMoveNugget = !!selNugget && nuggetOtherProjects.length > 0;
                      const canCopyMoveDoc = !!selDoc && !!(projectNuggets?.some((p) => p.nuggets.length > 0) || (otherNuggets && otherNuggets.length > 0));
                      const canCopyMove = canCopyMoveNugget || canCopyMoveDoc;
                      return (
                        <>
                          <button
                            className={btnClass(canCopyMove)}
                            onClick={(e) => {
                              if (!canCopyMove) return;
                              const rect = e.currentTarget.getBoundingClientRect();
                              setToolbarPickerPos({ x: rect.left, y: rect.bottom + 4 });
                              setToolbarPicker(toolbarPicker === 'copy' ? null : 'copy');
                            }}
                            title={canCopyMove ? (selDoc ? 'Copy document to another nugget' : 'Copy nugget to another project') : 'Select a nugget or document first'}
                          >
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                            Copy
                          </button>
                          <button
                            className={btnClass(canCopyMove)}
                            onClick={(e) => {
                              if (!canCopyMove) return;
                              const rect = e.currentTarget.getBoundingClientRect();
                              setToolbarPickerPos({ x: rect.left, y: rect.bottom + 4 });
                              setToolbarPicker(toolbarPicker === 'move' ? null : 'move');
                            }}
                            title={canCopyMove ? (selDoc ? 'Move document to another nugget' : 'Move nugget to another project') : 'Select a nugget or document first'}
                          >
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
                            Move
                          </button>
                        </>
                      );
                    })()}
                    <button
                      className={btnClass(!!selProject || !!selNugget)}
                      onClick={() => {
                        if (selNugget) {
                          // Duplicate nugget = copy to same project
                          const sourceProj = projects.find((p) => p.nuggetIds.includes(selNugget.id));
                          if (sourceProj) onCopyNuggetToProject(selNugget.id, sourceProj.id);
                        } else if (selProject) {
                          onDuplicateProject(selProject.id);
                        }
                      }}
                      title={selNugget ? 'Duplicate nugget' : selProject ? 'Duplicate project' : 'Select a project or nugget first'}
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                      Duplicate
                    </button>

                    {sep}

                    {/* ── Destroy group ── */}
                    <button
                      className={btnClass(hasAnyItem)}
                      onClick={() => {
                        if (selProject) { setConfirmDeleteId(selProject.id); setConfirmDeleteType('project'); }
                        else if (selNugget) { setConfirmDeleteId(selNugget.id); setConfirmDeleteType('nugget'); }
                        else if (selDoc) { setConfirmDeleteId(selDoc.id); setConfirmDeleteType('document'); }
                      }}
                      title={hasAnyItem ? 'Delete' : 'Select an item first'}
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                      Delete
                    </button>
                  </div>
                );
              })()}

              {/* Two-pane body */}
              <div className="flex-1 flex min-h-0">
                {/* ── Left pane: navigation tree ── */}
                <div className="w-[200px] shrink-0 border-r border-zinc-100 dark:border-zinc-700 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
                  <div className="py-1">
                    {/* Home root node */}
                    <div
                      className={`flex items-center gap-1 px-1.5 py-1 cursor-pointer select-none transition-colors ${
                        treeSelection.type === 'root' ? 'bg-zinc-200 dark:bg-zinc-700' : 'hover:bg-zinc-50 dark:hover:bg-zinc-800'
                      }`}
                      onClick={() => setTreeSelection({ type: 'root' })}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-zinc-400">
                        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                        <polyline points="9 22 9 12 15 12 15 22" />
                      </svg>
                      <span className="text-[11px] font-medium text-zinc-700 dark:text-zinc-300">Home</span>
                    </div>

                    {projects.map((proj) => {
                      const isExpanded = expandedProjects.has(proj.id);
                      const isSelected = treeSelection.type === 'project' && treeSelection.id === proj.id;
                      const projNuggets = proj.nuggetIds.map((id) => nuggetMap.get(id)).filter((n): n is Nugget => !!n);
                      return (
                        <div key={proj.id}>
                          {/* Project row */}
                          <div
                            className={`flex items-center gap-0.5 pl-4 pr-1.5 py-1 cursor-pointer select-none transition-colors group ${
                              isSelected ? 'bg-zinc-200 dark:bg-zinc-700' : 'hover:bg-zinc-50 dark:hover:bg-zinc-800'
                            }`}
                            onClick={() => {
                              setTreeSelection({ type: 'project', id: proj.id });
                              if (!isExpanded) setExpandedProjects((prev) => new Set(prev).add(proj.id));
                            }}
                            onDoubleClick={() => handleProjectDoubleClick(proj.id)}
                            onContextMenu={(e) => { e.preventDefault(); handleContextMenu(proj.id, { x: e.clientX, y: e.clientY }, 'project'); }}
                          >
                            {/* Chevron */}
                            <button
                              className="shrink-0 w-4 h-4 flex items-center justify-center text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                              onClick={(e) => {
                                e.stopPropagation();
                                setExpandedProjects((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(proj.id)) next.delete(proj.id); else next.add(proj.id);
                                  return next;
                                });
                              }}
                            >
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${isExpanded ? '' : '-rotate-90'}`}>
                                <polyline points="6 9 12 15 18 9" />
                              </svg>
                            </button>
                            {/* Folder icon */}
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-zinc-400">
                              <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
                            </svg>
                            <span className="text-[11px] truncate flex-1 min-w-0 text-zinc-700 dark:text-zinc-300">{proj.name}</span>
                            {/* Kebab */}
                            <button
                              className="shrink-0 w-4 h-4 flex items-center justify-center text-zinc-300 dark:text-zinc-600 opacity-0 group-hover:opacity-100 hover:text-zinc-500 dark:hover:text-zinc-400 transition-opacity"
                              onClick={(e) => { e.stopPropagation(); handleContextMenu(proj.id, { x: e.clientX, y: e.clientY }, 'project'); }}
                            >
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" /></svg>
                            </button>
                          </div>

                          {/* Expanded nuggets */}
                          {isExpanded && projNuggets.map((nug) => {
                            const nugExpanded = expandedNuggets.has(nug.id);
                            const nugSelected = treeSelection.type === 'nugget' && treeSelection.id === nug.id;
                            return (
                              <div key={nug.id}>
                                {/* Nugget row */}
                                <div
                                  className={`flex items-center gap-0.5 pl-8 pr-1.5 py-1 cursor-pointer select-none transition-colors group ${
                                    nugSelected ? 'bg-zinc-200 dark:bg-zinc-700' : 'hover:bg-zinc-50 dark:hover:bg-zinc-800'
                                  }`}
                                  onClick={() => {
                                    setTreeSelection({ type: 'nugget', id: nug.id });
                                    if (!nugExpanded) setExpandedNuggets((prev) => new Set(prev).add(nug.id));
                                  }}
                                  onDoubleClick={() => handleNuggetDoubleClick(nug.id)}
                                  onContextMenu={(e) => { e.preventDefault(); handleContextMenu(nug.id, { x: e.clientX, y: e.clientY }, 'nugget'); }}
                                >
                                  {/* Chevron */}
                                  <button
                                    className="shrink-0 w-4 h-4 flex items-center justify-center text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setExpandedNuggets((prev) => {
                                        const next = new Set(prev);
                                        if (next.has(nug.id)) next.delete(nug.id); else next.add(nug.id);
                                        return next;
                                      });
                                    }}
                                  >
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${nugExpanded ? '' : '-rotate-90'}`}>
                                      <polyline points="6 9 12 15 18 9" />
                                    </svg>
                                  </button>
                                  {/* Diamond icon */}
                                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-zinc-400">
                                    <rect x="6" y="6" width="12" height="12" rx="2" transform="rotate(45 12 12)" />
                                  </svg>
                                  <span className="text-[11px] truncate flex-1 min-w-0 text-zinc-700 dark:text-zinc-300">{nug.name}</span>
                                  {/* Kebab */}
                                  <button
                                    className="shrink-0 w-4 h-4 flex items-center justify-center text-zinc-300 dark:text-zinc-600 opacity-0 group-hover:opacity-100 hover:text-zinc-500 dark:hover:text-zinc-400 transition-opacity"
                                    onClick={(e) => { e.stopPropagation(); handleContextMenu(nug.id, { x: e.clientX, y: e.clientY }, 'nugget'); }}
                                  >
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" /></svg>
                                  </button>
                                </div>

                                {/* Expanded documents */}
                                {nugExpanded && (nug.documents ?? []).map((doc) => (
                                  <div
                                    key={doc.id}
                                    className={`flex items-center gap-0.5 pl-12 pr-1.5 py-1 cursor-pointer select-none transition-colors group ${
                                      treeSelection.type === 'document' && treeSelection.id === doc.id ? 'bg-zinc-200 dark:bg-zinc-700' : 'hover:bg-zinc-50 dark:hover:bg-zinc-800'
                                    }`}
                                    onClick={() => {
                                      setTreeSelection({ type: 'document', id: doc.id });
                                    }}
                                    onDoubleClick={() => handleDocumentDoubleClick(doc.id)}
                                    onContextMenu={(e) => { e.preventDefault(); handleContextMenu(doc.id, { x: e.clientX, y: e.clientY }, 'document'); }}
                                  >
                                    {/* Doc icon */}
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-zinc-400">
                                      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
                                      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
                                    </svg>
                                    <span className="text-[10px] truncate flex-1 min-w-0 text-zinc-500 dark:text-zinc-400">{doc.name}</span>
                                    {/* Kebab */}
                                    <button
                                      className="shrink-0 w-4 h-4 flex items-center justify-center text-zinc-300 dark:text-zinc-600 opacity-0 group-hover:opacity-100 hover:text-zinc-500 dark:hover:text-zinc-400 transition-opacity"
                                      onClick={(e) => { e.stopPropagation(); handleContextMenu(doc.id, { x: e.clientX, y: e.clientY }, 'document'); }}
                                    >
                                      <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" /></svg>
                                    </button>
                                  </div>
                                ))}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* ── Right pane: content list ── */}
                <div className="flex-1 overflow-hidden flex flex-col min-w-0">
                  {/* Right pane header */}
                  <div className="shrink-0 px-3 py-1.5 border-b border-zinc-100 dark:border-zinc-700 flex items-center gap-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                      {rightPaneView === 'projects' ? 'Projects' : rightPaneView === 'nuggets' ? 'Nuggets' : 'Documents'}
                    </span>
                    <span className="text-[9px] text-zinc-400 dark:text-zinc-500 font-light">
                      {rightPaneView === 'projects' && projects.length}
                      {rightPaneView === 'nuggets' && projectNuggetsList.length}
                      {rightPaneView === 'documents' && nuggetDocuments.length}
                    </span>
                  </div>

                  {rightPaneView === 'projects' && (
                    <ProjectsList
                      projects={projects}
                      selectedProjectId={null}
                      renamingId={renamingType === 'project' ? renamingId : null}
                      renameValue={renameValue}
                      renameError={renamingType === 'project' ? renameError : ''}
                      onSelect={(id) => { setTreeSelection({ type: 'project', id }); setExpandedProjects((prev) => new Set(prev).add(id)); }}
                      onDoubleClick={handleProjectDoubleClick}
                      onContextMenu={(id, pos) => handleContextMenu(id, pos, 'project')}
                      onRenameChange={(v) => { setRenameValue(v); setRenameError(''); }}
                      onRenameCommit={commitRename}
                      onRenameCancel={() => { setRenamingId(null); setRenameValue(''); setRenameError(''); }}
                      isCreatingInline={isCreatingInline}
                      inlineCreateName={inlineCreateName}
                      inlineCreateError={inlineCreateError}
                      onInlineCreateChange={handleInlineCreateChange}
                      onInlineCreateCommit={handleInlineCreateCommit}
                      onInlineCreateCancel={handleInlineCreateCancel}
                      onStartCreate={handleStartCreate}
                    />
                  )}

                  {rightPaneView === 'nuggets' && (
                    <NuggetsList
                      nuggets={projectNuggetsList}
                      selectedNuggetId={null}
                      renamingId={renamingType === 'nugget' ? renamingId : null}
                      renameValue={renameValue}
                      renameError={renamingType === 'nugget' ? renameError : ''}
                      onSelect={(id) => { setTreeSelection({ type: 'nugget', id }); }}
                      onDoubleClick={handleNuggetDoubleClick}
                      onContextMenu={(id, pos) => handleContextMenu(id, pos, 'nugget')}
                      onRenameChange={(v) => { setRenameValue(v); setRenameError(''); }}
                      onRenameCommit={commitRename}
                      onRenameCancel={() => { setRenamingId(null); setRenameValue(''); setRenameError(''); }}
                      isCreatingInline={isCreatingInline}
                      inlineCreateName={inlineCreateName}
                      inlineCreateError={inlineCreateError}
                      onInlineCreateChange={handleInlineCreateChange}
                      onInlineCreateCommit={handleInlineCreateCommit}
                      onInlineCreateCancel={handleInlineCreateCancel}
                      onStartCreate={handleStartCreate}
                    />
                  )}

                  {rightPaneView === 'documents' && (
                    <DocumentsList
                      documents={nuggetDocuments}
                      selectedDocumentId={treeSelection.type === 'document' ? treeSelection.id : null}
                      renamingId={renamingType === 'document' ? renamingId : null}
                      renameValue={renameValue}
                      renameError={renamingType === 'document' ? renameError : ''}
                      onSelect={(docId) => { setTreeSelection({ type: 'document', id: docId }); }}
                      onDoubleClick={handleDocumentDoubleClick}
                      onContextMenu={(id, pos) => handleContextMenu(id, pos, 'document')}
                      onRenameChange={(v) => { setRenameValue(v); setRenameError(''); }}
                      onRenameCommit={commitRename}
                      onRenameCancel={() => { setRenamingId(null); setRenameValue(''); setRenameError(''); }}
                      onUpload={() => uploadInputRef.current?.click()}
                      onDropFiles={(files) => onUploadDocuments?.(files)}
                      qualityReport={treeNugget?.qualityReport}
                    />
                  )}
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* ── Toolbar copy/move picker (portaled) ── */}
      {toolbarPicker && (() => {
        // Nugget-level: show projects as targets
        if (treeSelNugget && treeSelNuggetOtherProjects.length > 0) {
          return createPortal(
            <>
              <div className="fixed inset-0 z-[128]" onClick={() => setToolbarPicker(null)} />
              <div
                className="fixed z-[130] w-52 bg-white dark:bg-zinc-900 rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-600 py-1"
                style={{ left: toolbarPickerPos.x, top: toolbarPickerPos.y }}
              >
                <div className="px-3 py-1.5 text-[10px] uppercase font-semibold tracking-wider text-zinc-400 dark:text-zinc-500">
                  {toolbarPicker === 'copy' ? 'Copy' : 'Move'} to project
                </div>
                <div className="max-h-[200px] overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
                  {treeSelNuggetOtherProjects.map((p) => (
                    <button
                      key={p.id}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors"
                      onClick={() => {
                        if (toolbarPicker === 'copy') {
                          onCopyNuggetToProject(treeSelNugget.id, p.id);
                        } else if (treeSelNuggetSourceProject) {
                          onMoveNuggetToProject(treeSelNugget.id, treeSelNuggetSourceProject.id, p.id);
                        }
                        setToolbarPicker(null);
                      }}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-400 dark:text-zinc-500 shrink-0"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
                      <span className="truncate">{p.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            </>,
            document.body,
          );
        }
        // Document-level: show nuggets grouped by project as targets
        if (treeSelection.type === 'document' && treeDoc && projectNuggets && projectNuggets.length > 0) {
          return createPortal(
            <>
              <div className="fixed inset-0 z-[128]" onClick={() => setToolbarPicker(null)} />
              <div
                className="fixed z-[130] w-56 bg-white dark:bg-zinc-900 rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-600 py-1"
                style={{ left: toolbarPickerPos.x, top: toolbarPickerPos.y }}
              >
                <div className="px-3 py-1.5 text-[10px] uppercase font-semibold tracking-wider text-zinc-400 dark:text-zinc-500">
                  {toolbarPicker === 'copy' ? 'Copy' : 'Move'} to nugget
                </div>
                <div className="max-h-[240px] overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
                  {projectNuggets.map((proj) => (
                    <div key={proj.projectId}>
                      <div className="flex items-center gap-1.5 px-3 py-1">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-400 dark:text-zinc-500 shrink-0"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
                        <span className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 truncate">{proj.projectName}</span>
                      </div>
                      {proj.nuggets.map((nug) => (
                        <button
                          key={nug.id}
                          className="w-full flex items-center gap-1.5 pl-7 pr-3 py-1 text-[11px] text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors"
                          onClick={() => {
                            onCopyMoveDocument?.(treeDoc.id, nug.id, toolbarPicker!);
                            setToolbarPicker(null);
                          }}
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 dark:bg-zinc-500 shrink-0" />
                          <span className="truncate">{nug.name}</span>
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </>,
            document.body,
          );
        }
        return null;
      })()}

      {/* ── Project kebab menu ── */}
      {menuOpenId && menuType === 'project' && (() => {
        const project = projects.find((p) => p.id === menuOpenId);
        if (!project) return null;
        return (
          <ProjectKebabMenu
            menuPos={menuPos}
            onClose={() => setMenuOpenId(null)}
            onRename={() => {
              setMenuOpenId(null);
              setRenamingId(project.id);
              setRenamingType('project');
              setRenameValue(project.name);
            }}
            onDuplicate={() => {
              setMenuOpenId(null);
              onDuplicateProject(project.id);
            }}
            onDelete={() => {
              setMenuOpenId(null);
              setConfirmDeleteId(project.id);
              setConfirmDeleteType('project');
            }}
          />
        );
      })()}

      {/* ── Nugget kebab menu ── */}
      {menuOpenId && menuType === 'nugget' && menuNugget && (
        <NuggetKebabMenu
          menuPos={menuPos}
          sourceProject={menuSourceProject}
          otherProjects={menuOtherProjects}
          onClose={() => setMenuOpenId(null)}
          onRename={() => {
            setMenuOpenId(null);
            setRenamingId(menuNugget.id);
            setRenamingType('nugget');
            setRenameValue(menuNugget.name);
          }}
          onCopyToProject={(targetProjectId) => {
            setMenuOpenId(null);
            onCopyNuggetToProject(menuNugget.id, targetProjectId);
          }}
          onMoveToProject={(sourceProjectId, targetProjectId) => {
            setMenuOpenId(null);
            onMoveNuggetToProject(menuNugget.id, sourceProjectId, targetProjectId);
          }}
          onEditSubject={() => {
            setMenuOpenId(null);
            onEditSubject?.(menuNugget.id);
          }}
          onDelete={() => {
            setMenuOpenId(null);
            setConfirmDeleteId(menuNugget.id);
            setConfirmDeleteType('nugget');
          }}
          onNoProjects={() => {
            setMenuOpenId(null);
            setNoProjectsNuggetId(menuNugget.id);
          }}
        />
      )}

      {/* ── Document kebab menu ── */}
      {menuOpenId && menuType === 'document' && menuDoc && (
        <DocumentKebabMenu
          doc={menuDoc}
          menuPos={menuPos}
          otherNuggets={otherNuggets}
          projectNuggets={projectNuggets}
          onClose={() => setMenuOpenId(null)}
          onOpen={() => {
            setMenuOpenId(null);
            selectEntity({ documentId: menuDoc.id });
            onOpenSourcesPanel?.();
          }}
          onRename={() => {
            setMenuOpenId(null);
            setRenamingId(menuDoc.id);
            setRenamingType('document');
            setRenameValue(menuDoc.name);
          }}
          onCopyMove={(targetNuggetId, mode) => {
            setMenuOpenId(null);
            onCopyMoveDocument?.(menuDoc.id, targetNuggetId, mode);
          }}
          onDownload={() => {
            setMenuOpenId(null);
            handleDownloadDocument(menuDoc.id);
          }}
          onDelete={() => {
            setMenuOpenId(null);
            setConfirmDeleteId(menuDoc.id);
            setConfirmDeleteType('document');
          }}
          onNoNuggets={() => {
            setMenuOpenId(null);
            setNoNuggetsModalDocId(menuDoc.id);
          }}
        />
      )}

      {/* ── Confirm delete dialog ── */}
      {confirmDeleteId && (() => {
        if (confirmDeleteType === 'project') {
          const project = projects.find((p) => p.id === confirmDeleteId);
          if (!project) return null;
          return (
            <ConfirmDeleteDialog
              itemType="project"
              itemName={project.name}
              cascadeCount={project.nuggetIds.length}
              onConfirm={() => { setConfirmDeleteId(null); deleteProject(confirmDeleteId); }}
              onCancel={() => setConfirmDeleteId(null)}
            />
          );
        } else if (confirmDeleteType === 'nugget') {
          const nugget = nuggets.find((n) => n.id === confirmDeleteId);
          if (!nugget) return null;
          return (
            <ConfirmDeleteDialog
              itemType="nugget"
              itemName={nugget.name}
              onConfirm={() => { setConfirmDeleteId(null); deleteNugget(confirmDeleteId); }}
              onCancel={() => setConfirmDeleteId(null)}
            />
          );
        } else {
          const found = findDocAcrossNuggets(confirmDeleteId);
          if (!found) return null;
          return (
            <ConfirmDeleteDialog
              itemType="document"
              itemName={found.doc.name}
              onConfirm={() => { setConfirmDeleteId(null); onRemoveDocument?.(confirmDeleteId); }}
              onCancel={() => setConfirmDeleteId(null)}
            />
          );
        }
      })()}

      {/* ── No other projects — create-project modal ── */}
      {noProjectsNuggetId &&
        (() => {
          const sourceProject = projects.find((p) => p.nuggetIds.includes(noProjectsNuggetId));
          return createPortal(
            <div
              className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 dark:bg-black/60"
              onClick={() => { setNoProjectsNuggetId(null); setNewProjectName(''); }}
            >
              <div
                className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl dark:shadow-black/30 mx-4 overflow-hidden"
                style={{ minWidth: 300, maxWidth: 'calc(100vw - 32px)', width: 'fit-content' }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="px-6 pt-6 pb-3 text-center">
                  <div className="w-9 h-9 rounded-full bg-zinc-100 dark:bg-zinc-800/50 flex items-center justify-center mx-auto mb-3">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="text-zinc-500 dark:text-zinc-400" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                      <polyline points="10 17 15 12 10 7" />
                      <line x1="15" y1="12" x2="3" y2="12" />
                    </svg>
                  </div>
                  <h3 className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 tracking-tight mb-1">No Other Projects</h3>
                  <p className="text-[12px] text-zinc-500 dark:text-zinc-400 mt-1">Create a new project to move or copy this nugget to.</p>
                  <input
                    type="text"
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newProjectName.trim() && sourceProject && !isNameTaken(newProjectName.trim(), projects.map((p) => p.name))) {
                        const nid = noProjectsNuggetId;
                        setNoProjectsNuggetId(null);
                        setNewProjectName('');
                        onCreateProjectForNugget(nid, newProjectName.trim(), 'move', sourceProject.id);
                      }
                    }}
                    placeholder="Project name"
                    autoFocus
                    className={`mt-3 w-full px-3 py-2 text-xs border rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-300 transition-all text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-500 ${
                      isNameTaken(newProjectName.trim(), projects.map((p) => p.name))
                        ? 'border-red-300 focus:border-red-400'
                        : 'border-zinc-200 dark:border-zinc-600 focus:border-zinc-400'
                    }`}
                  />
                  {isNameTaken(newProjectName.trim(), projects.map((p) => p.name)) && (
                    <p className="text-[10px] text-red-500 mt-1">A project with this name already exists</p>
                  )}
                </div>
                <div className="px-6 pb-5 pt-1 flex items-center justify-center gap-2">
                  {(() => {
                    const nameConflict = isNameTaken(newProjectName.trim(), projects.map((p) => p.name));
                    const canSubmit = !!newProjectName.trim() && !nameConflict;
                    return (
                      <>
                        <button
                          onClick={() => { setNoProjectsNuggetId(null); setNewProjectName(''); }}
                          className="px-4 py-2 text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => {
                            if (!canSubmit || !sourceProject) return;
                            const nid = noProjectsNuggetId;
                            setNoProjectsNuggetId(null);
                            setNewProjectName('');
                            onCreateProjectForNugget(nid, newProjectName.trim(), 'copy', sourceProject.id);
                          }}
                          disabled={!canSubmit}
                          className={`px-4 py-2 text-xs font-medium rounded-lg transition-colors ${canSubmit ? 'bg-zinc-100 dark:bg-zinc-800/50 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700' : 'bg-zinc-50 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 opacity-40 cursor-not-allowed'}`}
                        >
                          Copy
                        </button>
                        <button
                          onClick={() => {
                            if (!canSubmit || !sourceProject) return;
                            const nid = noProjectsNuggetId;
                            setNoProjectsNuggetId(null);
                            setNewProjectName('');
                            onCreateProjectForNugget(nid, newProjectName.trim(), 'move', sourceProject.id);
                          }}
                          disabled={!canSubmit}
                          className={`px-4 py-2 text-xs font-medium rounded-lg transition-colors ${canSubmit ? 'bg-zinc-900 text-white hover:bg-zinc-800' : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-400 opacity-40 cursor-not-allowed'}`}
                        >
                          Move
                        </button>
                      </>
                    );
                  })()}
                </div>
              </div>
            </div>,
            document.body,
          );
        })()}

      {/* ── No other nuggets — create-nugget-with-doc modal ── */}
      {noNuggetsModalDocId && onCreateNuggetWithDoc &&
        createPortal(
          <div
            className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 dark:bg-black/60"
            onClick={() => { setNoNuggetsModalDocId(null); setNewNuggetName(''); }}
          >
            <div
              className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl dark:shadow-black/30 mx-4 overflow-hidden"
              style={{ minWidth: 300, maxWidth: 'calc(100vw - 32px)', width: 'fit-content' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-6 pt-6 pb-3 text-center">
                <div className="w-9 h-9 rounded-full bg-zinc-100 dark:bg-zinc-800/50 flex items-center justify-center mx-auto mb-3">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="text-zinc-500 dark:text-zinc-400" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                    <polyline points="10 17 15 12 10 7" />
                    <line x1="15" y1="12" x2="3" y2="12" />
                  </svg>
                </div>
                <h3 className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 tracking-tight mb-1">No Other Nuggets</h3>
                <p className="text-[12px] text-zinc-500 dark:text-zinc-400 mt-1">Create a new nugget to copy this document to.</p>
                {(() => {
                  const allNuggetNames = (otherNuggets || []).map((n) => n.name);
                  const nameConflict = isNameTaken(newNuggetName.trim(), allNuggetNames);
                  return (
                    <>
                      <input
                        type="text"
                        value={newNuggetName}
                        onChange={(e) => setNewNuggetName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && newNuggetName.trim() && !nameConflict) {
                            const docId = noNuggetsModalDocId;
                            setNoNuggetsModalDocId(null);
                            setNewNuggetName('');
                            onCreateNuggetWithDoc(newNuggetName.trim(), docId);
                          }
                        }}
                        placeholder="Nugget name"
                        autoFocus
                        className={`mt-3 w-full px-3 py-2 text-xs border rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-300 transition-all text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-500 ${nameConflict ? 'border-red-300 focus:border-red-400' : 'border-zinc-200 dark:border-zinc-600 focus:border-zinc-400'}`}
                      />
                      {nameConflict && <p className="text-[10px] text-red-500 mt-1">A nugget with this name already exists</p>}
                    </>
                  );
                })()}
              </div>
              <div className="px-6 pb-5 pt-1 flex items-center justify-center gap-2">
                <button
                  onClick={() => { setNoNuggetsModalDocId(null); setNewNuggetName(''); }}
                  className="px-4 py-2 text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                {(() => {
                  const nameConflict = isNameTaken(newNuggetName.trim(), (otherNuggets || []).map((n) => n.name));
                  const canCreate = !!newNuggetName.trim() && !nameConflict;
                  return (
                    <button
                      onClick={() => {
                        if (!canCreate) return;
                        const docId = noNuggetsModalDocId;
                        setNoNuggetsModalDocId(null);
                        setNewNuggetName('');
                        onCreateNuggetWithDoc(newNuggetName.trim(), docId);
                      }}
                      disabled={!canCreate}
                      className={`px-4 py-2 text-xs font-medium rounded-lg transition-colors ${
                        canCreate
                          ? 'bg-zinc-900 text-white hover:bg-zinc-800'
                          : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-400 opacity-40 cursor-not-allowed'
                      }`}
                    >
                      New Nugget
                    </button>
                  );
                })()}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
};

export default ProjectsPanel;
