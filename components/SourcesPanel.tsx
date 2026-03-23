import React, { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import { createPortal } from 'react-dom';
import { DetailLevel, Heading, UploadedFile } from '../types';
import DocumentEditorModal, { DocumentEditorHandle } from './DocumentEditorModal';

import PanelRequirements from './PanelRequirements';
import SourcesManagerSidebar from './SourcesManagerSidebar';
import { computeMdSectionWordCount, getEligibleDetailLevels, getMaxDetailLevel, computeLodPassCounts, type LodPassCounts } from '../utils/cardUtils';
import { UnsavedChangesDialog } from './Dialogs';
import { PanelEditorHandle } from './CardsPanel';
import PdfViewer, { PdfViewerHandle } from './PdfViewer';
import { useThemeContext } from '../context/ThemeContext';
import { useNuggetContext } from '../context/NuggetContext';
import { usePanelOverlay } from '../hooks/usePanelOverlay';
import { useResizeDrag } from '../hooks/useResizeDrag';

interface SourcesPanelProps {
  isOpen: boolean;
  onToggle: () => void;
  documents: UploadedFile[];
  onSaveDocument: (docId: string, newContent: string) => void;
  onGenerateCardContent?: (cardId: string, detailLevel: DetailLevel, cardText: string, sourceDocName?: string, existingCardId?: string) => void;
  /** Create a folder with placeholders for batch generation (2+ cards). Returns card IDs in same order as titles. */
  onCreateBatchFolder?: (titles: string[], detailLevel: DetailLevel | DetailLevel[], sourceDocName: string) => string[] | null;
  /** IDs of headings / '__whole_document__' currently generating content (lifted from App.tsx to survive panel collapse). */
  generatingSourceIds?: Set<string>;
  /** Save TOC / bookmark changes. */
  onSaveToc?: (docId: string, newStructure: Heading[]) => Promise<void>;
  /** Notify parent when TOC draft state changes (for hard lock overlay). */
  onDirtyChange?: (isDirty: boolean) => void;
  /** Upload documents (replaces DocumentManagerDialog). */
  onUpload: (files: FileList) => void;
  tabBarRef?: React.RefObject<HTMLElement | null>;
}

const SourcesPanel = forwardRef<PanelEditorHandle, SourcesPanelProps>(
  (
    {
      isOpen,
      onToggle,
      documents,
      onSaveDocument,
      onGenerateCardContent,
      onCreateBatchFolder,
      generatingSourceIds,
      onSaveToc,
      onDirtyChange,
      onUpload,
      tabBarRef,
    },
    ref,
  ) => {
    const { darkMode } = useThemeContext();
    const { selectedDocumentId, setSelectedDocumentId, selectedNugget, removeNuggetDocument, renameNuggetDocument, toggleNuggetDocument } = useNuggetContext();
    const { shouldRender, isClosing, overlayStyle } = usePanelOverlay({
      isOpen,
      defaultWidth: Math.min(window.innerWidth * 0.6, 1000),
      minWidth: 300,
      anchorRef: tabBarRef,
    });
    const [activeDocTab, setActiveDocTab] = useState<string | null>(null);
    const editorHandleRef = useRef<DocumentEditorHandle>(null);

    // ── Sources Manager sidebar state ──
    const [smCollapsed, setSmCollapsed] = useState(false);
    const [smWidth, handleSmResize] = useResizeDrag({ initialWidth: 200, minWidth: 160, maxWidth: 360, direction: 'right' });

    // ── TOC draft mode (transactional save/discard) — declared early for useImperativeHandle ──
    const [tocDraft, setTocDraft] = useState<Heading[] | null>(null);
    const [tocDirtyDocId, setTocDirtyDocId] = useState<string | null>(null);

    useImperativeHandle(
      ref,
      () => ({
        get isDirty() {
          return (editorHandleRef.current?.isDirty ?? false) || tocDraft !== null;
        },
        save: () => {
          editorHandleRef.current?.save();
          if (tocDraft && tocDirtyDocId) {
            onSaveToc?.(tocDirtyDocId, tocDraft);
            setTocDraft(null);
            setTocDirtyDocId(null);
          }
        },
        discard: () => {
          editorHandleRef.current?.discard();
          setTocDraft(null);
          setTocDirtyDocId(null);
        },
      }),
      [tocDraft, tocDirtyDocId, onSaveToc],
    );

    // ── Native PDF TOC state ──
    const [tocWidth, handleTocResizeStartRaw] = useResizeDrag({ initialWidth: 220, minWidth: 140, maxWidth: 480, direction: 'right' });
    const [pdfTocResized, setPdfTocResized] = useState(false);
    const handleTocResizeStart = useCallback((e: React.MouseEvent) => { setPdfTocResized(true); handleTocResizeStartRaw(e); }, [handleTocResizeStartRaw]);
    const [pdfCollapsed, setPdfCollapsed] = useState<Set<string>>(new Set());
    const [pdfTreeCollapsed, setPdfTreeCollapsed] = useState(false);
    const [pdfContextMenu, setPdfContextMenu] = useState<{ x: number; y: number; headingId: string } | null>(null);
    const [pdfDocContextMenu, setPdfDocContextMenu] = useState<{ x: number; y: number } | null>(null);
    const [pdfGenerateSubmenuOpen, setPdfGenerateSubmenuOpen] = useState(false);
    const [pdfDocGenerateSubmenuOpen, setPdfDocGenerateSubmenuOpen] = useState(false);
    // Spinner state derived from lifted App.tsx state (survives panel collapse)
    const pdfGeneratingIds = generatingSourceIds ?? new Set<string>();
    const pdfGeneratingDoc = generatingSourceIds?.has('__whole_document__') ?? false;
    const pdfMenuRef = useRef<HTMLDivElement>(null);
    // PDF viewer controls
    const [pdfScale, setPdfScale] = useState(1.0);
    const [pdfRotation, setPdfRotation] = useState(0);
    const [pdfPageInfo, setPdfPageInfo] = useState({ current: 1, total: 0 });
    const [pdfFitMode, setPdfFitMode] = useState<'height' | 'width' | null>('height');
    const [activePdfHeadingId, setActivePdfHeadingId] = useState<string | null>(null);
    const pdfViewerRef = useRef<PdfViewerHandle>(null);

    // ── Multi-selection state (Tier 2) ──
    const [pdfSelectedIds, setPdfSelectedIds] = useState<Set<string>>(new Set());
    // Tracks last clicked heading for Shift+Click range selection
    const lastClickedPdfRef = useRef<string | null>(null);
    // ── Inline rename state ──
    const [renamingHeadingId, setRenamingHeadingId] = useState<string | null>(null);
    // ── Level selection submenu ──
    const [pdfLevelSubmenuOpen, setPdfLevelSubmenuOpen] = useState(false);
    // ── Editor dirty state (from DocumentEditorModal callback) ──
    const [editorDirty, setEditorDirty] = useState(false);
    // Notify parent of dirty state for hard lock overlay (TOC draft OR editor unsaved)
    useEffect(() => {
      onDirtyChange?.(tocDraft !== null || editorDirty);
    }, [tocDraft, editorDirty, onDirtyChange]);

    // Reset draft when switching documents
    useEffect(() => {
      setTocDraft(null);
      setTocDirtyDocId(null);
    }, [activeDocTab]);

    // Apply fit mode whenever page info changes (initial load / page switch)
    const applyFitMode = useCallback((mode: 'height' | 'width' | null) => {
      if (!mode || !pdfViewerRef.current) return;
      const dims = pdfViewerRef.current.getFitDims();
      if (!dims) return;
      const padding = 16; // 8px padding on each side
      if (mode === 'width') {
        setPdfScale(+((dims.containerWidth - padding) / dims.pageWidth).toFixed(4));
      } else {
        setPdfScale(+((dims.containerHeight - padding) / dims.pageHeight).toFixed(4));
      }
    }, []);


    // ── Unsaved-changes gating ──
    const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

    const gatedAction = useCallback(
      (action: () => void) => {
        if (editorHandleRef.current?.isDirty || tocDraft !== null) {
          setPendingAction(() => action);
          return;
        }
        action();
      },
      [tocDraft],
    );

    // ── Gated wrapper for panel toggle ──
    const handleToggle = useCallback(() => {
      gatedAction(() => onToggle());
    }, [gatedAction, onToggle]);

    // ── Sources Manager: gated document switch ──
    const handleSelectDocument = useCallback(
      (docId: string) => {
        if (docId === activeDocTab) return;
        gatedAction(() => {
          setActiveDocTab(docId);
          setSelectedDocumentId(docId);
        });
      },
      [activeDocTab, gatedAction, setSelectedDocumentId],
    );

    // Auto-select first document tab when documents change
    useEffect(() => {
      if (documents.length > 0 && (!activeDocTab || !documents.some((d) => d.id === activeDocTab))) {
        const firstDocId = documents[0].id;
        setActiveDocTab(firstDocId);
        setSelectedDocumentId(firstDocId);
      }
    }, [documents, activeDocTab, setSelectedDocumentId]);

    // Switch to requested document (from Projects panel "Open" action)
    useEffect(() => {
      if (selectedDocumentId && documents.some((d) => d.id === selectedDocumentId)) {
        setActiveDocTab(selectedDocumentId);
      }
    }, [selectedDocumentId, documents]);

    // ── Native PDF TOC context menu — close on outside click ──
    useEffect(() => {
      if (!pdfContextMenu && !pdfDocContextMenu) return;
      const handler = () => {
        setPdfContextMenu(null);
        setPdfDocContextMenu(null);
        setPdfGenerateSubmenuOpen(false);
        setPdfDocGenerateSubmenuOpen(false);
      };
      const timer = setTimeout(() => document.addEventListener('mousedown', handler), 0);
      return () => {
        clearTimeout(timer);
        document.removeEventListener('mousedown', handler);
      };
    }, [pdfContextMenu, pdfDocContextMenu]);

    // Reposition menu if it overflows the viewport
    useEffect(() => {
      if ((!pdfContextMenu && !pdfDocContextMenu) || !pdfMenuRef.current) return;
      const rect = pdfMenuRef.current.getBoundingClientRect();
      const pos = pdfContextMenu || pdfDocContextMenu!;
      let { x, y } = pos;
      if (y + rect.height > window.innerHeight - 8) y = window.innerHeight - rect.height - 8;
      if (x + rect.width > window.innerWidth - 8) x = window.innerWidth - rect.width - 8;
      if (y !== pos.y || x !== pos.x) {
        if (pdfContextMenu) setPdfContextMenu({ ...pdfContextMenu, x, y });
        else setPdfDocContextMenu({ x, y });
      }
    }, [pdfContextMenu, pdfDocContextMenu]);

    const closePdfMenu = useCallback(() => {
      setPdfContextMenu(null);
      setPdfDocContextMenu(null);
      setPdfGenerateSubmenuOpen(false);
      setPdfDocGenerateSubmenuOpen(false);
      setPdfLevelSubmenuOpen(false);
    }, []);

    // ── PDF Bookmark CRUD helpers ──

    const getPdfTier2Ids = useCallback((): string[] => {
      const ids = Array.from(pdfSelectedIds);
      if (ids.length > 0) return ids;
      if (pdfContextMenu) return [pdfContextMenu.headingId];
      return [];
    }, [pdfSelectedIds, pdfContextMenu]);

    const getPdfAffectedLevels = useCallback(
      (headings: Heading[]): { min: number; max: number } => {
        if (!pdfContextMenu) return { min: 1, max: 6 };
        const ids = getPdfTier2Ids();
        let min = 6,
          max = 1;
        for (const id of ids) {
          const idx = headings.findIndex((h) => h.id === id);
          if (idx === -1) continue;
          const parentLevel = headings[idx].level;
          min = Math.min(min, parentLevel);
          max = Math.max(max, parentLevel);
          for (let i = idx + 1; i < headings.length; i++) {
            if (headings[i].level <= parentLevel) break;
            min = Math.min(min, headings[i].level);
            max = Math.max(max, headings[i].level);
          }
        }
        return { min, max };
      },
      [pdfContextMenu, getPdfTier2Ids],
    );

    const _handlePdfPromote = useCallback(
      (activeDoc: UploadedFile) => {
        const headings = tocDraft ?? activeDoc.structure ?? [];
        const ids = getPdfTier2Ids();
        const newHeadings = headings.map((h) => ({ ...h }));
        for (const id of ids) {
          const idx = newHeadings.findIndex((h) => h.id === id);
          if (idx === -1) continue;
          const parentLevel = newHeadings[idx].level;
          newHeadings[idx].level = Math.max(1, parentLevel - 1);
          for (let i = idx + 1; i < newHeadings.length; i++) {
            if (newHeadings[i].level <= parentLevel) break;
            if (!ids.includes(newHeadings[i].id)) {
              newHeadings[i].level = Math.max(1, newHeadings[i].level - 1);
            }
          }
        }
        setTocDraft(newHeadings);
        if (!tocDirtyDocId) setTocDirtyDocId(activeDoc.id);
        closePdfMenu();
      },
      [getPdfTier2Ids, tocDraft, tocDirtyDocId, closePdfMenu],
    );

    const _handlePdfDemote = useCallback(
      (activeDoc: UploadedFile) => {
        const headings = tocDraft ?? activeDoc.structure ?? [];
        const ids = getPdfTier2Ids();
        const newHeadings = headings.map((h) => ({ ...h }));
        for (const id of ids) {
          const idx = newHeadings.findIndex((h) => h.id === id);
          if (idx === -1) continue;
          const parentLevel = newHeadings[idx].level;
          newHeadings[idx].level = Math.min(6, parentLevel + 1);
          for (let i = idx + 1; i < newHeadings.length; i++) {
            if (newHeadings[i].level <= parentLevel) break;
            if (!ids.includes(newHeadings[i].id)) {
              newHeadings[i].level = Math.min(6, newHeadings[i].level + 1);
            }
          }
        }
        setTocDraft(newHeadings);
        if (!tocDirtyDocId) setTocDirtyDocId(activeDoc.id);
        closePdfMenu();
      },
      [getPdfTier2Ids, tocDraft, tocDirtyDocId, closePdfMenu],
    );

    const _handlePdfDelete = useCallback(
      (activeDoc: UploadedFile) => {
        const headings = tocDraft ?? activeDoc.structure ?? [];
        const idsToDelete = new Set(getPdfTier2Ids());
        const newHeadings = headings.filter((h) => !idsToDelete.has(h.id));
        setTocDraft(newHeadings);
        if (!tocDirtyDocId) setTocDirtyDocId(activeDoc.id);
        setPdfSelectedIds(new Set());
        closePdfMenu();
      },
      [getPdfTier2Ids, tocDraft, tocDirtyDocId, closePdfMenu],
    );

    const handlePdfRename = useCallback(
      (activeDoc: UploadedFile, headingId: string, newText: string) => {
        const headings = tocDraft ?? activeDoc.structure ?? [];
        const newHeadings = headings.map((h) => (h.id === headingId ? { ...h, text: newText.trim() || h.text } : h));
        setTocDraft(newHeadings);
        if (!tocDirtyDocId) setTocDirtyDocId(activeDoc.id);
        setRenamingHeadingId(null);
      },
      [tocDraft, tocDirtyDocId],
    );

    const handlePdfSelectLevel = useCallback(
      (headings: Heading[], levels: number[]) => {
        const levelSet = new Set(levels);
        const currentlySelected = headings.filter((h) => pdfSelectedIds.has(h.id));
        const allAtTheseLevels = currentlySelected.length > 0 && currentlySelected.every((h) => levelSet.has(h.level));
        const targeted = headings.filter((h) => levelSet.has(h.level));
        const allTargetedSelected = targeted.length > 0 && targeted.every((h) => pdfSelectedIds.has(h.id));
        if (allAtTheseLevels && allTargetedSelected) {
          setPdfSelectedIds(new Set());
        } else {
          setPdfSelectedIds(new Set(targeted.map((h) => h.id)));
        }
        closePdfMenu();
      },
      [pdfSelectedIds, closePdfMenu],
    );

    // Helper: check if a heading is visible (not hidden by a collapsed ancestor)
    const isPdfHeadingVisible = useCallback(
      (headings: Heading[], index: number): boolean => {
        const heading = headings[index];
        // Walk backwards to find any ancestor that is collapsed
        for (let i = index - 1; i >= 0; i--) {
          if (headings[i].level < heading.level) {
            // This is a potential ancestor
            if (pdfCollapsed.has(headings[i].id)) return false;
            // Check if this ancestor itself is visible
            if (!isPdfHeadingVisible(headings, i)) return false;
            // Only the nearest ancestor of each level matters
            if (headings[i].level === heading.level - 1) break;
          }
        }
        return true;
      },
      [pdfCollapsed],
    );

    // Helper: check if a heading has children
    const pdfHeadingHasChildren = useCallback((headings: Heading[], index: number): boolean => {
      if (index + 1 >= headings.length) return false;
      return headings[index + 1].level > headings[index].level;
    }, []);

    return (
      <>
        {shouldRender &&
          createPortal(
            <>
            <div
              data-panel-overlay
              className="fixed z-[107] flex flex-col bg-white dark:bg-zinc-900 border shadow-[5px_0_6px_rgba(0,0,0,0.35)] overflow-hidden"
              style={{
                borderColor: 'rgb(23,80,172)',
                ...overlayStyle,
              }}
            >
              <div className="flex-1 flex min-h-0 overflow-hidden">
                {/* ── Sources Manager sidebar (collapsible) ── */}
                {smCollapsed ? (
                  <div
                    className="shrink-0 w-10 flex flex-col transition-all duration-200"
                    style={{ backgroundColor: darkMode ? 'rgb(30,58,100)' : 'rgb(190,215,245)' }}
                  >
                    <div
                      className="shrink-0 sticky top-0 z-10"
                      style={{ backgroundColor: darkMode ? 'rgb(30,58,100)' : 'rgb(190,215,245)' }}
                    >
                      <button
                        onClick={() => setSmCollapsed(false)}
                        className="flex flex-col items-center gap-1.5 py-3 px-1 w-full hover:opacity-80 transition-colors cursor-pointer"
                        title="Expand sources manager"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-zinc-500 dark:text-zinc-400">
                          <rect width="18" height="18" x="3" y="3" rx="2" />
                          <path d="M9 3v18" />
                        </svg>
                        <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-800 dark:text-zinc-200" style={{ writingMode: 'vertical-rl', textOrientation: 'mixed', transform: 'rotate(180deg)' }}>
                          Sources Manager
                        </span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <aside
                    className="shrink-0 flex flex-col overflow-hidden bg-white dark:bg-zinc-900"
                    style={{ width: smWidth }}
                  >
                    {/* Header */}
                    <div className="shrink-0 sticky top-0 z-10 h-[36px] flex items-center gap-2 border-b border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-900">
                      <button
                        onClick={() => setSmCollapsed(true)}
                        className="flex items-center gap-2 h-full hover:opacity-80 transition-colors cursor-pointer"
                        title="Collapse sources manager"
                      >
                        <div className="h-full w-[36px] shrink-0 flex items-center justify-center" style={{ backgroundColor: darkMode ? 'rgb(30,58,100)' : 'rgb(190,215,245)' }}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-zinc-500 dark:text-zinc-400">
                            <rect width="18" height="18" x="3" y="3" rx="2" />
                            <path d="M9 3v18" />
                          </svg>
                        </div>
                        <span className="text-[13px] font-bold uppercase tracking-wider text-zinc-800 dark:text-zinc-200 whitespace-nowrap">
                          Sources Manager
                        </span>
                      </button>
                    </div>
                    {/* Sidebar content */}
                    <SourcesManagerSidebar
                      documents={documents}
                      activeDocId={activeDocTab}
                      onSelectDocument={handleSelectDocument}
                      onRename={renameNuggetDocument}
                      onDelete={removeNuggetDocument}
                      onToggleEnabled={toggleNuggetDocument}
                      onUpload={onUpload}
                      darkMode={darkMode}
                    />
                  </aside>
                )}

                {/* Resize divider (only when expanded) */}
                {!smCollapsed && (
                  <div
                    onMouseDown={handleSmResize}
                    className="shrink-0 w-[5px] cursor-col-resize group relative select-none flex items-center justify-center"
                  >
                    <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-zinc-200 dark:bg-zinc-600 group-hover:bg-zinc-400 dark:group-hover:bg-zinc-500 transition-colors" />
                    <div className="w-[5px] h-6 rounded-full bg-zinc-300 dark:bg-zinc-500 group-hover:bg-zinc-400 dark:group-hover:bg-zinc-400 transition-colors" />
                  </div>
                )}

                {/* ── Main content area ── */}
                <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden">

                {/* Sources content area */}
                {documents.length > 0 ? (
                  <>
                    {(() => {
                      const activeDoc = documents.find((d) => d.id === activeDocTab);

                      // Native PDF: iframe viewer + TOC sidebar with context menus
                      if (activeDoc?.sourceType === 'native-pdf' && activeDoc.pdfBase64) {
                        const headings = tocDraft ?? activeDoc.structure ?? [];
                        return (
                          <div className="flex-1 flex flex-col min-h-0">
                            {/* PDF Toolbar — matches FormatToolbar visual style */}
                            <div className="shrink-0 flex justify-center py-[3px] px-6 lg:px-8 bg-white dark:bg-zinc-900 border-b border-zinc-100 dark:border-zinc-700">
                              <div className="flex items-center gap-0.5 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl rounded-full px-2 py-1">
                                {/* Zoom out */}
                                <button
                                  onClick={() => {
                                    setPdfFitMode(null);
                                    setPdfScale((s) => Math.max(0.5, +(s - 0.25).toFixed(2)));
                                  }}
                                  className="w-7 h-7 rounded-full flex items-center justify-center transition-all hover:bg-zinc-100 dark:hover:bg-zinc-700 hover:text-zinc-800 dark:hover:text-zinc-200 text-zinc-600 dark:text-zinc-400"
                                  title="Zoom out"
                                  aria-label="Zoom out"
                                >
                                  <svg
                                    width="14"
                                    height="14"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  >
                                    <line x1="5" y1="12" x2="19" y2="12" />
                                  </svg>
                                </button>
                                {/* Zoom level */}
                                <span className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400 w-10 text-center tabular-nums">
                                  {Math.round(pdfScale * 100)}%
                                </span>
                                {/* Zoom in */}
                                <button
                                  onClick={() => {
                                    setPdfFitMode(null);
                                    setPdfScale((s) => Math.min(3, +(s + 0.25).toFixed(2)));
                                  }}
                                  className="w-7 h-7 rounded-full flex items-center justify-center transition-all hover:bg-zinc-100 dark:hover:bg-zinc-700 hover:text-zinc-800 dark:hover:text-zinc-200 text-zinc-600 dark:text-zinc-400"
                                  title="Zoom in"
                                  aria-label="Zoom in"
                                >
                                  <svg
                                    width="14"
                                    height="14"
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
                                </button>
                                <div className="w-px h-4 bg-zinc-200 dark:bg-zinc-700 mx-1" />
                                {/* Fit to page width */}
                                <button
                                  onClick={() => {
                                    setPdfFitMode('width');
                                    applyFitMode('width');
                                  }}
                                  className={`w-7 h-7 rounded-full flex items-center justify-center transition-all ${pdfFitMode === 'width' ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200' : 'hover:bg-zinc-100 dark:hover:bg-zinc-700 hover:text-zinc-800 dark:hover:text-zinc-200 text-zinc-600 dark:text-zinc-400'}`}
                                  title="Fit to page width"
                                  aria-label="Fit to page width"
                                >
                                  <svg
                                    width="14"
                                    height="14"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  >
                                    <path d="M21 3H3v18h18V3z" />
                                    <path d="M4 12h16" />
                                    <path d="M7 9l-3 3 3 3" />
                                    <path d="M17 9l3 3-3 3" />
                                  </svg>
                                </button>
                                {/* Fit to page height */}
                                <button
                                  onClick={() => {
                                    setPdfFitMode('height');
                                    applyFitMode('height');
                                  }}
                                  className={`w-7 h-7 rounded-full flex items-center justify-center transition-all ${pdfFitMode === 'height' ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200' : 'hover:bg-zinc-100 dark:hover:bg-zinc-700 hover:text-zinc-800 dark:hover:text-zinc-200 text-zinc-600 dark:text-zinc-400'}`}
                                  title="Fit to page height"
                                  aria-label="Fit to page height"
                                >
                                  <svg
                                    width="14"
                                    height="14"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  >
                                    <path d="M21 3H3v18h18V3z" />
                                    <path d="M12 4v16" />
                                    <path d="M9 7l3-3 3 3" />
                                    <path d="M9 17l3 3 3-3" />
                                  </svg>
                                </button>
                                {/* Rotate */}
                                <button
                                  onClick={() => setPdfRotation((r) => (r + 90) % 360)}
                                  className="w-7 h-7 rounded-full flex items-center justify-center transition-all hover:bg-zinc-100 dark:hover:bg-zinc-700 hover:text-zinc-800 dark:hover:text-zinc-200 text-zinc-600 dark:text-zinc-400"
                                  title="Rotate clockwise"
                                  aria-label="Rotate clockwise"
                                >
                                  <svg
                                    width="14"
                                    height="14"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  >
                                    <polyline points="23 4 23 10 17 10" />
                                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                                  </svg>
                                </button>
                                <div className="w-px h-4 bg-zinc-200 dark:bg-zinc-700 mx-1" />
                                {/* Page indicator */}
                                <span className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400 px-1 tabular-nums">
                                  {pdfPageInfo.total > 0 ? `${pdfPageInfo.current} / ${pdfPageInfo.total}` : '–'}
                                </span>
                                <div className="w-px h-4 bg-zinc-200 dark:bg-zinc-700 mx-1" />
                                {/* PDF label */}
                                <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-400 px-2">
                                  PDF
                                </span>
                              </div>
                            </div>
                            {/* TOC + PDF content */}
                            <div className="flex-1 flex min-h-0">
                              {/* TOC Sidebar */}
                              <aside
                                className="shrink-0 overflow-y-auto bg-[#fafafa] dark:bg-zinc-900 relative"
                                style={{ width: pdfTocResized ? tocWidth : '25%' }}
                              >
                                {/* ── Sticky header ── */}
                                <div className="sticky top-0 z-10 h-[36px] flex items-center gap-2 border-b border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-900">
                                    <div className="h-full w-[36px] shrink-0 flex items-center justify-center" style={{ backgroundColor: darkMode ? 'rgb(25,50,90)' : 'rgb(140,185,230)' }}>
                                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-zinc-500 dark:text-zinc-400">
                                        <line x1="8" y1="6" x2="21" y2="6" />
                                        <line x1="8" y1="12" x2="21" y2="12" />
                                        <line x1="8" y1="18" x2="21" y2="18" />
                                        <line x1="3" y1="6" x2="3.01" y2="6" />
                                        <line x1="3" y1="12" x2="3.01" y2="12" />
                                        <line x1="3" y1="18" x2="3.01" y2="18" />
                                      </svg>
                                    </div>
                                    <span className="text-[13px] font-bold uppercase tracking-wider text-zinc-800 dark:text-zinc-200">
                                      Table of Contents (Bookmarks)
                                    </span>
                                </div>

                                {/* ── Document root node — matches MD TOC root node ── */}
                                <div className="px-2 pt-1">
                                  <div
                                    className={`group flex items-center gap-1 px-1 py-1.5 cursor-pointer select-none transition-all duration-150 border border-transparent ${
                                      activePdfHeadingId === null && pdfSelectedIds.size === 0
                                        ? 'sidebar-node-active'
                                        : 'hover:border-blue-300'
                                    }`}
                                    onClick={() => {
                                      setPdfSelectedIds(new Set());
                                      setActivePdfHeadingId(null);
                                      pdfViewerRef.current?.scrollToHeading('', 1);
                                    }}
                                  >
                                    {/* Collapse chevron for entire tree */}
                                    {headings.length > 0 ? (
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setPdfTreeCollapsed((prev) => !prev);
                                        }}
                                        className="flex-shrink-0 w-4 h-4 flex items-center justify-center text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-all duration-200 cursor-pointer"
                                      >
                                        <svg
                                          width="12"
                                          height="12"
                                          viewBox="0 0 24 24"
                                          fill="none"
                                          stroke="currentColor"
                                          strokeWidth="2.5"
                                          strokeLinecap="round"
                                          strokeLinejoin="round"
                                          className={`transition-transform duration-200 ${pdfTreeCollapsed ? '' : 'rotate-90'}`}
                                        >
                                          <polyline points="9 18 15 12 9 6" />
                                        </svg>
                                      </button>
                                    ) : (
                                      <span className="flex-shrink-0 w-4 h-4" />
                                    )}
                                    {/* PDF doc icon */}
                                    <svg
                                      width="12"
                                      height="12"
                                      viewBox="0 0 24 24"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth="2"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      className="shrink-0"
                                      style={{
                                        color:
                                          activePdfHeadingId === null && pdfSelectedIds.size === 0
                                            ? '#2a9fd4'
                                            : darkMode
                                              ? 'rgb(140,170,200)'
                                              : 'rgb(50,90,130)',
                                      }}
                                    >
                                      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
                                      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
                                    </svg>
                                    {pdfGeneratingDoc && (
                                      <div className="shrink-0 w-3 h-3 border-[1.5px] border-zinc-300 border-t-blue-600 rounded-full animate-spin" />
                                    )}
                                    <div className="flex-1 min-w-0">
                                      <p
                                        className="text-[13px] font-black truncate"
                                        style={{
                                          color:
                                            activePdfHeadingId === null && pdfSelectedIds.size === 0
                                              ? '#2a9fd4'
                                              : darkMode
                                                ? 'rgb(140,170,200)'
                                                : 'rgb(50,90,130)',
                                        }}
                                        title={activeDoc.name}
                                      >
                                        {activeDoc.name}
                                      </p>
                                      {activeDoc.tocSource && (
                                        <span className="text-[9px] text-zinc-500 dark:text-zinc-400 font-normal italic block">
                                          {activeDoc.tocSource === 'toc_page'
                                            ? 'from TOC page'
                                            : 'AI-detected headings'}
                                        </span>
                                      )}
                                    </div>
                                    {/* Kebab menu — document-level */}
                                    {onGenerateCardContent && (
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setPdfDocContextMenu({ x: e.clientX, y: e.clientY });
                                          setPdfDocGenerateSubmenuOpen(false);
                                        }}
                                        className="shrink-0 w-4 h-4 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 transition-opacity"
                                        style={{
                                          color:
                                            activePdfHeadingId === null && pdfSelectedIds.size === 0
                                              ? 'rgba(42,159,212,0.6)'
                                              : darkMode
                                                ? 'rgba(160,180,200,0.5)'
                                                : 'rgba(100,116,139,0.5)',
                                        }}
                                        aria-label="Document menu"
                                      >
                                        <svg
                                          width="14"
                                          height="14"
                                          viewBox="0 0 24 24"
                                          fill="none"
                                          stroke="currentColor"
                                          strokeWidth="2.5"
                                          strokeLinecap="round"
                                          strokeLinejoin="round"
                                        >
                                          <circle cx="12" cy="5" r="1" />
                                          <circle cx="12" cy="12" r="1" />
                                          <circle cx="12" cy="19" r="1" />
                                        </svg>
                                      </button>
                                    )}
                                  </div>
                                </div>

                                {/* ── Heading tree — matches MD TOC tree structure ── */}
                                {!pdfTreeCollapsed && (
                                  <div
                                    className="px-2 pb-20 relative ml-4 border-l"
                                    role="tree"
                                    aria-label="PDF table of contents"
                                    style={{ borderColor: darkMode ? 'rgba(42,159,212,0.3)' : 'rgba(42,159,212,0.2)' }}
                                  >
                                    {headings.length > 0 ? (
                                      (() => {
                                        const indentClasses = ['ml-0', 'ml-4', 'ml-8', 'ml-12', 'ml-16', 'ml-20'];
                                        const textStyles = [
                                          'text-[12px] font-bold text-zinc-800 dark:text-zinc-200',
                                          'text-[11px] font-semibold text-zinc-600 dark:text-zinc-400',
                                          'text-[11px] font-medium text-zinc-500 dark:text-zinc-400',
                                          'text-[10px] font-normal text-zinc-500 dark:text-zinc-400',
                                          'text-[10px] font-normal text-zinc-500 dark:text-zinc-400',
                                          'text-[10px] font-normal text-zinc-500 dark:text-zinc-400',
                                        ];
                                        return headings.map((heading, hIdx) => {
                                          if (!isPdfHeadingVisible(headings, hIdx)) return null;
                                          const level = Math.min(heading.level, 6);
                                          const indent = indentClasses[level - 1] || 'ml-0';
                                          const textStyle = textStyles[level - 1] || textStyles[5];
                                          const hasChildren = pdfHeadingHasChildren(headings, hIdx);
                                          const isCollapsed = pdfCollapsed.has(heading.id);
                                          const isGenerating = pdfGeneratingIds.has(heading.id);
                                          const isSelected = pdfSelectedIds.has(heading.id);
                                          const isActive = activePdfHeadingId === heading.id;
                                          const isRenaming = renamingHeadingId === heading.id;
                                          return (
                                            <div key={heading.id} role="treeitem" aria-expanded={hasChildren ? !isCollapsed : undefined}>
                                              {/* H1 separator — outside content div like MD TOC */}
                                              {level === 1 && hIdx > 0 && (
                                                <div className="h-px bg-zinc-200 dark:bg-zinc-700 mb-1 mt-2 ml-1" />
                                              )}
                                              {/* Content row — indented, interactive */}
                                              <div
                                                className={`${indent} group relative flex items-center space-x-1 py-1 px-1 transition-all duration-300 cursor-pointer border border-transparent ${
                                                  isActive
                                                    ? 'sidebar-node-active'
                                                    : isSelected
                                                      ? 'bg-[rgba(160,200,220,0.2)]'
                                                      : 'hover:border-blue-300'
                                                }`}
                                                onClick={(e) => {
                                                  if (e.ctrlKey || e.metaKey) {
                                                    // Ctrl+Click: toggle this heading in/out of selection
                                                    setPdfSelectedIds((prev) => {
                                                      const next = new Set(prev);
                                                      if (next.has(heading.id)) next.delete(heading.id);
                                                      else next.add(heading.id);
                                                      return next;
                                                    });
                                                    setActivePdfHeadingId(null);
                                                    lastClickedPdfRef.current = heading.id;
                                                    return;
                                                  }
                                                  if (e.shiftKey && lastClickedPdfRef.current) {
                                                    // Shift+Click: range select from anchor to current
                                                    const fromIdx = headings.findIndex((h) => h.id === lastClickedPdfRef.current);
                                                    const toIdx = hIdx;
                                                    if (fromIdx !== -1) {
                                                      const lo = Math.min(fromIdx, toIdx);
                                                      const hi = Math.max(fromIdx, toIdx);
                                                      const rangeIds = new Set(headings.slice(lo, hi + 1).map((h) => h.id));
                                                      setPdfSelectedIds(rangeIds);
                                                      setActivePdfHeadingId(null);
                                                      return;
                                                    }
                                                  }
                                                  // Normal click: clear selection, set active, scroll
                                                  setPdfSelectedIds(new Set());
                                                  if (pdfViewerRef.current) {
                                                    pdfViewerRef.current.scrollToHeading(
                                                      heading.text,
                                                      heading.page ?? undefined,
                                                    );
                                                    setActivePdfHeadingId(heading.id);
                                                  }
                                                  lastClickedPdfRef.current = heading.id;
                                                }}
                                                onContextMenu={(e) => {
                                                  e.preventDefault();
                                                  e.stopPropagation();
                                                  if (!pdfSelectedIds.has(heading.id)) {
                                                    setPdfSelectedIds(new Set([heading.id]));
                                                  }
                                                  setPdfLevelSubmenuOpen(false);
                                                  setPdfGenerateSubmenuOpen(false);
                                                  setPdfContextMenu({ x: e.clientX, y: e.clientY, headingId: heading.id });
                                                }}
                                              >
                                                {/* Collapse/expand toggle */}
                                                {hasChildren ? (
                                                  <button
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      setPdfCollapsed((prev) => {
                                                        const next = new Set(prev);
                                                        if (next.has(heading.id)) next.delete(heading.id);
                                                        else next.add(heading.id);
                                                        return next;
                                                      });
                                                    }}
                                                    className="flex-shrink-0 w-4 h-4 flex items-center justify-center text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-all duration-200 cursor-pointer"
                                                    aria-label={isCollapsed ? 'Expand section' : 'Collapse section'}
                                                  >
                                                    <svg
                                                      width="12"
                                                      height="12"
                                                      viewBox="0 0 24 24"
                                                      fill="none"
                                                      stroke="currentColor"
                                                      strokeWidth="2.5"
                                                      strokeLinecap="round"
                                                      strokeLinejoin="round"
                                                      className={`transition-transform duration-200 ${isCollapsed ? '' : 'rotate-90'}`}
                                                    >
                                                      <polyline points="9 18 15 12 9 6" />
                                                    </svg>
                                                  </button>
                                                ) : (
                                                  <div className="flex-shrink-0 w-4 h-4" />
                                                )}

                                                {/* Generating spinner */}
                                                {isGenerating && (
                                                  <div className="flex-shrink-0 w-3.5 h-3.5 border-2 border-zinc-300 border-t-zinc-600 rounded-full animate-spin" />
                                                )}

                                                {/* Heading text or rename input */}
                                                {isRenaming ? (
                                                  <input
                                                    autoFocus
                                                    defaultValue={heading.text}
                                                    className={`${textStyle} flex-1 min-w-0 bg-white dark:bg-zinc-800 border border-blue-400 rounded px-1 py-0.5 outline-none`}
                                                    onBlur={(e) =>
                                                      activeDoc && handlePdfRename(activeDoc, heading.id, e.target.value)
                                                    }
                                                    onKeyDown={(e) => {
                                                      if (e.key === 'Enter')
                                                        activeDoc &&
                                                          handlePdfRename(
                                                            activeDoc,
                                                            heading.id,
                                                            (e.target as HTMLInputElement).value,
                                                          );
                                                      if (e.key === 'Escape') setRenamingHeadingId(null);
                                                    }}
                                                    onClick={(e) => e.stopPropagation()}
                                                  />
                                                ) : (
                                                  <span
                                                    className={`${textStyle} transition-all select-none truncate pr-2 ml-0.5 flex-1 min-w-0`}
                                                    style={{ opacity: isActive || isSelected || isGenerating ? 1 : 0.7 }}
                                                  >
                                                    {heading.text}
                                                  </span>
                                                )}

                                                {/* Word count badge */}
                                                {(() => {
                                                  const wc = computeMdSectionWordCount(heading.text, activeDoc);
                                                  return wc != null && wc > 0 ? (
                                                    <span className="text-[9px] text-zinc-400 dark:text-zinc-500 shrink-0 tabular-nums">{wc}w</span>
                                                  ) : null;
                                                })()}

                                                {/* Page number badge */}
                                                {heading.page != null && (
                                                  <span className="shrink-0 text-[8px] text-zinc-400 dark:text-zinc-500 font-light tabular-nums">
                                                    {heading.page}
                                                  </span>
                                                )}

                                                {/* Kebab menu — heading-level (matches MD TOC inline color) */}
                                                <button
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    if (!pdfSelectedIds.has(heading.id)) {
                                                      setPdfSelectedIds(new Set([heading.id]));
                                                    }
                                                    setPdfLevelSubmenuOpen(false);
                                                    setPdfGenerateSubmenuOpen(false);
                                                    setPdfContextMenu({
                                                      x: e.clientX,
                                                      y: e.clientY,
                                                      headingId: heading.id,
                                                    });
                                                  }}
                                                  className="shrink-0 w-4 h-4 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 transition-opacity"
                                                  style={{
                                                    color: isActive
                                                      ? 'rgba(42,159,212,0.6)'
                                                      : darkMode
                                                        ? 'rgba(160,180,200,0.4)'
                                                        : 'rgba(100,116,139,0.4)',
                                                  }}
                                                  title="Heading menu"
                                                  aria-label="Heading menu"
                                                >
                                                  <svg
                                                    width="14"
                                                    height="14"
                                                    viewBox="0 0 24 24"
                                                    fill="none"
                                                    stroke="currentColor"
                                                    strokeWidth="2.5"
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                  >
                                                    <circle cx="12" cy="5" r="1" />
                                                    <circle cx="12" cy="12" r="1" />
                                                    <circle cx="12" cy="19" r="1" />
                                                  </svg>
                                                </button>
                                              </div>
                                            </div>
                                          );
                                        });
                                      })()
                                    ) : (
                                      <p className="px-2 py-4 text-[10px] text-zinc-500 dark:text-zinc-400 font-light italic text-center">
                                        Select text in the PDF and click Bookmark to add headings
                                      </p>
                                    )}
                                  </div>
                                )}
                              </aside>

                              {/* TOC/PDF Divider */}
                              <div
                                onMouseDown={handleTocResizeStart}
                                className="shrink-0 w-[5px] cursor-ew-resize relative group flex items-center justify-center"
                              >
                                <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-zinc-200 dark:bg-zinc-600 group-hover:bg-zinc-400 dark:group-hover:bg-zinc-500 transition-colors" />
                                <div className="w-[5px] h-6 rounded-full bg-zinc-300 dark:bg-zinc-500 group-hover:bg-zinc-400 dark:group-hover:bg-zinc-400 transition-colors" />
                              </div>

                              {/* PDF Viewer */}
                              <div className="flex-1 min-w-0 flex">
                                <div className="flex-1 min-w-0">
                                  <PdfViewer
                                    ref={pdfViewerRef}
                                    pdfBase64={activeDoc.pdfBase64}
                                    scale={pdfScale}
                                    rotation={pdfRotation}
                                    onPageChange={(current, total) => {
                                      const isInitial = pdfPageInfo.total === 0 && total > 0;
                                      setPdfPageInfo({ current, total });
                                      if (isInitial) setTimeout(() => applyFitMode(pdfFitMode), 50);
                                    }}
                                  />
                                </div>
                              </div>

                              {/* ── Native PDF heading context menu (unified with MD TOC menu) ── */}
                              {pdfContextMenu &&
                                (() => {
                                  const ctxHeading = headings.find((h) => h.id === pdfContextMenu.headingId);
                                  if (!ctxHeading) return null;
                                  const affectedIds = getPdfTier2Ids();
                                  const isMultiSelect = affectedIds.length > 1;
                                  const affectedLevels = getPdfAffectedLevels(headings);
                                  const _canPromote = affectedLevels.min > 1;
                                  const _canDemote = affectedLevels.max < 6;

                                  // ── LOD Eligibility (pre-computed for context menu gating) ──
                                  let pdfLodCounts: LodPassCounts | null = null;
                                  {
                                    const ids = getPdfTier2Ids();
                                    const texts = ids
                                      .map((id) => headings.find((hh) => hh.id === id)?.text)
                                      .filter((t): t is string => !!t);
                                    if (texts.length > 0) {
                                      pdfLodCounts = computeLodPassCounts(texts, activeDoc);
                                    }
                                  }

                                  return createPortal(
                                    <div
                                      ref={pdfMenuRef}
                                      className="fixed z-[130] min-w-[180px] bg-white dark:bg-zinc-900 rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-700 py-1 animate-in fade-in zoom-in-95 duration-150"
                                      style={{ top: pdfContextMenu.y, left: pdfContextMenu.x }}
                                      onMouseDown={(e) => e.stopPropagation()}
                                      onContextMenu={(e) => e.preventDefault()}
                                    >
                                      {/* Generate Card Content submenu */}
                                      {onGenerateCardContent && (
                                        <>
                                          <div className="relative">
                                            <button
                                              onClick={() => setPdfGenerateSubmenuOpen((prev) => !prev)}
                                              onMouseEnter={() => {
                                                setPdfGenerateSubmenuOpen(true);
                                                setPdfLevelSubmenuOpen(false);
                                              }}
                                              className="w-full text-left px-3 py-2 text-[11px] font-bold text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors flex items-center justify-between"
                                            >
                                              <span className="flex items-center gap-2">
                                                <svg
                                                  width="12"
                                                  height="12"
                                                  viewBox="0 0 24 24"
                                                  fill="none"
                                                  stroke="currentColor"
                                                  strokeWidth="2"
                                                  strokeLinecap="round"
                                                  strokeLinejoin="round"
                                                  className="text-zinc-500"
                                                >
                                                  <rect x="3" y="3" width="16" height="16" rx="2" />
                                                  <path d="M12 8v8" />
                                                  <path d="M8 12h8" />
                                                </svg>
                                                Generate Card Content{isMultiSelect ? ' for Highlighted Items' : ''}
                                              </span>
                                              <svg
                                                width="12"
                                                height="12"
                                                viewBox="0 0 24 24"
                                                fill="none"
                                                stroke="currentColor"
                                                strokeWidth="2.5"
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                                className="text-zinc-500 dark:text-zinc-400"
                                              >
                                                <polyline points="9 18 15 12 9 6" />
                                              </svg>
                                            </button>

                                            {pdfGenerateSubmenuOpen && (
                                              <div className="absolute left-full top-0 ml-1 min-w-[200px] bg-white dark:bg-zinc-900 rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-700 py-1 animate-in fade-in zoom-in-95 duration-100">
                                                {/* Snapshot — content as-is, no gate */}
                                                <button
                                                  onClick={async () => {
                                                    const ids = getPdfTier2Ids();
                                                    const targets = ids
                                                      .map((id) => ({
                                                        id,
                                                        text: headings.find((hh) => hh.id === id)?.text || '',
                                                      }))
                                                      .filter((t) => t.text);
                                                    closePdfMenu();
                                                    let cardIds: string[] | null = null;
                                                    if (targets.length >= 2 && onCreateBatchFolder) {
                                                      cardIds = onCreateBatchFolder(
                                                        targets.map((t) => t.text),
                                                        'DirectContent' as DetailLevel,
                                                        activeDoc.name,
                                                      );
                                                    }
                                                    await Promise.all(
                                                      targets.map((t, i) =>
                                                        onGenerateCardContent(
                                                          t.id,
                                                          'DirectContent' as DetailLevel,
                                                          t.text,
                                                          activeDoc.name,
                                                          cardIds?.[i],
                                                        ),
                                                      ),
                                                    );
                                                  }}
                                                  className="w-full text-left px-3 py-2 text-[11px] text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors flex items-center justify-between gap-3"
                                                >
                                                  <span className="font-medium text-emerald-600">Snapshot</span>
                                                  <span className="text-[9px] text-zinc-500 dark:text-zinc-400">Content as-is</span>
                                                </button>

                                                {/* Executive / Standard / Detailed — gated by word count */}
                                                {[
                                                  { level: 'Executive' as DetailLevel, label: 'Executive', desc: '60-80 words' },
                                                  { level: 'Standard' as DetailLevel, label: 'Standard', desc: '120-170 words' },
                                                  { level: 'Detailed' as DetailLevel, label: 'Detailed', desc: '250-300 words' },
                                                ].map((opt) => {
                                                  const lodKey = opt.level as 'Executive' | 'Standard' | 'Detailed';
                                                  const passCount = pdfLodCounts?.counts[lodKey] ?? null;
                                                  const total = pdfLodCounts?.total ?? 0;
                                                  const isDisabled = passCount !== null && passCount < total;
                                                  const isSingle = total === 1;
                                                  const badgeText = pdfLodCounts === null
                                                    ? opt.desc
                                                    : isSingle
                                                      ? opt.desc
                                                      : `${passCount}/${total}`;
                                                  const tooltip = isDisabled
                                                    ? (isSingle
                                                        ? 'Section too short for this level'
                                                        : `${total - passCount!} of ${total} sections too short for this level`)
                                                    : undefined;
                                                  return (
                                                    <button
                                                      key={opt.level}
                                                      disabled={isDisabled}
                                                      title={tooltip}
                                                      onClick={async () => {
                                                        if (isDisabled) return;
                                                        const ids = getPdfTier2Ids();
                                                        const targets = ids
                                                          .map((id) => ({
                                                            id,
                                                            text: headings.find((hh) => hh.id === id)?.text || '',
                                                          }))
                                                          .filter((t) => t.text);
                                                        closePdfMenu();
                                                        let cardIds: string[] | null = null;
                                                        if (targets.length >= 2 && onCreateBatchFolder) {
                                                          cardIds = onCreateBatchFolder(
                                                            targets.map((t) => t.text),
                                                            opt.level,
                                                            activeDoc.name,
                                                          );
                                                        }
                                                        await Promise.all(
                                                          targets.map((t, i) =>
                                                            onGenerateCardContent(
                                                              t.id,
                                                              opt.level,
                                                              t.text,
                                                              activeDoc.name,
                                                              cardIds?.[i],
                                                            ),
                                                          ),
                                                        );
                                                      }}
                                                      className={`w-full text-left px-3 py-2 text-[11px] transition-colors flex items-center justify-between gap-3 ${isDisabled ? 'text-zinc-300 dark:text-zinc-600 cursor-not-allowed' : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-800 dark:hover:text-zinc-200'}`}
                                                    >
                                                      <span className="font-medium">{opt.label}</span>
                                                      <span className={`text-[9px] ${isDisabled ? 'text-zinc-300 dark:text-zinc-600' : 'text-zinc-500 dark:text-zinc-400'}`}>{badgeText}</span>
                                                    </button>
                                                  );
                                                })}

                                                {/* Each at Maximum LOD — only for multi-selection, hidden when all 3 LODs fully pass */}
                                                {(() => {
                                                  const total = pdfLodCounts?.total ?? 0;
                                                  if (total < 2) return null;
                                                  if (pdfLodCounts && pdfLodCounts.counts.Executive >= total && pdfLodCounts.counts.Standard >= total && pdfLodCounts.counts.Detailed >= total) return null;
                                                  const ids = getPdfTier2Ids();
                                                  const perHeading = ids.map((id) => {
                                                    const text = headings.find((hh) => hh.id === id)?.text || '';
                                                    const wc = text ? computeMdSectionWordCount(text, activeDoc) : null;
                                                    const maxLod = getMaxDetailLevel(wc) ?? ('DirectContent' as DetailLevel);
                                                    return { id, text, maxLod };
                                                  }).filter((h) => h.text);
                                                  if (perHeading.length < 2) return null;
                                                  return (
                                                    <button
                                                      onClick={async () => {
                                                        closePdfMenu();
                                                        let cardIds: string[] | null = null;
                                                        if (onCreateBatchFolder) {
                                                          cardIds = onCreateBatchFolder(
                                                            perHeading.map((h) => h.text),
                                                            perHeading.map((h) => h.maxLod),
                                                            activeDoc.name,
                                                          );
                                                        }
                                                        await Promise.all(
                                                          perHeading.map((h, i) =>
                                                            onGenerateCardContent(h.id, h.maxLod, h.text, activeDoc.name, cardIds?.[i]),
                                                          ),
                                                        );
                                                      }}
                                                      className="w-full text-left px-3 py-2 text-[11px] text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors flex items-center justify-between gap-3"
                                                    >
                                                      <span className="font-medium text-amber-600">Each at Max LOD</span>
                                                      <span className="text-[9px] text-zinc-500 dark:text-zinc-400">{perHeading.length}/{total}</span>
                                                    </button>
                                                  );
                                                })()}

                                                <div className="h-px bg-zinc-100 dark:bg-zinc-700 my-1" />

                                                {/* Takeaway Card — gated at 100w */}
                                                {(() => {
                                                  const takeawayPassCount = pdfLodCounts?.counts.TakeawayCard ?? null;
                                                  const takeawayTotal = pdfLodCounts?.total ?? 0;
                                                  const takeawayDisabled = takeawayPassCount !== null && takeawayPassCount < takeawayTotal;
                                                  const isSingle = takeawayTotal === 1;
                                                  const takeawayBadge = pdfLodCounts === null
                                                    ? 'Title + Key Takeaways'
                                                    : isSingle
                                                      ? 'Title + Key Takeaways'
                                                      : `${takeawayPassCount}/${takeawayTotal}`;
                                                  const takeawayTooltip = takeawayDisabled
                                                    ? (isSingle
                                                        ? 'Section too short for takeaway card'
                                                        : `${takeawayTotal - takeawayPassCount!} of ${takeawayTotal} sections too short for takeaway card`)
                                                    : undefined;
                                                  return (
                                                    <button
                                                      disabled={takeawayDisabled}
                                                      title={takeawayTooltip}
                                                      onClick={async () => {
                                                        if (takeawayDisabled) return;
                                                        const ids = getPdfTier2Ids();
                                                        const targets = ids
                                                          .map((id) => ({
                                                            id,
                                                            text: headings.find((hh) => hh.id === id)?.text || '',
                                                          }))
                                                          .filter((t) => t.text);
                                                        closePdfMenu();
                                                        let cardIds: string[] | null = null;
                                                        if (targets.length >= 2 && onCreateBatchFolder) {
                                                          cardIds = onCreateBatchFolder(
                                                            targets.map((t) => t.text),
                                                            'TakeawayCard' as DetailLevel,
                                                            activeDoc.name,
                                                          );
                                                        }
                                                        await Promise.all(
                                                          targets.map((t, i) =>
                                                            onGenerateCardContent(t.id, 'TakeawayCard' as DetailLevel, t.text, activeDoc.name, cardIds?.[i]),
                                                          ),
                                                        );
                                                      }}
                                                      className={`w-full text-left px-3 py-2 text-[11px] transition-colors flex items-center justify-between gap-3 ${takeawayDisabled ? 'text-zinc-300 dark:text-zinc-600 cursor-not-allowed' : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-800 dark:hover:text-zinc-200'}`}
                                                    >
                                                      <span className={`font-medium ${takeawayDisabled ? '' : 'text-violet-600'}`}>Takeaway Card</span>
                                                      <span className={`text-[9px] ${takeawayDisabled ? 'text-zinc-300 dark:text-zinc-600' : 'text-zinc-500 dark:text-zinc-400'}`}>{takeawayBadge}</span>
                                                    </button>
                                                  );
                                                })()}

                                                {/* Title Card — no gate */}
                                                <button
                                                  onClick={async () => {
                                                    const ids = getPdfTier2Ids();
                                                    const targets = ids
                                                      .map((id) => ({
                                                        id,
                                                        text: headings.find((hh) => hh.id === id)?.text || '',
                                                      }))
                                                      .filter((t) => t.text);
                                                    closePdfMenu();
                                                    let cardIds: string[] | null = null;
                                                    if (targets.length >= 2 && onCreateBatchFolder) {
                                                      cardIds = onCreateBatchFolder(
                                                        targets.map((t) => t.text),
                                                        'TitleCard' as DetailLevel,
                                                        activeDoc.name,
                                                      );
                                                    }
                                                    await Promise.all(
                                                      targets.map((t, i) =>
                                                        onGenerateCardContent(t.id, 'TitleCard' as DetailLevel, t.text, activeDoc.name, cardIds?.[i]),
                                                      ),
                                                    );
                                                  }}
                                                  className="w-full text-left px-3 py-2 text-[11px] text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors flex items-center justify-between gap-3"
                                                >
                                                  <span className="font-medium text-violet-600">Title Card</span>
                                                  <span className="text-[9px] text-zinc-500 dark:text-zinc-400">Title + Subtitle</span>
                                                </button>
                                              </div>
                                            )}
                                          </div>
                                          <div className="h-px bg-zinc-100 dark:bg-zinc-700 my-1" />
                                        </>
                                      )}

                                      {/* Expand All */}
                                      <button
                                        onClick={() => {
                                          setPdfCollapsed(new Set());
                                          closePdfMenu();
                                        }}
                                        onMouseEnter={() => {
                                          setPdfGenerateSubmenuOpen(false);
                                          setPdfLevelSubmenuOpen(false);
                                        }}
                                        className="w-full text-left px-3 py-2 text-[11px] text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors flex items-center gap-2"
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
                                          className="text-zinc-500 dark:text-zinc-400"
                                        >
                                          <polyline points="6 9 12 15 18 9" />
                                        </svg>
                                        Expand All
                                      </button>

                                      {/* Collapse All */}
                                      <button
                                        onClick={() => {
                                          const allParents = new Set<string>();
                                          headings.forEach((h, i) => {
                                            if (pdfHeadingHasChildren(headings, i)) allParents.add(h.id);
                                          });
                                          setPdfCollapsed(allParents);
                                          closePdfMenu();
                                        }}
                                        onMouseEnter={() => {
                                          setPdfGenerateSubmenuOpen(false);
                                          setPdfLevelSubmenuOpen(false);
                                        }}
                                        className="w-full text-left px-3 py-2 text-[11px] text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors flex items-center gap-2"
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
                                          className="text-zinc-500 dark:text-zinc-400"
                                        >
                                          <polyline points="18 15 12 9 6 15" />
                                        </svg>
                                        Collapse All
                                      </button>

                                      <div className="h-px bg-zinc-100 dark:bg-zinc-700 my-1" />

                                      {/* Select Heading Levels submenu */}
                                      <div className="relative">
                                        <button
                                          onClick={() => setPdfLevelSubmenuOpen((prev) => !prev)}
                                          onMouseEnter={() => {
                                            setPdfLevelSubmenuOpen(true);
                                            setPdfGenerateSubmenuOpen(false);
                                          }}
                                          className="w-full text-left px-3 py-2 text-[11px] text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors flex items-center justify-between"
                                        >
                                          <span className="flex items-center gap-2">
                                            <svg
                                              width="12"
                                              height="12"
                                              viewBox="0 0 24 24"
                                              fill="none"
                                              stroke="currentColor"
                                              strokeWidth="2"
                                              strokeLinecap="round"
                                              strokeLinejoin="round"
                                              className="text-zinc-500 dark:text-zinc-400"
                                            >
                                              <line x1="21" y1="10" x2="7" y2="10" />
                                              <line x1="21" y1="6" x2="3" y2="6" />
                                              <line x1="21" y1="14" x2="3" y2="14" />
                                              <line x1="21" y1="18" x2="7" y2="18" />
                                            </svg>
                                            Select Heading Levels
                                          </span>
                                          <svg
                                            width="12"
                                            height="12"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="2.5"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            className="text-zinc-500 dark:text-zinc-400"
                                          >
                                            <polyline points="9 18 15 12 9 6" />
                                          </svg>
                                        </button>

                                        {pdfLevelSubmenuOpen && (
                                          <div className="absolute left-full top-0 ml-1 min-w-[140px] bg-white dark:bg-zinc-900 rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-700 py-1 animate-in fade-in zoom-in-95 duration-100 whitespace-nowrap">
                                            {(
                                              [
                                                { label: 'H1 Only', tag: 'H1', levels: [1] },
                                                { label: 'H2 Only', tag: 'H2', levels: [2] },
                                                { label: 'H3 Only', tag: 'H3', levels: [3] },
                                                { label: 'H1 + H2', tag: 'H1–2', levels: [1, 2] },
                                                { label: 'H2 + H3', tag: 'H2–3', levels: [2, 3] },
                                                { label: 'All Levels', tag: 'All', levels: [1, 2, 3, 4] },
                                              ] as { label: string; tag: string; levels: number[] }[]
                                            ).map((opt) => (
                                              <button
                                                key={opt.label}
                                                onClick={() => handlePdfSelectLevel(headings, opt.levels)}
                                                className="w-full text-left px-3 py-2 text-[11px] text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors flex items-center gap-2"
                                              >
                                                <span className="w-7 h-4 rounded bg-zinc-100 dark:bg-zinc-800/50 text-[9px] font-bold text-zinc-500 dark:text-zinc-400 flex items-center justify-center">
                                                  {opt.tag}
                                                </span>
                                                {opt.label}
                                              </button>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    </div>,
                                    document.body,
                                  );
                                })()}

                              {/* ── Native PDF document-title context menu ── */}
                              {pdfDocContextMenu &&
                                onGenerateCardContent &&
                                createPortal(
                                  <div
                                    ref={pdfMenuRef}
                                    className="fixed z-[130] min-w-[180px] bg-white dark:bg-zinc-900 rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-700 py-1 animate-in fade-in zoom-in-95 duration-150"
                                    style={{ top: pdfDocContextMenu.y, left: pdfDocContextMenu.x }}
                                    onMouseDown={(e) => e.stopPropagation()}
                                    onContextMenu={(e) => e.preventDefault()}
                                  >
                                    <div className="relative">
                                      <button
                                        onClick={() => setPdfDocGenerateSubmenuOpen((prev) => !prev)}
                                        onMouseEnter={() => setPdfDocGenerateSubmenuOpen(true)}
                                        className="w-full text-left px-3 py-2 text-[11px] font-bold text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors flex items-center justify-between"
                                      >
                                        <span className="flex items-center gap-2">
                                          <svg
                                            width="12"
                                            height="12"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="2"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            className="text-zinc-500"
                                          >
                                            <rect x="3" y="3" width="16" height="16" rx="2" />
                                            <path d="M12 8v8" />
                                            <path d="M8 12h8" />
                                          </svg>
                                          Generate Card for Whole Document
                                        </span>
                                        <svg
                                          width="12"
                                          height="12"
                                          viewBox="0 0 24 24"
                                          fill="none"
                                          stroke="currentColor"
                                          strokeWidth="2.5"
                                          strokeLinecap="round"
                                          strokeLinejoin="round"
                                          className="text-zinc-500"
                                        >
                                          <polyline points="9 18 15 12 9 6" />
                                        </svg>
                                      </button>

                                      {pdfDocGenerateSubmenuOpen && (() => {
                                        const pdfDocEligible = getEligibleDetailLevels(computeMdSectionWordCount('__whole_document__', activeDoc));
                                        return (
                                        <div className="absolute left-full top-0 ml-1 min-w-[200px] bg-white dark:bg-zinc-900 rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-700 py-1 animate-in fade-in zoom-in-95 duration-100">
                                          {/* Snapshot — content as-is, no gate */}
                                          <button
                                            onClick={async () => {
                                              closePdfMenu();
                                              await onGenerateCardContent(
                                                '__whole_document__',
                                                'DirectContent' as DetailLevel,
                                                activeDoc.name,
                                                activeDoc.name,
                                              );
                                            }}
                                            className="w-full text-left px-3 py-2 text-[11px] text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors flex items-center justify-between gap-3"
                                          >
                                            <span className="font-medium text-emerald-600">Snapshot</span>
                                            <span className="text-[9px] text-zinc-500 dark:text-zinc-400">Content as-is</span>
                                          </button>
                                          {[
                                            { level: 'Executive' as DetailLevel, label: 'Executive', desc: '60-80 words' },
                                            { level: 'Standard' as DetailLevel, label: 'Standard', desc: '120-170 words' },
                                            { level: 'Detailed' as DetailLevel, label: 'Detailed', desc: '250-300 words' },
                                          ].map((opt) => {
                                            const isDisabled = pdfDocEligible !== null && !pdfDocEligible.has(opt.level);
                                            return (
                                            <button
                                              key={opt.level}
                                              disabled={isDisabled}
                                              title={isDisabled ? 'Document too short for this level' : undefined}
                                              onClick={async () => {
                                                if (isDisabled) return;
                                                closePdfMenu();
                                                await onGenerateCardContent(
                                                  '__whole_document__',
                                                  opt.level,
                                                  activeDoc.name,
                                                  activeDoc.name,
                                                );
                                              }}
                                              className={`w-full text-left px-3 py-2 text-[11px] transition-colors flex items-center justify-between gap-3 ${isDisabled ? 'text-zinc-300 dark:text-zinc-600 cursor-not-allowed' : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-800 dark:hover:text-zinc-200'}`}
                                            >
                                              <span className="font-medium">{opt.label}</span>
                                              <span className={`text-[9px] ${isDisabled ? 'text-zinc-300 dark:text-zinc-600' : 'text-zinc-500 dark:text-zinc-400'}`}>{opt.desc}</span>
                                            </button>
                                            );
                                          })}
                                          <div className="h-px bg-zinc-100 dark:bg-zinc-700 my-1" />

                                          {/* Takeaway Card — gated at 100w */}
                                          {(() => {
                                            const takeawayDocDisabled = pdfDocEligible !== null && !pdfDocEligible.has('TakeawayCard');
                                            return (
                                              <button
                                                disabled={takeawayDocDisabled}
                                                title={takeawayDocDisabled ? 'Document too short for takeaway card' : undefined}
                                                onClick={async () => {
                                                  if (takeawayDocDisabled) return;
                                                  closePdfMenu();
                                                  await onGenerateCardContent('__whole_document__', 'TakeawayCard' as DetailLevel, activeDoc.name, activeDoc.name);
                                                }}
                                                className={`w-full text-left px-3 py-2 text-[11px] transition-colors flex items-center justify-between gap-3 ${takeawayDocDisabled ? 'text-zinc-300 dark:text-zinc-600 cursor-not-allowed' : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-800 dark:hover:text-zinc-200'}`}
                                              >
                                                <span className={`font-medium ${takeawayDocDisabled ? '' : 'text-violet-600'}`}>Takeaway Card</span>
                                                <span className={`text-[9px] ${takeawayDocDisabled ? 'text-zinc-300 dark:text-zinc-600' : 'text-zinc-500 dark:text-zinc-400'}`}>Title + Key Takeaways</span>
                                              </button>
                                            );
                                          })()}

                                          {/* Title Card — no gate */}
                                          <button
                                            onClick={async () => {
                                              closePdfMenu();
                                              await onGenerateCardContent('__whole_document__', 'TitleCard' as DetailLevel, activeDoc.name, activeDoc.name);
                                            }}
                                            className="w-full text-left px-3 py-2 text-[11px] text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors flex items-center justify-between gap-3"
                                          >
                                            <span className="font-medium text-violet-600">Title Card</span>
                                            <span className="text-[9px] text-zinc-500 dark:text-zinc-400">Title + Subtitle</span>
                                          </button>
                                        </div>
                                        );
                                      })()}
                                    </div>
                                  </div>,
                                  document.body,
                                )}
                            </div>
                          </div>
                        );
                      }

                      // Markdown: existing editor
                      if (!activeDoc?.content) {
                        const isProcessing = activeDoc?.status === 'processing' || activeDoc?.status === 'uploading';
                        const isLostNativePdf =
                          !isProcessing &&
                          activeDoc &&
                          !activeDoc.content &&
                          !activeDoc.sourceType &&
                          (activeDoc.type === 'application/pdf' || activeDoc.name?.toLowerCase().endsWith('.pdf'));
                        return (
                          <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
                            {isProcessing && (
                              <div className="w-8 h-8 border-2 border-zinc-200 dark:border-zinc-700 border-t-zinc-500 dark:border-t-zinc-400 rounded-full animate-spin mb-3" />
                            )}
                            <p className="text-xs text-zinc-500 dark:text-zinc-400 font-light max-w-xs">
                              {isProcessing
                                ? 'Processing document…'
                                : isLostNativePdf
                                  ? 'This PDF needs to be re-uploaded. Remove it and upload again to restore the viewer.'
                                  : 'This document has no editable content.'}
                            </p>
                          </div>
                        );
                      }
                      return (
                        <DocumentEditorModal
                          ref={editorHandleRef}
                          key={activeDoc.id}
                          document={activeDoc}
                          mode="inline"
                          onSave={(newContent) => onSaveDocument(activeDoc.id, newContent)}
                          onClose={() => {}}
                          onGenerateCard={onGenerateCardContent}
                          onCreateBatchFolder={onCreateBatchFolder}
                          generatingSourceIds={generatingSourceIds}
                          onDirtyChange={setEditorDirty}
                        />
                      );
                    })()}
                  </>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
                    <PanelRequirements level="sources" />
                  </div>
                )}

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
                </div>{/* end main content area */}
              </div>{/* end horizontal flex */}
            </div>
            </>,
            document.body,
          )}
      </>
    );
  },
);

export default React.memo(SourcesPanel);
