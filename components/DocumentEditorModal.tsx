import React, { useRef, useCallback, useState, useEffect, forwardRef, useImperativeHandle } from 'react';
import { createPortal } from 'react-dom';
import { UploadedFile, DetailLevel } from '../types';
import { computeMdSectionWordCount, getEligibleDetailLevels, getMaxDetailLevel, computeLodPassCounts, type LodPassCounts } from '../utils/cardUtils';
import { FormatToolbar } from './FormatToolbar';
import { FindReplaceBar } from './FindReplaceBar';
import { useDocumentEditing, EditorHeading } from '../hooks/useDocumentEditing';
import { useDocumentFindReplace } from '../hooks/useDocumentFindReplace';
import { UnsavedChangesDialog } from './Dialogs';
import { useThemeContext } from '../context/ThemeContext';
import { useFocusTrap } from '../hooks/useFocusTrap';

interface DocumentEditorModalProps {
  document: UploadedFile;
  onSave: (newContent: string) => void;
  onClose: () => void;
  /** When 'inline', renders without portal/backdrop/header — embeds directly in parent layout */
  mode?: 'modal' | 'inline';
  /** Called when user clicks "Generate Card Content" with a detail level from the heading context menu */
  onGenerateCard?: (headingId: string, detailLevel: DetailLevel, headingText: string, sourceDocName?: string, existingCardId?: string) => void;
  /** Create a folder with placeholders for batch generation (2+ cards). Returns card IDs in same order as titles. */
  onCreateBatchFolder?: (titles: string[], detailLevel: DetailLevel | DetailLevel[], sourceDocName: string) => string[] | null;
  /** When true, closing always shows a confirmation dialog (used for new custom cards) */
  isCustomCard?: boolean;
  /** Called when user discards a custom card — removes the heading entirely */
  onDiscardCustomCard?: () => void;
  /** Called when user saves a custom card with a chosen name — renames the heading */
  onSaveCustomCard?: (name: string) => void;
  /** Existing heading names for duplicate validation */
  existingCardNames?: string[];
  /** When true, hides the heading sidebar — used when CardsPanel provides its own list */
  hideSidebar?: boolean;
  /** Custom sidebar content that replaces the heading sidebar (rendered inside the main flex area under the toolbar) */
  sidebarContent?: React.ReactNode;
  /** Custom sidebar width in px — used when CardsPanel provides a resizable sidebar */
  sidebarWidth?: number;
  /** Optional divider element rendered between the sidebar and the editor — used for drag-to-resize */
  sidebarDivider?: React.ReactNode;
  /** Lifted spinner state — IDs currently being generated (survives panel collapse) */
  generatingSourceIds?: Set<string>;
  /** Controlled content collapse state (inline mode only) */
  contentCollapsed?: boolean;
  /** Callback when content collapse state changes */
  onContentCollapsedChange?: (collapsed: boolean) => void;
  /** Minimum width for the editor column (inline mode only) */
  contentMinWidth?: number;
  /** Notify parent when editor dirty state changes */
  onDirtyChange?: (isDirty: boolean) => void;
}

/** Imperative handle exposed to parent for unsaved-changes gating */
export interface DocumentEditorHandle {
  isDirty: boolean;
  save: () => void;
  discard: () => void;
  /** Update the first H1 heading text in the live editor (for external renames) */
  updateH1: (newTitle: string) => void;
  /** Swap editor content without unmounting — resets dirty, undo/redo, headings */
  resetContent: (markdown: string) => void;
}

// ── Context Menu State ──
interface ContextMenuState {
  x: number;
  y: number;
  headingId: string;
}

const DocumentEditorModal = forwardRef<DocumentEditorHandle, DocumentEditorModalProps>(
  (
    {
      document: doc,
      onSave,
      onClose,
      mode = 'modal',
      onGenerateCard,
      onCreateBatchFolder,
      isCustomCard,
      onDiscardCustomCard,
      onSaveCustomCard,
      existingCardNames,
      hideSidebar,
      sidebarContent,
      sidebarWidth,
      sidebarDivider,
      generatingSourceIds,
      contentCollapsed: contentCollapsedProp,
      onContentCollapsedChange,
      contentMinWidth,
      onDirtyChange: onEditorDirtyChange,
    },
    handleRef,
  ) => {
    const { darkMode } = useThemeContext();
    const isInline = mode === 'inline';
    const focusTrapRef = useFocusTrap<HTMLDivElement>({ active: !isInline });
    const editorRef = useRef<HTMLDivElement>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const editorObserverRef = useRef<MutationObserver | null>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const levelSubmenuRef = useRef<HTMLDivElement>(null);
    const generateSubmenuRef = useRef<HTMLDivElement>(null);
    const tocRef = useRef<HTMLElement>(null);

    // ── Sidebar state ──
    const [sidebarOpen, setSidebarOpen] = useState(true);

    // ── Content editor collapse state (inline mode only) ──
    const [contentCollapsedInternal, setContentCollapsedInternal] = useState(false);
    const contentCollapsed = contentCollapsedProp ?? contentCollapsedInternal;
    const setContentCollapsed = onContentCollapsedChange ?? setContentCollapsedInternal;

    // ── TOC sidebar resize (default sidebar only) ──
    // null = use CSS 20% (1:4 split); number = user-resized pixel width
    const TOC_MIN_WIDTH = 140;
    const TOC_MAX_WIDTH = 480;
    const [tocWidth, setTocWidth] = useState<number | null>(null);
    const tocDragging = useRef(false);
    const tocDragStartX = useRef(0);
    const tocDragStartWidth = useRef(0);

    // Reset width when sidebar opens (collapse → expand resets to default)
    const prevSidebarOpen = useRef(sidebarOpen);
    useEffect(() => {
      if (!prevSidebarOpen.current && sidebarOpen) {
        setTocWidth(null);
      }
      prevSidebarOpen.current = sidebarOpen;
    }, [sidebarOpen]);

    const handleTocDividerDown = useCallback(
      (e: React.PointerEvent) => {
        e.preventDefault();
        tocDragging.current = true;
        tocDragStartX.current = e.clientX;
        // When tocWidth is null (CSS 20%), read the actual rendered width
        tocDragStartWidth.current = tocWidth ?? (tocRef.current?.getBoundingClientRect().width ?? 220);
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      },
      [tocWidth],
    );

    const handleTocDividerMove = useCallback((e: React.PointerEvent) => {
      if (!tocDragging.current) return;
      const delta = e.clientX - tocDragStartX.current;
      setTocWidth(Math.min(TOC_MAX_WIDTH, Math.max(TOC_MIN_WIDTH, tocDragStartWidth.current + delta)));
    }, []);

    const handleTocDividerUp = useCallback((e: React.PointerEvent) => {
      if (!tocDragging.current) return;
      tocDragging.current = false;
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    }, []);
    const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
    const [levelSubmenuOpen, setLevelSubmenuOpen] = useState(false);
    const [generateContentSubmenuOpen, setGenerateContentSubmenuOpen] = useState(false);
    const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null);
    const generatingHeadingIds = generatingSourceIds ?? new Set<string>();
    const generatingDocCard = generatingSourceIds?.has('__whole_document__') ?? false;
    const [docContextMenu, setDocContextMenu] = useState<{ x: number; y: number } | null>(null);
    const [docGenerateSubmenuOpen, setDocGenerateSubmenuOpen] = useState(false);
    const [docTreeCollapsed, setDocTreeCollapsed] = useState(false);

    // ── TOC drag-and-drop reordering (pointer-based) ──
    const tocListRef = useRef<HTMLDivElement>(null);
    const tocDragState = useRef<{
      active: boolean;
      sourceIdx: number;
      currentIdx: number;
      startY: number;
      offsetY: number;
      cardHeight: number;
      cardRects: { top: number; height: number }[];
    } | null>(null);
    const [tocDragSourceIdx, setTocDragSourceIdx] = useState<number | null>(null);
    const [tocDragOverIdx, setTocDragOverIdx] = useState<number | null>(null);
    const [tocDragGhostStyle, setTocDragGhostStyle] = useState<React.CSSProperties | null>(null);
    const tocDragGhostText = useRef('');

    // Tracks last clicked heading for Shift+Click range selection
    const lastClickedHeadingRef = useRef<string | null>(null);

    // Find/replace hook (shares editorObserverRef with editing hook)
    const findReplace = useDocumentFindReplace(editorRef, scrollContainerRef, editorObserverRef);

    // Editing hook (populates editorObserverRef, uses find/replace callbacks)
    const editing = useDocumentEditing({
      editorRef,
      editorObserverRef,
      initialContent: doc.content || '',
      onSave,
      closeFindBar: findReplace.closeFindBar,
      clearFindHighlights: findReplace.clearFindHighlights,
    });

    const { headings } = editing;

    // Notify parent when editor dirty state changes
    useEffect(() => {
      onEditorDirtyChange?.(editing.isDirty);
    }, [editing.isDirty, onEditorDirtyChange]);

    // ── TOC drag handler callbacks (need headings + editing) ──
    const handleTocPointerDown = useCallback((e: React.PointerEvent, headingIndex: number, text: string) => {
      if (e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey) return;

      const el = e.currentTarget as HTMLElement;
      const rect = el.getBoundingClientRect();

      const tocEls = tocListRef.current?.querySelectorAll('[data-toc-idx]');
      const cardRects: { top: number; height: number }[] = [];
      tocEls?.forEach((cel) => {
        const r = (cel as HTMLElement).getBoundingClientRect();
        cardRects.push({ top: r.top, height: r.height });
      });

      tocDragState.current = {
        active: false,
        sourceIdx: headingIndex,
        currentIdx: headingIndex,
        startY: e.clientY,
        offsetY: e.clientY - rect.top,
        cardHeight: rect.height,
        cardRects,
      };
      tocDragGhostText.current = text;

      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    }, []);

    const handleTocPointerMove = useCallback((e: React.PointerEvent) => {
      const ds = tocDragState.current;
      if (!ds) return;

      const dy = Math.abs(e.clientY - ds.startY);
      if (!ds.active) {
        if (dy < 4) return;
        ds.active = true;
        setTocDragSourceIdx(ds.sourceIdx);
        setTocDragOverIdx(ds.sourceIdx);
      }

      const listRect = tocListRef.current?.getBoundingClientRect();
      if (listRect) {
        setTocDragGhostStyle({
          position: 'absolute',
          left: 0,
          right: 0,
          top: e.clientY - listRect.top - ds.offsetY,
          height: ds.cardHeight,
          zIndex: 50,
          pointerEvents: 'none',
          opacity: 0.9,
        });
      }

      const rects = ds.cardRects;
      const tocEls = tocListRef.current?.querySelectorAll('[data-toc-idx]');
      const visibleIndices: number[] = [];
      tocEls?.forEach((el) => {
        visibleIndices.push(parseInt((el as HTMLElement).dataset.tocIdx || '0'));
      });

      const visibleSourceSlot = visibleIndices.indexOf(ds.sourceIdx);
      let targetSlot = visibleSourceSlot;

      for (let i = 0; i < rects.length; i++) {
        if (i === visibleSourceSlot) continue;
        const mid = rects[i].top + rects[i].height / 2;
        if (visibleSourceSlot < i) {
          if (e.clientY > mid) targetSlot = i;
        } else {
          if (e.clientY < mid) {
            targetSlot = i;
            break;
          }
        }
      }

      const targetHeadingIdx = visibleIndices[targetSlot] ?? ds.sourceIdx;
      if (targetHeadingIdx !== ds.currentIdx) {
        ds.currentIdx = targetHeadingIdx;
        setTocDragOverIdx(targetHeadingIdx);
      }
    }, []);

    const handleTocPointerUp = useCallback(
      (e: React.PointerEvent) => {
        const ds = tocDragState.current;
        if (!ds) return;

        (e.target as HTMLElement).releasePointerCapture(e.pointerId);

        if (ds.active && ds.sourceIdx !== ds.currentIdx) {
          editing.reorderHeading(ds.sourceIdx, ds.currentIdx);
        }

        tocDragState.current = null;
        setTocDragSourceIdx(null);
        setTocDragOverIdx(null);
        setTocDragGhostStyle(null);
      },
      [editing],
    );

    const getTocGapStyle = useCallback(
      (headingIndex: number): React.CSSProperties => {
        if (tocDragSourceIdx === null || tocDragOverIdx === null || tocDragSourceIdx === tocDragOverIdx) return {};

        const sourceLevel = headings[tocDragSourceIdx]?.level ?? 1;
        let sourceSpanEnd = tocDragSourceIdx + 1;
        while (sourceSpanEnd < headings.length && headings[sourceSpanEnd].level > sourceLevel) {
          sourceSpanEnd++;
        }
        const sourceSpanCount = sourceSpanEnd - tocDragSourceIdx;
        const gap = (tocDragState.current?.cardHeight || 28) * sourceSpanCount;

        if (headingIndex >= tocDragSourceIdx && headingIndex < sourceSpanEnd) return {};

        if (tocDragSourceIdx < tocDragOverIdx) {
          const targetLevel = headings[tocDragOverIdx]?.level ?? 1;
          let targetSpanEnd = tocDragOverIdx + 1;
          while (targetSpanEnd < headings.length && headings[targetSpanEnd].level > targetLevel) {
            targetSpanEnd++;
          }
          if (headingIndex >= sourceSpanEnd && headingIndex < targetSpanEnd) {
            return { transform: `translateY(-${gap}px)`, transition: 'transform 150ms ease' };
          }
        } else {
          if (headingIndex >= tocDragOverIdx && headingIndex < tocDragSourceIdx) {
            return { transform: `translateY(${gap}px)`, transition: 'transform 150ms ease' };
          }
        }
        return { transition: 'transform 150ms ease' };
      },
      [tocDragSourceIdx, tocDragOverIdx, headings],
    );

    // ── Expose imperative handle for parent unsaved-changes gating ──
    useImperativeHandle(
      handleRef,
      () => ({
        get isDirty() {
          return editing.isDirty;
        },
        save: () => editing.saveEdits(),
        discard: () => editing.discardEdits(),
        updateH1: (newTitle: string) => editing.updateH1(newTitle),
        resetContent: (markdown: string) => editing.resetContent(markdown),
      }),
      // eslint-disable-next-line react-hooks/exhaustive-deps -- accessing stable methods via editing.method; the object ref changes but the methods are stable
      [editing.isDirty, editing.saveEdits, editing.discardEdits, editing.updateH1, editing.resetContent],
    );

    // ── Close context menu on click outside or Escape ──
    useEffect(() => {
      if (!contextMenu) return;
      const handleClick = (e: MouseEvent) => {
        if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
          setContextMenu(null);
          setLevelSubmenuOpen(false);
          setGenerateContentSubmenuOpen(false);
        }
      };
      const handleKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          setContextMenu(null);
          setLevelSubmenuOpen(false);
          setGenerateContentSubmenuOpen(false);
        }
      };
      document.addEventListener('mousedown', handleClick);
      document.addEventListener('keydown', handleKey);
      return () => {
        document.removeEventListener('mousedown', handleClick);
        document.removeEventListener('keydown', handleKey);
      };
    }, [contextMenu]);

    // ── Adjust context menu position to stay within viewport ──
    useEffect(() => {
      if (!contextMenu || !menuRef.current) return;
      const menu = menuRef.current;
      const rect = menu.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let { x, y } = contextMenu;
      if (rect.bottom > vh) y = Math.max(4, vh - rect.height - 4);
      if (rect.right > vw) x = Math.max(4, vw - rect.width - 4);
      if (y !== contextMenu.y || x !== contextMenu.x) {
        menu.style.top = `${y}px`;
        menu.style.left = `${x}px`;
      }
    }, [contextMenu]);

    // ── Adjust submenu positions to stay within viewport ──
    useEffect(() => {
      const refs = [levelSubmenuRef, generateSubmenuRef];
      for (const ref of refs) {
        const el = ref.current;
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        const vh = window.innerHeight;
        const vw = window.innerWidth;
        // Flip left if overflows right
        if (rect.right > vw) {
          el.style.left = 'auto';
          el.style.right = '100%';
          el.style.marginLeft = '0';
          el.style.marginRight = '4px';
        }
        // Shift up if overflows bottom
        if (rect.bottom > vh) {
          const overflow = rect.bottom - vh + 4;
          el.style.top = `${-overflow}px`;
        }
      }
    }, [levelSubmenuOpen, generateContentSubmenuOpen]);

    // ── Deselect headings when clicking outside the TOC sidebar ──
    const hasAnySelected = headings.some((h) => h.selected);
    useEffect(() => {
      if (!hasAnySelected) return;
      const handler = (e: MouseEvent) => {
        const target = e.target as Node;
        // Don't deselect if clicking inside TOC sidebar or inside context menu
        if (tocRef.current?.contains(target)) return;
        if (menuRef.current?.contains(target)) return;
        editing.deselectAll();
      };
      document.addEventListener('mousedown', handler);
      return () => document.removeEventListener('mousedown', handler);
    }, [hasAnySelected, editing]);

    // ── Sidebar helpers ──
    const closeMenu = useCallback(() => {
      setContextMenu(null);
      setLevelSubmenuOpen(false);
      setGenerateContentSubmenuOpen(false);
    }, []);

    const toggleCollapse = useCallback((id: string) => {
      setCollapsed((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    }, []);

    const hasChildren = (index: number): boolean => {
      if (index >= headings.length - 1) return false;
      return headings[index + 1].level > headings[index].level;
    };

    const isHidden = (index: number): boolean => {
      const heading = headings[index];
      for (let i = index - 1; i >= 0; i--) {
        if (headings[i].level < heading.level) {
          if (collapsed.has(headings[i].id)) return true;
        }
      }
      return false;
    };

    const expandAll = () => {
      setCollapsed(new Set());
      closeMenu();
    };
    const collapseAll = () => {
      const all = new Set<string>();
      headings.forEach((h, i) => {
        if (hasChildren(i)) all.add(h.id);
      });
      setCollapsed(all);
      closeMenu();
    };

    // Tier 1: left-click — set active heading, scroll, clear tier 2
    // Ctrl/Cmd+Click: toggle individual heading in/out of tier 2 selection
    // Shift+Click: range select from last clicked heading to current
    const handleHeadingClick = (e: React.MouseEvent, id: string) => {
      if (e.ctrlKey || e.metaKey) {
        // Ctrl+Click: toggle this heading's tier 2 selection
        editing.toggleSelection(id);
        setActiveHeadingId(null);
        lastClickedHeadingRef.current = id;
        return;
      }
      if (e.shiftKey && lastClickedHeadingRef.current) {
        // Shift+Click: select range from anchor to current
        editing.deselectAll();
        editing.selectRange(lastClickedHeadingRef.current, id);
        setActiveHeadingId(null);
        return;
      }
      // Normal click: deselect tier 2, set active, scroll
      editing.deselectAll();
      setActiveHeadingId(id);
      editing.scrollToHeading(id);
      lastClickedHeadingRef.current = id;
    };

    // Tier 2: right-click — select for batch operations, no scroll, no tier 1 change
    const handleContextMenu = (e: React.MouseEvent, headingId: string) => {
      e.preventDefault();
      e.stopPropagation();
      const heading = headings.find((h) => h.id === headingId);
      // If right-clicked heading isn't already tier 2 selected, clear tier 2 and select just this one
      if (!heading?.selected) {
        editing.deselectAll();
        editing.toggleSelection(headingId);
      }
      setLevelSubmenuOpen(false);
      setGenerateContentSubmenuOpen(false);
      setContextMenu({ x: e.clientX, y: e.clientY, headingId });
    };

    // ── Context heading info ──
    const getContextHeading = (): EditorHeading | null => {
      if (!contextMenu) return null;
      return headings.find((h) => h.id === contextMenu.headingId) ?? null;
    };
    const contextHeading = getContextHeading();

    // ── Select Heading and Content (Tier 1 + Tier 2 + visual highlight) ──
    const handleSelectHeadingAndContent = () => {
      if (contextMenu) {
        editing.deselectAll();
        setActiveHeadingId(contextMenu.headingId);
        editing.scrollToHeading(contextMenu.headingId);
        editing.selectHeadingContent(contextMenu.headingId);
        editing.selectHeadingAndDescendants(contextMenu.headingId);
      }
      closeMenu();
    };

    // ── Select by Level (replaces existing tier 2 selection, toggles off if same levels re-selected) ──
    const handleSelectLevel = (levels: number[]) => {
      const levelSet = new Set(levels);
      const currentlySelected = headings.filter((h) => h.selected);
      const allAtTheseLevels = currentlySelected.length > 0 && currentlySelected.every((h) => levelSet.has(h.level));
      const targeted = headings.filter((h) => levelSet.has(h.level));
      const allTargetedSelected = targeted.length > 0 && targeted.every((h) => h.selected);
      if (allAtTheseLevels && allTargetedSelected) {
        editing.deselectAll();
      } else {
        editing.deselectAll();
        editing.selectByLevels(levels);
      }
      closeMenu();
    };

    // ── Tier 2 selection IDs — used by Promote / Demote / Generate ──
    const getTier2Ids = (): string[] => {
      const selectedIds = headings.filter((h) => h.selected).map((h) => h.id);
      if (selectedIds.length > 0) return selectedIds;
      // Fallback: if no tier 2 selection, use the context menu target
      if (contextMenu) return [contextMenu.headingId];
      return [];
    };

    const getAffectedLevels = (): { min: number; max: number } => {
      if (!contextMenu) return { min: 1, max: 6 };
      const ids = getTier2Ids();
      let min = 6,
        max = 1;
      for (const id of ids) {
        const idx = headings.findIndex((h) => h.id === id);
        if (idx === -1) continue;
        const parentLevel = headings[idx].level;
        min = Math.min(min, parentLevel);
        max = Math.max(max, parentLevel);
        // Include descendants
        for (let i = idx + 1; i < headings.length; i++) {
          if (headings[i].level <= parentLevel) break;
          min = Math.min(min, headings[i].level);
          max = Math.max(max, headings[i].level);
        }
      }
      return { min, max };
    };
    const affectedLevels = contextMenu ? getAffectedLevels() : { min: 1, max: 6 };
    const canPromote = affectedLevels.min > 1;
    const canDemote = affectedLevels.max < 6;

    const handlePromote = () => {
      if (!contextMenu) return;
      const ids = getTier2Ids();
      // For each id, promote it + its children
      for (const id of ids) {
        const idx = headings.findIndex((h) => h.id === id);
        if (idx === -1) continue;
        editing.changeHeadingLevel(id, 'promote');
        const parentLevel = headings[idx].level;
        for (let i = idx + 1; i < headings.length; i++) {
          if (headings[i].level <= parentLevel) break;
          // Only promote children if they aren't already in the ids list (avoid double-promote)
          if (!ids.includes(headings[i].id)) {
            editing.changeHeadingLevel(headings[i].id, 'promote');
          }
        }
      }
      closeMenu();
    };

    const handleDemote = () => {
      if (!contextMenu) return;
      const ids = getTier2Ids();
      for (const id of ids) {
        const idx = headings.findIndex((h) => h.id === id);
        if (idx === -1) continue;
        editing.changeHeadingLevel(id, 'demote');
        const parentLevel = headings[idx].level;
        for (let i = idx + 1; i < headings.length; i++) {
          if (headings[i].level <= parentLevel) break;
          if (!ids.includes(headings[i].id)) {
            editing.changeHeadingLevel(headings[i].id, 'demote');
          }
        }
      }
      closeMenu();
    };

    // ── Save & close / Discard & close ──
    // The only way to exit the editor is via the toolbar Save or Discard buttons.
    // No X button or Escape key — forces an explicit save-or-discard decision.
    const _handleSaveAndClose = useCallback(() => {
      editing.saveEdits();
      onClose();
      // eslint-disable-next-line react-hooks/exhaustive-deps -- accessing stable methods via editing.method
    }, [editing.saveEdits, onClose]);

    // Discard: if dirty, show in-app confirmation dialog; if clean, close immediately
    const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);

    const handleDiscardAndClose = useCallback(() => {
      if (isCustomCard || editing.isDirty) {
        setShowUnsavedDialog(true);
        return;
      }
      onClose();
    }, [editing.isDirty, onClose, isCustomCard]);

    const confirmDiscard = useCallback(() => {
      setShowUnsavedDialog(false);
      editing.discardEdits();
      if (isCustomCard && onDiscardCustomCard) {
        onDiscardCustomCard();
      }
      onClose();
      // eslint-disable-next-line react-hooks/exhaustive-deps -- accessing stable methods via editing.method
    }, [editing.discardEdits, onClose, isCustomCard, onDiscardCustomCard]);

    const confirmSave = useCallback(() => {
      setShowUnsavedDialog(false);
      editing.saveEdits();
      onClose();
      // eslint-disable-next-line react-hooks/exhaustive-deps -- accessing stable methods via editing.method
    }, [editing.saveEdits, onClose]);

    // Wrap keydown to intercept Ctrl+S so it triggers save
    const handleEditorKeyDown = useCallback(
      (e: React.KeyboardEvent) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
          e.preventDefault();
          editing.saveEdits();
          return;
        }
        editing.handleKeyDown(e);
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps -- accessing stable methods via editing.method
      [editing.handleKeyDown, editing.saveEdits],
    );

    // ── Heading styling (matches StructureView) ──
    const indentClasses = ['ml-0', 'ml-4', 'ml-8', 'ml-12', 'ml-16', 'ml-20'];
    const textStyles = [
      'text-[12px] font-bold text-zinc-800 dark:text-zinc-200',
      'text-[11px] font-semibold text-zinc-600 dark:text-zinc-400',
      'text-[11px] font-medium text-zinc-500 dark:text-zinc-400',
      'text-[10px] font-normal text-zinc-500 dark:text-zinc-400',
      'text-[10px] font-normal text-zinc-500 dark:text-zinc-400',
      'text-[10px] font-normal text-zinc-500 dark:text-zinc-400',
    ];

    // ── Toolbar + Find bar (rendered inside editor column, not full width) ──
    const toolbarEl = (
      <>
        {/* Format Toolbar */}
        <div className="shrink-0 h-[40px] border-b border-zinc-200 dark:border-zinc-600">
          <FormatToolbar
            activeFormats={editing.activeFormats}
            executeCommand={editing.executeCommand}
            insertTable={editing.insertTable}
            showFind={findReplace.showFind}
            setShowFind={findReplace.setShowFind}
            findInputRef={findReplace.findInputRef}
            isDirty={editing.isDirty}
            onSave={() => editing.saveEdits()}
            hasContent={true}
          />
        </div>

        {/* Find/Replace Bar */}
        {findReplace.showFind && (
          <div className="shrink-0 border-b border-zinc-100 dark:border-zinc-600">
            <FindReplaceBar
              findInputRef={findReplace.findInputRef}
              findQuery={findReplace.findQuery}
              setFindQuery={findReplace.setFindQuery}
              replaceQuery={findReplace.replaceQuery}
              setReplaceQuery={findReplace.setReplaceQuery}
              findMatchCount={findReplace.findMatchCount}
              findActiveIndex={findReplace.findActiveIndex}
              setFindActiveIndex={findReplace.setFindActiveIndex}
              findMatchCase={findReplace.findMatchCase}
              setFindMatchCase={findReplace.setFindMatchCase}
              findNext={findReplace.findNext}
              findPrev={findReplace.findPrev}
              closeFindBar={findReplace.closeFindBar}
              handleReplace={findReplace.handleReplace}
              handleReplaceAll={findReplace.handleReplaceAll}
            />
          </div>
        )}
      </>
    );

    // ── Shared editor body (used in both modal and inline modes) ──
    const editorBody = (
      <>
        {/* Main content: Sidebar + Editor */}
        <div className="flex-1 flex overflow-hidden">
          {/* Sidebar: custom content, default headings, or hidden */}
          {sidebarContent ? (
            <>
              <aside
                className="shrink-0 overflow-y-auto bg-white dark:bg-zinc-900"
                style={{ width: sidebarWidth ?? 220 }}
              >
                <div className="shrink-0 sticky top-0 z-10 bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-600">
                  <div className="shrink-0 flex flex-row items-center pt-2 pb-1">
                    <div className="w-8 shrink-0 flex items-center justify-center">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-zinc-500 dark:text-zinc-400">
                        <line x1="8" y1="6" x2="21" y2="6" />
                        <line x1="8" y1="12" x2="21" y2="12" />
                        <line x1="8" y1="18" x2="21" y2="18" />
                        <line x1="3" y1="6" x2="3.01" y2="6" />
                        <line x1="3" y1="12" x2="3.01" y2="12" />
                        <line x1="3" y1="18" x2="3.01" y2="18" />
                      </svg>
                    </div>
                    <span className="text-[13px] font-bold uppercase tracking-wider text-zinc-800 dark:text-zinc-200">Cards List</span>
                  </div>
                </div>
                {sidebarContent}
              </aside>
              {sidebarDivider}
            </>
          ) : !hideSidebar ? (
            sidebarOpen ? (
            <aside
              ref={tocRef}
              className="shrink-0 overflow-y-auto bg-[#fafafa] dark:bg-zinc-800/50 transition-all duration-200"
              style={{ width: tocWidth ?? '25%' }}
            >
              <div
                className="sticky top-0 z-10 border-b border-zinc-200 dark:border-zinc-600"
                style={{ backgroundColor: darkMode ? 'rgb(40,52,62)' : 'rgb(217,232,241)' }}
              >
                <button
                  onClick={() => setSidebarOpen(false)}
                  className="flex flex-row items-center pt-2 pb-1 hover:opacity-80 transition-colors cursor-pointer"
                  title="Collapse sidebar"
                >
                  <div className="w-8 shrink-0 flex items-center justify-center">
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="shrink-0 text-zinc-500 dark:text-zinc-400"
                    >
                      <rect width="18" height="18" x="3" y="3" rx="2" />
                      <path d="M9 3v18" />
                    </svg>
                  </div>
                  <span className="text-[13px] font-bold uppercase tracking-wider text-zinc-800 dark:text-zinc-200 whitespace-nowrap">
                    Table of Content
                  </span>
                </button>
              </div>
              {true && (
                <div className="px-2 pt-1">
                  {/* Document root node — parent of all headings */}
                  <div
                    className={`group flex items-center gap-1 px-1 py-1.5 cursor-pointer select-none transition-all duration-150 border border-transparent ${
                      activeHeadingId === '__document__' ? 'sidebar-node-active' : 'hover:border-blue-300'
                    }`}
                    onClick={() => {
                      editing.deselectAll();
                      setActiveHeadingId('__document__');
                    }}
                  >
                    {/* Collapse chevron */}
                    {headings.length > 0 ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setDocTreeCollapsed((prev) => !prev);
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
                          className={`transition-transform duration-200 ${docTreeCollapsed ? '' : 'rotate-90'}`}
                        >
                          <polyline points="9 18 15 12 9 6" />
                        </svg>
                      </button>
                    ) : (
                      <span className="flex-shrink-0 w-4 h-4" />
                    )}
                    {/* Doc icon */}
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
                          activeHeadingId === '__document__'
                            ? '#2a9fd4'
                            : darkMode
                              ? 'rgb(140,170,200)'
                              : 'rgb(50,90,130)',
                      }}
                    >
                      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
                      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
                    </svg>
                    {generatingDocCard && (
                      <div className="shrink-0 w-3 h-3 border-[1.5px] border-zinc-300 border-t-blue-600 rounded-full animate-spin" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p
                        className="text-[13px] font-black truncate"
                        style={{
                          color:
                            activeHeadingId === '__document__'
                              ? '#2a9fd4'
                              : darkMode
                                ? 'rgb(140,170,200)'
                                : 'rgb(50,90,130)',
                        }}
                        title={doc.name}
                      >
                        {doc.name}
                      </p>
                      {doc.originalFormat && (
                        <span className="text-[9px] text-zinc-500 dark:text-zinc-400 font-normal italic block">
                          {doc.originalFormat === 'md'
                            ? 'Direct Markdown'
                            : doc.originalFormat === 'pdf'
                              ? 'Converted from PDF'
                              : 'Converted from Word'}
                        </span>
                      )}
                    </div>
                    {/* Kebab menu */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        closeMenu();
                        setDocGenerateSubmenuOpen(false);
                        setDocContextMenu({ x: e.clientX, y: e.clientY });
                      }}
                      className="shrink-0 w-4 h-4 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 transition-opacity"
                      style={{
                        color:
                          activeHeadingId === '__document__'
                            ? 'rgba(42,159,212,0.6)'
                            : darkMode
                              ? 'rgba(160,180,200,0.5)'
                              : 'rgba(100,116,139,0.5)',
                      }}
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
              )}
              {sidebarOpen && !docTreeCollapsed && (
                <div
                  className="px-2 pb-20 relative ml-4 border-l"
                  role="tree"
                  aria-label="Document outline"
                  style={{ borderColor: darkMode ? 'rgba(42,159,212,0.3)' : 'rgba(42,159,212,0.2)' }}
                  ref={tocListRef}
                >
                  {headings.map((heading, index) => {
                    if (isHidden(index)) return null;
                    const level = Math.min(heading.level, 6);
                    const isActive = activeHeadingId === heading.id;
                    const isSelected = heading.selected;
                    const isCollapsible = hasChildren(index);
                    const isCollapsed = collapsed.has(heading.id);
                    const indent = indentClasses[level - 1] || 'ml-0';
                    const textStyle = textStyles[level - 1] || textStyles[5];

                    // Drag state: check if this heading is part of the dragged source span
                    const isDragSource = (() => {
                      if (tocDragSourceIdx === null) return false;
                      const srcLevel = headings[tocDragSourceIdx]?.level ?? 1;
                      if (index === tocDragSourceIdx) return true;
                      if (index > tocDragSourceIdx && heading.level > srcLevel) {
                        // Check it's a descendant — no heading of same/lower level between source and here
                        for (let i = tocDragSourceIdx + 1; i < index; i++) {
                          if (headings[i].level <= srcLevel) return false;
                        }
                        return true;
                      }
                      return false;
                    })();

                    return (
                      <div
                        key={heading.id}
                        role="treeitem"
                        aria-expanded={isCollapsible ? !isCollapsed : undefined}
                        data-toc-idx={index}
                        onPointerDown={(e) => handleTocPointerDown(e, index, heading.text)}
                        onPointerMove={handleTocPointerMove}
                        onPointerUp={handleTocPointerUp}
                        style={{
                          ...getTocGapStyle(index),
                          ...(isDragSource ? { opacity: 0, pointerEvents: 'none' } : {}),
                        }}
                      >
                        {level === 1 && index > 0 && !isDragSource && (
                          <div className="h-px bg-zinc-200 dark:bg-zinc-700 mb-1 mt-2 ml-1" />
                        )}
                        <div
                          onClick={(e) => {
                            if (tocDragState.current?.active) return;
                            handleHeadingClick(e, heading.id);
                          }}
                          className={`
                      ${indent} group relative flex items-center space-x-1 py-1 px-1 transition-all duration-300 cursor-pointer border border-transparent
                      ${isActive ? 'sidebar-node-active' : 'hover:border-blue-300'}
                      ${isSelected ? 'bg-[rgba(160,200,220,0.2)]' : ''}
                    `}
                        >
                          {isCollapsible ? (
                            <div
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleCollapse(heading.id);
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
                                className={`transition-transform duration-200 ${isCollapsed ? '' : 'rotate-90'}`}
                              >
                                <polyline points="9 18 15 12 9 6" />
                              </svg>
                            </div>
                          ) : (
                            <div className="flex-shrink-0 w-4 h-4" />
                          )}

                          {generatingHeadingIds.has(heading.id) ? (
                            <div className="flex-shrink-0 w-3.5 h-3.5 border-2 border-zinc-300 border-t-zinc-600 rounded-full animate-spin" />
                          ) : null}

                          <span
                            className={`${textStyle} transition-all select-none truncate pr-2 ml-0.5 flex-1 min-w-0`}
                            style={{
                              opacity: isActive || isSelected || generatingHeadingIds.has(heading.id) ? 1 : 0.7,
                            }}
                          >
                            {heading.text}
                          </span>

                          {/* Word count badge */}
                          {(() => {
                            const wc = computeMdSectionWordCount(heading.text, doc);
                            return wc != null && wc > 0 ? (
                              <span className="text-[9px] text-zinc-400 dark:text-zinc-500 shrink-0 tabular-nums">{wc}w</span>
                            ) : null;
                          })()}

                          {/* Kebab menu button */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleContextMenu(e, heading.id);
                            }}
                            className="shrink-0 w-4 h-4 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 transition-opacity"
                            style={{
                              color: isActive
                                ? 'rgba(42,159,212,0.6)'
                                : darkMode
                                  ? 'rgba(160,180,200,0.4)'
                                  : 'rgba(100,116,139,0.4)',
                            }}
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
                  })}

                  {/* TOC drag ghost */}
                  {tocDragGhostStyle && (
                    <div
                      className="flex items-center gap-1 px-2 py-1 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-600 shadow-lg dark:shadow-black/30"
                      style={tocDragGhostStyle}
                    >
                      <p className="text-[11px] font-semibold text-zinc-800 dark:text-zinc-200 truncate">
                        {tocDragGhostText.current}
                      </p>
                    </div>
                  )}

                  {headings.length === 0 && (
                    <p className="text-[10px] text-zinc-500 dark:text-zinc-400 px-2 py-4 text-center">No headings</p>
                  )}
                </div>
              )}
            </aside>
            ) : (
            /* TOC collapsed strip */
            <div
              className="shrink-0 w-10 flex flex-col"
              style={{ backgroundColor: darkMode ? 'rgb(40,52,62)' : 'rgb(217,232,241)' }}
            >
              <div
                className="shrink-0 sticky top-0 z-10"
                style={{ backgroundColor: darkMode ? 'rgb(40,52,62)' : 'rgb(217,232,241)' }}
              >
                <button
                  onClick={() => setSidebarOpen(true)}
                  className="flex flex-col items-center gap-1.5 py-3 px-1 w-full hover:opacity-80 transition-colors cursor-pointer"
                  title="Expand sidebar"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-zinc-500 dark:text-zinc-400">
                    <rect width="18" height="18" x="3" y="3" rx="2" />
                    <path d="M9 3v18" />
                  </svg>
                  <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-800 dark:text-zinc-200" style={{ writingMode: 'vertical-rl', textOrientation: 'mixed', transform: 'rotate(180deg)' }}>
                    Table of Content
                  </span>
                </button>
              </div>
            </div>
            )
          ) : null}

          {/* TOC sidebar resize divider (only when default TOC sidebar is open) */}
          {!sidebarContent && !hideSidebar && sidebarOpen && (
            <div
              className="shrink-0 w-[5px] cursor-col-resize group relative select-none flex items-center justify-center"
              onPointerDown={handleTocDividerDown}
              onPointerMove={handleTocDividerMove}
              onPointerUp={handleTocDividerUp}
            >
              <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-zinc-200 dark:bg-zinc-600 group-hover:bg-zinc-400 dark:group-hover:bg-zinc-500 transition-colors" />
              <div className="w-[5px] h-6 rounded-full bg-zinc-300 dark:bg-zinc-500 group-hover:bg-zinc-400 dark:group-hover:bg-zinc-400 transition-colors" />
            </div>
          )}

          {/* Editor column: toolbar + scrollable content (TOC-style collapse for inline mode) */}
          <div
            className={`flex flex-col overflow-hidden transition-all duration-200 ${isInline && contentCollapsed ? 'shrink-0 w-10' : isInline && contentMinWidth ? 'shrink-0' : 'flex-1'}`}
            style={isInline && contentCollapsed
              ? { backgroundColor: darkMode ? 'rgb(40,52,62)' : 'rgb(217,232,241)' }
              : isInline && contentMinWidth ? { width: contentMinWidth } : undefined}
          >
          {/* Inline mode: header + collapse button + toolbar */}
          {isInline ? (
            <>
              {(sidebarContent || hideSidebar) ? (
                /* Card Content header — collapsible (Cards panel) */
                <div
                  className={`shrink-0 sticky top-0 z-10 ${contentCollapsed ? '' : 'border-b border-zinc-200 dark:border-zinc-600'}`}
                  style={{ backgroundColor: darkMode ? 'rgb(40,52,62)' : 'rgb(217,232,241)' }}
                >
                  <button
                    onClick={() => setContentCollapsed(!contentCollapsed)}
                    className={`${contentCollapsed ? 'flex flex-col items-center gap-1.5 py-3 px-1 w-full' : 'shrink-0 flex flex-row items-center pt-2 pb-1'} hover:opacity-80 transition-colors cursor-pointer`}
                    title={contentCollapsed ? 'Expand editor' : 'Collapse editor'}
                  >
                    {contentCollapsed ? (
                      <>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-zinc-500 dark:text-zinc-400">
                          <rect width="18" height="18" x="3" y="3" rx="2" />
                          <path d="M9 3v18" />
                        </svg>
                        <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-800 dark:text-zinc-200" style={{ writingMode: 'vertical-rl', textOrientation: 'mixed', transform: 'rotate(180deg)' }}>
                          Card Content
                        </span>
                      </>
                    ) : (
                      <>
                        <div className="w-8 shrink-0 flex items-center justify-center">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-zinc-500 dark:text-zinc-400">
                            <rect width="18" height="18" x="3" y="3" rx="2" />
                            <path d="M9 3v18" />
                          </svg>
                        </div>
                        <span className="text-[13px] font-bold uppercase tracking-wider text-zinc-800 dark:text-zinc-200 whitespace-nowrap">
                          Card Content
                        </span>
                      </>
                    )}
                  </button>
                </div>
              ) : (
                /* Document header — non-collapsible (Sources panel) */
                <div
                  className="shrink-0 sticky top-0 z-10 bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-600"
                >
                  <div className="shrink-0 flex flex-row items-center pt-2 pb-1">
                    <div className="w-8 shrink-0 flex items-center justify-center">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-zinc-500 dark:text-zinc-400">
                        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                        <line x1="16" y1="13" x2="8" y2="13" />
                        <line x1="16" y1="17" x2="8" y2="17" />
                      </svg>
                    </div>
                    <span className="text-[13px] font-bold uppercase tracking-wider text-zinc-800 dark:text-zinc-200">
                      Document
                    </span>
                  </div>
                </div>
              )}
              <div className={contentCollapsed ? 'hidden' : ''}>
              <div className="shrink-0 h-[40px] flex items-center border-b border-zinc-200 dark:border-zinc-600">
                <div className="flex-1 min-w-0">
                  <FormatToolbar
                    activeFormats={editing.activeFormats}
                    executeCommand={editing.executeCommand}
                    insertTable={editing.insertTable}
                    showFind={findReplace.showFind}
                    setShowFind={findReplace.setShowFind}
                    findInputRef={findReplace.findInputRef}
                    isDirty={editing.isDirty}
                    onSave={() => editing.saveEdits()}
                    hasContent={true}
                  />
                </div>
              </div>
              {findReplace.showFind && (
                <div className="shrink-0 border-b border-zinc-100 dark:border-zinc-600">
                  <FindReplaceBar
                    findInputRef={findReplace.findInputRef}
                    findQuery={findReplace.findQuery}
                    setFindQuery={findReplace.setFindQuery}
                    replaceQuery={findReplace.replaceQuery}
                    setReplaceQuery={findReplace.setReplaceQuery}
                    findMatchCount={findReplace.findMatchCount}
                    findActiveIndex={findReplace.findActiveIndex}
                    setFindActiveIndex={findReplace.setFindActiveIndex}
                    findMatchCase={findReplace.findMatchCase}
                    setFindMatchCase={findReplace.setFindMatchCase}
                    findNext={findReplace.findNext}
                    findPrev={findReplace.findPrev}
                    closeFindBar={findReplace.closeFindBar}
                    handleReplace={findReplace.handleReplace}
                    handleReplaceAll={findReplace.handleReplaceAll}
                  />
                </div>
              )}
              </div>
            </>
          ) : (
            toolbarEl
          )}
          {/* Scrollable Editor Area (hidden when collapsed in inline mode) */}
          <div ref={scrollContainerRef} className={`flex-1 overflow-y-auto ${isInline && contentCollapsed ? 'hidden' : ''}`}>
            <div className="max-w-4xl mx-auto px-4 py-6">
              <div
                ref={editorRef}
                contentEditable
                onKeyDown={handleEditorKeyDown}
                onInput={editing.updateActiveFormatStates}
                onClick={(e) => {
                  // Tier 1: clicking in editor content selects the heading section in TOC
                  let node = e.target as HTMLElement | null;
                  // Check if clicked element itself is a heading
                  if (node && /^H[1-6]$/i.test(node.tagName) && node.id) {
                    editing.deselectAll();
                    setActiveHeadingId(node.id);
                    return;
                  }
                  // Otherwise walk previous siblings to find the nearest preceding heading
                  while (node && node !== editorRef.current) {
                    let prev = node.previousElementSibling as HTMLElement | null;
                    while (prev) {
                      if (/^H[1-6]$/i.test(prev.tagName) && prev.id) {
                        editing.deselectAll();
                        setActiveHeadingId(prev.id);
                        return;
                      }
                      prev = prev.previousElementSibling as HTMLElement | null;
                    }
                    node = node.parentElement;
                  }
                }}
                className="document-prose chat-prose min-h-[70vh] pb-40 outline-none"
              />
            </div>
          </div>
          </div>
        </div>
      </>
    );

    // ── LOD Eligibility (pre-computed for context menu gating) ──
    let sectionLodCounts: LodPassCounts | null = null;
    {
      const ids = getTier2Ids();
      const texts = ids
        .map((id) => headings.find((hh) => hh.id === id)?.text)
        .filter((t): t is string => !!t);
      if (texts.length > 0) {
        sectionLodCounts = computeLodPassCounts(texts, doc);
      }
    }
    const docEligible = getEligibleDetailLevels(computeMdSectionWordCount('__whole_document__', doc));

    // ── Context Menu (rendered as portal in both modes for correct positioning) ──
    const contextMenuEl =
      contextMenu && contextHeading
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              className="fixed z-[130] min-w-[180px] bg-white dark:bg-zinc-900 rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-600 py-1 animate-in fade-in zoom-in-95 duration-150"
              style={{
                top: contextMenu.y,
                left: contextMenu.x,
              }}
            >
              {onGenerateCard && (
                <>
                  <div className="relative">
                    <button
                      onClick={() => setGenerateContentSubmenuOpen((prev) => !prev)}
                      onMouseEnter={() => {
                        setGenerateContentSubmenuOpen(true);
                        setLevelSubmenuOpen(false);
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
                          className="text-zinc-500 dark:text-zinc-400"
                        >
                          <rect x="3" y="3" width="16" height="16" rx="2" />
                          <path d="M12 8v8" />
                          <path d="M8 12h8" />
                        </svg>
                        Generate Card Content{getTier2Ids().length > 1 ? ' for Highlighted Items' : ''}
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

                    {generateContentSubmenuOpen && (
                      <div
                        ref={generateSubmenuRef}
                        className="absolute left-full top-0 ml-1 min-w-[200px] bg-white dark:bg-zinc-900 rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-600 py-1 animate-in fade-in zoom-in-95 duration-100"
                      >
                        {/* Snapshot — content as-is, no gate (fallback for very short sections) */}
                        <button
                          onClick={async () => {
                            const ids = getTier2Ids();
                            const targets = ids
                              .map((id) => ({ id, text: headings.find((hh) => hh.id === id)?.text || '' }))
                              .filter((t) => t.text);
                            closeMenu();
                            let cardIds: string[] | null = null;
                            if (targets.length >= 2 && onCreateBatchFolder) {
                              cardIds = onCreateBatchFolder(
                                targets.map((t) => t.text),
                                'DirectContent' as DetailLevel,
                                doc.name,
                              );
                            }
                            await Promise.all(
                              targets.map((t, i) =>
                                onGenerateCard(t.id, 'DirectContent' as DetailLevel, t.text, doc.name, cardIds?.[i]),
                              ),
                            );
                          }}
                          className="w-full text-left px-3 py-2 text-[11px] text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors flex items-center justify-between gap-3"
                        >
                          <span className="font-medium text-emerald-600">Snapshot</span>
                          <span className="text-[9px] text-zinc-500 dark:text-zinc-400">Content as-is</span>
                        </button>

                        {[
                          { level: 'Executive' as DetailLevel, label: 'Executive', desc: '70-100 words' },
                          { level: 'Standard' as DetailLevel, label: 'Standard', desc: '200-250 words' },
                          { level: 'Detailed' as DetailLevel, label: 'Detailed', desc: '450-500 words' },
                        ].map((opt) => {
                          const lodKey = opt.level as 'Executive' | 'Standard' | 'Detailed';
                          const passCount = sectionLodCounts?.counts[lodKey] ?? null;
                          const total = sectionLodCounts?.total ?? 0;
                          const isDisabled = passCount !== null && passCount < total;
                          const isSingle = total === 1;

                          // Badge text: no data → word range, single → ~Nw, multi → pass/total
                          const badgeText = sectionLodCounts === null
                            ? opt.desc
                            : isSingle
                              ? (sectionLodCounts.wordCounts[0] !== null ? `~${sectionLodCounts.wordCounts[0]}w` : opt.desc)
                              : `${passCount}/${total}`;

                          // Tooltip
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
                              const ids = getTier2Ids();
                              const targets = ids
                                .map((id) => ({ id, text: headings.find((hh) => hh.id === id)?.text || '' }))
                                .filter((t) => t.text);
                              closeMenu();
                              let cardIds: string[] | null = null;
                              if (targets.length >= 2 && onCreateBatchFolder) {
                                cardIds = onCreateBatchFolder(
                                  targets.map((t) => t.text),
                                  opt.level,
                                  doc.name,
                                );
                              }
                              await Promise.all(targets.map((t, i) => onGenerateCard(t.id, opt.level, t.text, doc.name, cardIds?.[i])));
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
                          const total = sectionLodCounts?.total ?? 0;
                          if (total < 2) return null;
                          // Hide when all three LOD levels are fully available
                          if (sectionLodCounts && sectionLodCounts.counts.Executive >= total && sectionLodCounts.counts.Standard >= total && sectionLodCounts.counts.Detailed >= total) return null;
                          // Compute max LOD per heading — Snapshot (DirectContent) as fallback
                          const ids = getTier2Ids();
                          const perHeading = ids.map((id) => {
                            const text = headings.find((hh) => hh.id === id)?.text || '';
                            const wc = text ? computeMdSectionWordCount(text, doc) : null;
                            const maxLod = getMaxDetailLevel(wc) ?? ('DirectContent' as DetailLevel);
                            return { id, text, maxLod };
                          }).filter((h) => h.text);
                          if (perHeading.length < 2) return null;
                          return (
                            <button
                              onClick={async () => {
                                closeMenu();
                                let cardIds: string[] | null = null;
                                if (onCreateBatchFolder) {
                                  cardIds = onCreateBatchFolder(
                                    perHeading.map((h) => h.text),
                                    perHeading.map((h) => h.maxLod),
                                    doc.name,
                                  );
                                }
                                await Promise.all(
                                  perHeading.map((h, i) =>
                                    onGenerateCard(h.id, h.maxLod, h.text, doc.name, cardIds?.[i]),
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

                        {/* Divider */}
                        <div className="h-px bg-zinc-100 dark:bg-zinc-700 my-1" />

                        {/* Takeaway Card — gated at 100w */}
                        {(() => {
                          const takeawayPassCount = sectionLodCounts?.counts.TakeawayCard ?? null;
                          const takeawayTotal = sectionLodCounts?.total ?? 0;
                          const takeawayDisabled = takeawayPassCount !== null && takeawayPassCount < takeawayTotal;
                          const isSingle = takeawayTotal === 1;
                          const takeawayBadge = sectionLodCounts === null
                            ? 'Title + Key Takeaways'
                            : isSingle
                              ? (sectionLodCounts.wordCounts[0] !== null ? `~${sectionLodCounts.wordCounts[0]}w` : 'Title + Key Takeaways')
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
                                const ids = getTier2Ids();
                                const targets = ids
                                  .map((id) => ({ id, text: headings.find((hh) => hh.id === id)?.text || '' }))
                                  .filter((t) => t.text);
                                closeMenu();
                                let cardIds: string[] | null = null;
                                if (targets.length >= 2 && onCreateBatchFolder) {
                                  cardIds = onCreateBatchFolder(targets.map((t) => t.text), 'TakeawayCard' as DetailLevel, doc.name);
                                }
                                await Promise.all(targets.map((t, i) => onGenerateCard(t.id, 'TakeawayCard' as DetailLevel, t.text, doc.name, cardIds?.[i])));
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
                            const ids = getTier2Ids();
                            const targets = ids
                              .map((id) => ({ id, text: headings.find((hh) => hh.id === id)?.text || '' }))
                              .filter((t) => t.text);
                            closeMenu();
                            let cardIds: string[] | null = null;
                            if (targets.length >= 2 && onCreateBatchFolder) {
                              cardIds = onCreateBatchFolder(targets.map((t) => t.text), 'TitleCard' as DetailLevel, doc.name);
                            }
                            await Promise.all(targets.map((t, i) => onGenerateCard(t.id, 'TitleCard' as DetailLevel, t.text, doc.name, cardIds?.[i])));
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

              <button
                onClick={handleSelectHeadingAndContent}
                onMouseEnter={() => {
                  setLevelSubmenuOpen(false);
                  setGenerateContentSubmenuOpen(false);
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
                  <path d="M5 3a2 2 0 0 0-2 2" />
                  <path d="M19 3a2 2 0 0 1 2 2" />
                  <path d="M21 19a2 2 0 0 1-2 2" />
                  <path d="M5 21a2 2 0 0 1-2-2" />
                  <path d="M9 3h1" />
                  <path d="M9 21h1" />
                  <path d="M14 3h1" />
                  <path d="M14 21h1" />
                  <path d="M3 9v1" />
                  <path d="M21 9v1" />
                  <path d="M3 14v1" />
                  <path d="M21 14v1" />
                </svg>
                Select Heading and Content
              </button>

              <div className="h-px bg-zinc-100 dark:bg-zinc-700 my-1" />

              <button
                onClick={handlePromote}
                disabled={!canPromote}
                onMouseEnter={() => {
                  setLevelSubmenuOpen(false);
                  setGenerateContentSubmenuOpen(false);
                }}
                className={`w-full text-left px-3 py-2 text-[11px] hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors flex items-center gap-2 ${canPromote ? 'text-zinc-800 dark:text-zinc-200' : 'text-zinc-500 dark:text-zinc-400 pointer-events-none'}`}
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
                  className={canPromote ? 'text-zinc-500 dark:text-zinc-400' : 'text-zinc-500 dark:text-zinc-400'}
                >
                  <path d="m15 18-6-6 6-6" />
                </svg>
                Promote
                <span
                  className={`ml-auto text-[9px] ${canPromote ? 'text-zinc-500 dark:text-zinc-400' : 'text-zinc-500 dark:text-zinc-400'}`}
                >
                  H{contextHeading.level}→H{Math.max(1, contextHeading.level - 1)}
                </span>
              </button>

              <button
                onClick={handleDemote}
                disabled={!canDemote}
                onMouseEnter={() => {
                  setLevelSubmenuOpen(false);
                  setGenerateContentSubmenuOpen(false);
                }}
                className={`w-full text-left px-3 py-2 text-[11px] hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors flex items-center gap-2 ${canDemote ? 'text-zinc-800 dark:text-zinc-200' : 'text-zinc-500 dark:text-zinc-400 pointer-events-none'}`}
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
                  className={canDemote ? 'text-zinc-500 dark:text-zinc-400' : 'text-zinc-500 dark:text-zinc-400'}
                >
                  <path d="m9 18 6-6-6-6" />
                </svg>
                Demote
                <span
                  className={`ml-auto text-[9px] ${canDemote ? 'text-zinc-500 dark:text-zinc-400' : 'text-zinc-500 dark:text-zinc-400'}`}
                >
                  H{contextHeading.level}→H{Math.min(6, contextHeading.level + 1)}
                </span>
              </button>

              <div className="h-px bg-zinc-100 dark:bg-zinc-700 my-1" />

              <button
                onClick={expandAll}
                onMouseEnter={() => {
                  setLevelSubmenuOpen(false);
                  setGenerateContentSubmenuOpen(false);
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

              <button
                onClick={collapseAll}
                onMouseEnter={() => {
                  setLevelSubmenuOpen(false);
                  setGenerateContentSubmenuOpen(false);
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

              <div className="relative">
                <button
                  onClick={() => setLevelSubmenuOpen((prev) => !prev)}
                  onMouseEnter={() => {
                    setLevelSubmenuOpen(true);
                    setGenerateContentSubmenuOpen(false);
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

                {levelSubmenuOpen && (
                  <div
                    ref={levelSubmenuRef}
                    className="absolute left-full top-0 ml-1 min-w-[140px] bg-white dark:bg-zinc-900 rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-600 py-1 animate-in fade-in zoom-in-95 duration-100 whitespace-nowrap"
                  >
                    {(
                      [
                        { label: 'H1 Only', tag: 'H1', levels: [1] },
                        { label: 'H2 Only', tag: 'H2', levels: [2] },
                        { label: 'H3 Only', tag: 'H3', levels: [3] },
                        { label: 'H1 + H2', tag: 'H1–2', levels: [1, 2] },
                        { label: 'H2 + H3', tag: 'H2–3', levels: [2, 3] },
                        { label: 'All Levels', tag: 'All', levels: [1, 2, 3] },
                      ] as { label: string; tag: string; levels: number[] }[]
                    ).map((opt) => (
                      <button
                        key={opt.label}
                        onClick={() => handleSelectLevel(opt.levels)}
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
          )
        : null;

    // ── Document-level context menu (right-click on doc name → Generate Card for whole doc) ──
    const docContextMenuEl =
      docContextMenu && onGenerateCard
        ? createPortal(
            <div
              role="menu"
              className="fixed z-[130] min-w-[180px] bg-white dark:bg-zinc-900 rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-600 py-1 animate-in fade-in zoom-in-95 duration-150"
              style={{
                top: Math.min(docContextMenu.y, window.innerHeight - 200),
                left: Math.min(docContextMenu.x, window.innerWidth - 220),
              }}
              onMouseDown={(e) => e.stopPropagation()}
              onContextMenu={(e) => e.preventDefault()}
            >
              <div className="relative">
                <button
                  onClick={() => setDocGenerateSubmenuOpen((prev) => !prev)}
                  onMouseEnter={() => setDocGenerateSubmenuOpen(true)}
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
                      className="text-zinc-500 dark:text-zinc-400"
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
                    className="text-zinc-500 dark:text-zinc-400"
                  >
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>

                {docGenerateSubmenuOpen && (
                  <div className="absolute left-full top-0 ml-1 min-w-[200px] bg-white dark:bg-zinc-900 rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-600 py-1 animate-in fade-in zoom-in-95 duration-100">
                    {/* Snapshot — content as-is, no gate */}
                    <button
                      onClick={async () => {
                        setDocContextMenu(null);
                        setDocGenerateSubmenuOpen(false);
                        await onGenerateCard('__whole_document__', 'DirectContent' as DetailLevel, doc.name, doc.name);
                      }}
                      className="w-full text-left px-3 py-2 text-[11px] text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors flex items-center justify-between gap-3"
                    >
                      <span className="font-medium text-emerald-600">Snapshot</span>
                      <span className="text-[9px] text-zinc-500 dark:text-zinc-400">Content as-is</span>
                    </button>

                    {[
                      { level: 'Executive' as DetailLevel, label: 'Executive', desc: '70-100 words' },
                      { level: 'Standard' as DetailLevel, label: 'Standard', desc: '200-250 words' },
                      { level: 'Detailed' as DetailLevel, label: 'Detailed', desc: '450-500 words' },
                    ].map((opt) => {
                      const isDisabled = docEligible !== null && !docEligible.has(opt.level);
                      return (
                      <button
                        key={opt.level}
                        disabled={isDisabled}
                        title={isDisabled ? 'Document too short for this level' : undefined}
                        onClick={async () => {
                          if (isDisabled) return;
                          setDocContextMenu(null);
                          setDocGenerateSubmenuOpen(false);
                          await onGenerateCard('__whole_document__', opt.level, doc.name, doc.name);
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
                      const takeawayDocDisabled = docEligible !== null && !docEligible.has('TakeawayCard');
                      return (
                        <button
                          disabled={takeawayDocDisabled}
                          title={takeawayDocDisabled ? 'Document too short for takeaway card' : undefined}
                          onClick={async () => {
                            if (takeawayDocDisabled) return;
                            setDocContextMenu(null);
                            setDocGenerateSubmenuOpen(false);
                            await onGenerateCard('__whole_document__', 'TakeawayCard' as DetailLevel, doc.name, doc.name);
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
                        setDocContextMenu(null);
                        setDocGenerateSubmenuOpen(false);
                        await onGenerateCard('__whole_document__', 'TitleCard' as DetailLevel, doc.name, doc.name);
                      }}
                      className="w-full text-left px-3 py-2 text-[11px] text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors flex items-center justify-between gap-3"
                    >
                      <span className="font-medium text-violet-600">Title Card</span>
                      <span className="text-[9px] text-zinc-500 dark:text-zinc-400">Title + Subtitle</span>
                    </button>
                  </div>
                )}
              </div>
            </div>,
            document.body,
          )
        : null;

    // Close doc context menu on outside click
    useEffect(() => {
      if (!docContextMenu) return;
      const handler = (_e: MouseEvent) => {
        setDocContextMenu(null);
        setDocGenerateSubmenuOpen(false);
      };
      // Delay so the context menu render isn't immediately caught
      const timer = setTimeout(() => document.addEventListener('mousedown', handler), 0);
      return () => {
        clearTimeout(timer);
        document.removeEventListener('mousedown', handler);
      };
    }, [docContextMenu]);

    // ── Inline mode: render directly without portal ──
    if (isInline) {
      return (
        <div className="flex flex-col flex-1 overflow-hidden">
          {editorBody}
          {contextMenuEl}
          {docContextMenuEl}
          {showUnsavedDialog && (
            <UnsavedChangesDialog
              onSave={confirmSave}
              onDiscard={confirmDiscard}
              onCancel={() => setShowUnsavedDialog(false)}
            />
          )}
        </div>
      );
    }

    // ── Modal mode: render in portal with backdrop ──
    return createPortal(
      <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 dark:bg-black/60 backdrop-blur-sm">
        <div
          ref={focusTrapRef}
          role="dialog"
          aria-modal="true"
          aria-label="Document editor"
          className="flex flex-col w-full h-full max-w-6xl max-h-[94vh] my-[3vh] mx-4 bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl dark:shadow-black/30 overflow-hidden"
        >
          {/* Header */}
          <div className="shrink-0 h-[44px] flex items-center justify-between px-5 border-b border-zinc-100 dark:border-zinc-600">
            <div className="flex items-center gap-2.5 min-w-0">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                className="text-zinc-500 dark:text-zinc-400"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              <span className="text-xs text-zinc-600 dark:text-zinc-400 truncate font-medium" title={doc.name}>
                {doc.name}
              </span>
              {editing.isDirty && (
                <span className="text-[9px] text-amber-500 font-medium uppercase tracking-wider">Unsaved</span>
              )}
            </div>
            <button
              onClick={handleDiscardAndClose}
              title="Close"
              className="shrink-0 p-1 rounded-md text-zinc-500 dark:text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </button>
          </div>

          {editorBody}
        </div>

        {contextMenuEl}
        {docContextMenuEl}

        {showUnsavedDialog && (
          <UnsavedChangesDialog
            onSave={confirmSave}
            onDiscard={confirmDiscard}
            onCancel={() => setShowUnsavedDialog(false)}
            {...(isCustomCard
              ? {
                  title: 'Custom card',
                  description: 'Name your card and save it to the cards list, or discard it.',
                  saveLabel: 'Save and Add to Cards',
                  discardLabel: 'Discard Changes',
                  nameInput: {
                    defaultName: doc.name,
                    existingNames: existingCardNames || [],
                    onSaveWithName: (name: string) => {
                      setShowUnsavedDialog(false);
                      editing.saveEdits();
                      onSaveCustomCard?.(name);
                      onClose();
                    },
                  },
                }
              : {})}
          />
        )}
      </div>,
      document.body,
    );
  },
);

export default DocumentEditorModal;
