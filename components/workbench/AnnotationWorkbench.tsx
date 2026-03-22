import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createLogger } from '../../utils/logger';
import {
  ZoomViewState,
  AnnotationTool,
  NormalizedPoint,
  PinAnnotation,
  RectangleAnnotation,
  ArrowAnnotation,
  SketchAnnotation,
  ImageVersion,
  Palette,
} from '../../types';

const log = createLogger('Workbench');
import AnnotationToolbar from './AnnotationToolbar';
import { useAnnotations, createAnnotationId } from '../../hooks/useAnnotations';
import {
  renderAnnotations,
  canvasToNormalized,
  hitTestAnnotation,
  hitTestHandle,
  HandleType,
  RubberBand,
} from './CanvasRenderer';
import AnnotationEditorPopover from './AnnotationEditorPopover';
import { simplifyPath } from '../../utils/geometry';
import { generateRedlineMap } from '../../utils/redline';
import { executeModification, executeContentModification } from '../../utils/modificationEngine';
import { useVersionHistory } from '../../hooks/useVersionHistory';

export interface AnnotationToolbarState {
  activeTool: AnnotationTool;
  onToolChange: (tool: AnnotationTool) => void;
  annotationCount: number;
  onDiscardMarks: () => void;
  onModify: () => void;
  isModifying: boolean;
  activeColor: string;
  onColorChange: (color: string) => void;
  palette?: Palette;
  contentDirty?: boolean;
  hasSelection: boolean;
  onDeleteSelected: () => void;
  zoomScale: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  onRequestFullscreen?: () => void;
  globalInstruction: string;
  onGlobalInstructionChange: (text: string) => void;
}

interface AnnotationWorkbenchProps {
  imageUrl: string;
  cardId?: string | null;
  cardText?: string | null;
  palette?: Palette | null;
  style?: string;
  aspectRatio?: string;
  resolution?: string;
  imageHistory?: ImageVersion[];
  mode: 'inline' | 'fullscreen';
  onImageModified?: (cardId: string, newImageUrl: string, history: ImageVersion[]) => void;
  onRequestFullscreen?: () => void;
  contentDirty?: boolean;
  currentContent?: string;
  onZoomChange?: (scale: number) => void;
  onToolbarStateChange?: (state: AnnotationToolbarState) => void;
  overlay?: React.ReactNode;
  onUsage?: (entry: { provider: 'gemini'; model: string; inputTokens: number; outputTokens: number }) => void;
}

const INLINE_MIN_SCALE = 0.5;
const INLINE_MAX_SCALE = 2.0;
const FULLSCREEN_MIN_SCALE = 0.5;
const FULLSCREEN_MAX_SCALE = 4.0;
const ZOOM_STEP = 0.05;
const SCROLL_ZOOM_STEP = 0.05;
const MIN_RECT_SIZE = 0.01;
const MIN_ARROW_LENGTH = 0.02;
const DEFAULT_SKETCH_STROKE_WIDTH = 0.025;
const DEFAULT_ANNOTATION_COLOR = '#E63946';

const AnnotationWorkbench: React.FC<AnnotationWorkbenchProps> = ({
  imageUrl,
  cardId,
  cardText,
  palette,
  style,
  aspectRatio,
  resolution,
  imageHistory,
  mode,
  onImageModified,
  onRequestFullscreen,
  contentDirty,
  currentContent,
  onZoomChange,
  onToolbarStateChange,
  overlay,
  onUsage,
}) => {
  const isInline = mode === 'inline';
  const MIN_SCALE = isInline ? INLINE_MIN_SCALE : FULLSCREEN_MIN_SCALE;
  const MAX_SCALE = isInline ? INLINE_MAX_SCALE : FULLSCREEN_MAX_SCALE;

  const [activeTool, setActiveTool] = useState<AnnotationTool>('select');
  const [zoomView, setZoomView] = useState<ZoomViewState>({ scale: 1, panX: 0, panY: 0, isPanning: false });
  const [imageNaturals, setImageNaturals] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [fittedSize, setFittedSize] = useState<{ w: number; h: number } | null>(null);
  const [ctrlHeld, setCtrlHeld] = useState(false);
  const [altHeld, setAltHeld] = useState(false);
  const [activeColor, setActiveColor] = useState(DEFAULT_ANNOTATION_COLOR);
  const [globalInstruction, setGlobalInstruction] = useState('');

  // Notify parent of zoom changes
  useEffect(() => {
    onZoomChange?.(zoomView.scale);
  }, [zoomView.scale, onZoomChange]);

  // Ref for toolbar state change callback (avoids re-triggering effect on parent re-render)
  const onToolbarStateChangeRef = useRef(onToolbarStateChange);
  onToolbarStateChangeRef.current = onToolbarStateChange;

  // Modification state
  const [isModifying, setIsModifying] = useState(false);
  const [modifyError, setModifyError] = useState<string | null>(null);
  const [currentImageUrl, setCurrentImageUrl] = useState<string | null>(null);

  // Version history
  const {
    versions,
    currentIndex,
    canUndo,
    canRedo,
    modificationCount,
    pushVersion,
    restorePrevious,
    restoreNext,
    restoreByIndex,
  } = useVersionHistory(imageHistory, imageUrl);

  // Annotation state
  const { annotations, selectedAnnotationId, add, update, remove, select, clearAll, moveAnnotation } = useAnnotations();

  // Editor popover state
  const [editingPinId, setEditingPinId] = useState<string | null>(null);
  const [editingRectId, setEditingRectId] = useState<string | null>(null);
  const [editingArrowId, setEditingArrowId] = useState<string | null>(null);
  const [editingSketchId, setEditingSketchId] = useState<string | null>(null);

  // Rubber-band state
  const [rubberBand, setRubberBand] = useState<RubberBand | null>(null);
  const rectStartRef = useRef<NormalizedPoint | null>(null);
  const arrowStartRef = useRef<NormalizedPoint | null>(null);
  const sketchPointsRef = useRef<NormalizedPoint[]>([]);
  const isSketchingRef = useRef(false);

  // Select tool: drag state
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ annotationId: string; startNorm: NormalizedPoint; handle: HandleType } | null>(null);

  // Version strip visibility
  const [showVersionStrip, setShowVersionStrip] = useState(false);

  const viewportRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const panStartRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const didPanRef = useRef(false);
  const animFrameRef = useRef<number>(0);

  const isEditing = editingPinId || editingRectId || editingArrowId || editingSketchId;
  const displayImageUrl = currentImageUrl || imageUrl;

  // Reset when image changes
  useEffect(() => {
    setZoomView({ scale: 1, panX: 0, panY: 0, isPanning: false });
    setActiveTool('select');
    clearAll();
    setEditingPinId(null);
    setEditingRectId(null);
    setEditingArrowId(null);
    setEditingSketchId(null);
    setRubberBand(null);
    setCurrentImageUrl(null);
    setModifyError(null);
    setShowVersionStrip(false);
    setGlobalInstruction('');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- clearAll is a hook-derived function that changes identity; reset only needs to fire when the image changes
  }, [imageUrl]);

  // Keyboard: modifier tracking + shortcuts
  useEffect(() => {
    const target = isInline ? viewportRef.current : window;
    if (!target) return;

    const handleKeyDown = (e: Event) => {
      const ke = e as KeyboardEvent;
      const tag = (ke.target as HTMLElement)?.tagName;
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || (ke.target as HTMLElement)?.isContentEditable;

      // Always track modifier keys regardless of focus
      if (ke.key === 'Control' || ke.key === 'Meta') {
        setCtrlHeld(true);
        return;
      }
      if (ke.key === 'Alt') {
        ke.preventDefault();
        setAltHeld(true);
        return;
      }

      // Don't intercept shortcuts when user is typing in an input/textarea
      if (isInput) return;

      if (ke.key === 'Escape') {
        if (isModifying) return;
        if (isEditing) {
          setEditingPinId(null);
          setEditingRectId(null);
          setEditingArrowId(null);
          setEditingSketchId(null);
          return;
        }
        if (selectedAnnotationId) {
          select(null);
          return;
        }
      }
      if (ke.key === 'Delete' || ke.key === 'Backspace') {
        if (selectedAnnotationId && !isEditing) {
          remove(selectedAnnotationId);
        }
      }
    };
    const handleKeyUp = (e: Event) => {
      const ke = e as KeyboardEvent;
      if (ke.key === 'Control' || ke.key === 'Meta') setCtrlHeld(false);
      if (ke.key === 'Alt') setAltHeld(false);
    };

    target.addEventListener('keydown', handleKeyDown);
    target.addEventListener('keyup', handleKeyUp);
    return () => {
      target.removeEventListener('keydown', handleKeyDown);
      target.removeEventListener('keyup', handleKeyUp);
    };
  }, [selectedAnnotationId, isEditing, isModifying, select, remove, isInline]);

  // Image load
  const handleImageLoad = useCallback(() => {
    if (imgRef.current) {
      setImageNaturals({ w: imgRef.current.naturalWidth, h: imgRef.current.naturalHeight });
    }
  }, []);

  // Compute fitted image dimensions for inline mode — ensures both width AND height are constrained
  const INLINE_PADDING = 32; // p-4 = 16px each side
  const computeFittedSize = useCallback(() => {
    if (!isInline || !viewportRef.current || imageNaturals.w === 0 || imageNaturals.h === 0) {
      setFittedSize(null);
      return;
    }
    const vw = viewportRef.current.clientWidth - INLINE_PADDING;
    const vh = viewportRef.current.clientHeight - INLINE_PADDING;
    if (vw <= 0 || vh <= 0) {
      setFittedSize(null);
      return;
    }
    const imgAR = imageNaturals.w / imageNaturals.h;
    const containerAR = vw / vh;
    let w: number, h: number;
    if (imgAR > containerAR) {
      // Width-bound — landscape or wide image
      w = Math.min(vw, imageNaturals.w);
      h = w / imgAR;
    } else {
      // Height-bound — portrait or tall image
      h = Math.min(vh, imageNaturals.h);
      w = h * imgAR;
    }
    setFittedSize({ w: Math.round(w), h: Math.round(h) });
  }, [isInline, imageNaturals]);

  // Recompute fitted size when naturals change or viewport resizes
  useEffect(() => {
    computeFittedSize();
    const viewport = viewportRef.current;
    if (!viewport || !isInline) return;
    const observer = new ResizeObserver(() => computeFittedSize());
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [computeFittedSize, isInline]);

  // Sync canvas size — upscale buffer for crisp rendering at current zoom level
  useEffect(() => {
    const img = imgRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas) return;
    const sync = () => {
      const dw = img.offsetWidth;
      const dh = img.offsetHeight;
      // Use devicePixelRatio × zoom so annotations stay sharp when the CSS transform scales the canvas up
      const dpr = window.devicePixelRatio || 1;
      const ratio = Math.max(1, dpr * zoomView.scale);
      const bw = Math.round(dw * ratio);
      const bh = Math.round(dh * ratio);
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw;
        canvas.height = bh;
      }
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(img);
    return () => observer.disconnect();
  }, [imageNaturals, zoomView.scale]);

  // Canvas render loop — scale context to match hi-DPI buffer, draw in logical coords
  useEffect(() => {
    const render = () => {
      const canvas = canvasRef.current;
      const img = imgRef.current;
      if (!canvas || !img) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const dw = img.offsetWidth;
      const dh = img.offsetHeight;
      if (dw === 0 || dh === 0) {
        animFrameRef.current = requestAnimationFrame(render);
        return;
      }

      // The canvas buffer is dw*ratio × dh*ratio, but we draw in logical (dw × dh) space
      const ratioX = canvas.width / dw;
      const ratioY = canvas.height / dh;

      ctx.setTransform(ratioX, 0, 0, ratioY, 0, 0);
      renderAnnotations(ctx, annotations, selectedAnnotationId, dw, dh, rubberBand, zoomView.scale);
      ctx.setTransform(1, 0, 0, 1, 0, 0); // reset

      animFrameRef.current = requestAnimationFrame(render);
    };
    animFrameRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [annotations, selectedAnnotationId, rubberBand, zoomView.scale]);

  // --- Coordinate helpers ---
  const getCanvasCoords = (e: React.MouseEvent): { cx: number; cy: number } | null => {
    const img = imgRef.current;
    if (!img) return null;
    const imgRect = img.getBoundingClientRect();
    const cx = (e.clientX - imgRect.left) / zoomView.scale;
    const cy = (e.clientY - imgRect.top) / zoomView.scale;
    return { cx, cy };
  };

  const getNormCoords = (e: React.MouseEvent): NormalizedPoint | null => {
    const img = imgRef.current;
    if (!img) return null;
    const coords = getCanvasCoords(e);
    if (!coords) return null;
    return canvasToNormalized(coords.cx, coords.cy, img.offsetWidth, img.offsetHeight);
  };

  // --- Zoom helpers ---
  const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

  // Clamp pan so the image can't be dragged entirely off-screen.
  // Prevents runaway transform values that crash the GPU compositor.
  const clampPan = useCallback(
    (px: number, py: number, scale: number): { panX: number; panY: number } => {
      const viewport = viewportRef.current;
      const img = imgRef.current;
      if (!viewport || !img) return { panX: px, panY: py };
      const vw = viewport.clientWidth;
      const vh = viewport.clientHeight;
      const iw = img.offsetWidth * scale;
      const ih = img.offsetHeight * scale;
      // The transform layer uses flex centering; compute offset from transform-origin (0,0)
      const padX = isInline ? INLINE_PADDING / 2 : 0;
      const padY = isInline ? INLINE_PADDING / 2 : 0;
      const originX = (vw - img.offsetWidth) / 2 - padX;
      const originY = (vh - img.offsetHeight) / 2 - padY;
      // Allow panning until only 20% of the scaled image remains visible
      const margin = 0.2;
      const minX = -(iw * (1 - margin)) + vw * 0.1 - originX;
      const maxX = vw * (1 - 0.1) - iw * margin - originX;
      const minY = -(ih * (1 - margin)) + vh * 0.1 - originY;
      const maxY = vh * (1 - 0.1) - ih * margin - originY;
      return {
        panX: Math.max(minX, Math.min(maxX, px)),
        panY: Math.max(minY, Math.min(maxY, py)),
      };
    },
    [isInline],
  );

  const handleWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const viewport = viewportRef.current;
      if (!viewport) return;
      const rect = viewport.getBoundingClientRect();
      const vx = e.clientX - rect.left;
      const vy = e.clientY - rect.top;
      const direction = e.deltaY < 0 ? 1 : -1;
      setZoomView((prev) => {
        const ns = clampScale(prev.scale + direction * SCROLL_ZOOM_STEP);
        const r = ns / prev.scale;
        const rawPanX = vx - r * (vx - prev.panX);
        const rawPanY = vy - r * (vy - prev.panY);
        const clamped = clampPan(rawPanX, rawPanY, ns);
        return { ...prev, scale: ns, ...clamped };
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- clampScale is derived from MIN/MAX_SCALE constants; listing both is sufficient
    [MIN_SCALE, MAX_SCALE, clampPan],
  );

  // Register wheel handler as non-passive to allow preventDefault()
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.addEventListener('wheel', handleWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  const zoomToward = useCallback(
    (vx: number, vy: number, newScale: number) => {
      setZoomView((prev) => {
        const c = clampScale(newScale);
        const r = c / prev.scale;
        const rawPanX = vx - r * (vx - prev.panX);
        const rawPanY = vy - r * (vy - prev.panY);
        const clamped = clampPan(rawPanX, rawPanY, c);
        return { ...prev, scale: c, ...clamped };
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- clampScale is derived from MIN/MAX_SCALE constants; listing both is sufficient
    [MIN_SCALE, MAX_SCALE, clampPan],
  );

  // Center-based zoom in/out (for toolbar buttons)
  const handleZoomIn = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    zoomToward(rect.width / 2, rect.height / 2, zoomView.scale + ZOOM_STEP);
  }, [zoomView.scale, zoomToward]);

  const handleZoomOut = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    zoomToward(rect.width / 2, rect.height / 2, zoomView.scale - ZOOM_STEP);
  }, [zoomView.scale, zoomToward]);

  const handleZoomReset = useCallback(() => {
    setZoomView({ scale: 1, panX: 0, panY: 0, isPanning: false });
  }, []);

  // --- VERSION HISTORY HELPERS ---
  const handleRestorePrevious = useCallback(() => {
    const url = restorePrevious();
    if (url) {
      setCurrentImageUrl(url);
      clearAll();
      select(null);
    }
  }, [restorePrevious, clearAll, select]);

  const handleRestoreNext = useCallback(() => {
    const url = restoreNext();
    if (url) {
      setCurrentImageUrl(url);
      clearAll();
      select(null);
    }
  }, [restoreNext, clearAll, select]);

  const handleRestoreByIndex = useCallback(
    (index: number) => {
      const url = restoreByIndex(index);
      if (url) {
        setCurrentImageUrl(url);
        clearAll();
        select(null);
      }
    },
    [restoreByIndex, clearAll, select],
  );

  // --- MODIFICATION ENGINE ---
  const canModify = annotations.length > 0 || !!contentDirty || !!globalInstruction.trim();

  const handleModify = useCallback(async () => {
    if (!canModify || isModifying) return;
    if (!displayImageUrl) return;

    const hasAnnotations = annotations.length > 0;
    const hasGlobalText = !!globalInstruction.trim();
    const isContentOnly = !hasAnnotations && !hasGlobalText && !!contentDirty && !!currentContent;

    // Annotation-based modification needs image naturals for redline
    if (hasAnnotations && (imageNaturals.w === 0 || imageNaturals.h === 0)) return;

    setIsModifying(true);
    setModifyError(null);

    try {
      let result;

      if (isContentOnly) {
        // Content-only: send reference image + new content
        result = await executeContentModification(
          {
            originalImageUrl: displayImageUrl,
            content: currentContent,
            cardText: cardText ?? null,
            style,
            palette: palette
              ? {
                  background: palette.background,
                  primary: palette.primary,
                  secondary: palette.secondary,
                  accent: palette.accent,
                  text: palette.text,
                }
              : undefined,
            aspectRatio,
            resolution,
          },
          onUsage,
        );
      } else {
        // Annotation-based (or global instruction): send original + redline + instructions
        const { redlineDataUrl, instructions } = hasAnnotations
          ? generateRedlineMap(annotations, imageNaturals.w, imageNaturals.h)
          : { redlineDataUrl: '', instructions: '' };

        // Prepend global instruction before spatial annotations
        let combinedInstructions = '';
        if (hasGlobalText) {
          combinedInstructions += `[GLOBAL INSTRUCTION]: "${globalInstruction.trim()}"`;
          if (instructions) combinedInstructions += '\n\n';
        }
        if (instructions) combinedInstructions += instructions;

        result = await executeModification(
          {
            originalImageUrl: displayImageUrl,
            redlineDataUrl,
            instructions: combinedInstructions,
            cardText: cardText ?? null,
            aspectRatio,
            resolution,
          },
          onUsage,
        );
      }

      setCurrentImageUrl(result.newImageUrl);
      const label = isContentOnly ? `Content Update ${modificationCount + 1}` : `Modification ${modificationCount + 1}`;
      pushVersion(result.newImageUrl, label);
      clearAll();
      select(null);
      setGlobalInstruction('');

      if (onImageModified && cardId) {
        const updatedVersions: ImageVersion[] = [
          ...versions.slice(0, currentIndex + 1),
          { imageUrl: result.newImageUrl, timestamp: Date.now(), label },
        ];
        while (updatedVersions.length > 10) updatedVersions.shift();
        onImageModified(cardId, result.newImageUrl, updatedVersions);
      }
    } catch (err: any) {
      log.error('Modification failed:', err);
      setModifyError(err.message || 'Modification failed. Please try again.');
    } finally {
      setIsModifying(false);
    }
  }, [
    canModify,
    isModifying,
    annotations,
    globalInstruction,
    contentDirty,
    currentContent,
    imageNaturals,
    displayImageUrl,
    cardText,
    cardId,
    style,
    palette,
    aspectRatio,
    resolution,
    onImageModified,
    onUsage,
    clearAll,
    select,
    pushVersion,
    modificationCount,
    versions,
    currentIndex,
  ]);

  // Refs to avoid stale closures in toolbar state callback
  const handleModifyRef = useRef(handleModify);
  handleModifyRef.current = handleModify;
  const handleZoomInRef = useRef(handleZoomIn);
  handleZoomInRef.current = handleZoomIn;
  const handleZoomOutRef = useRef(handleZoomOut);
  handleZoomOutRef.current = handleZoomOut;

  // Notify parent of toolbar state changes
  useEffect(() => {
    onToolbarStateChangeRef.current?.({
      activeTool,
      onToolChange: setActiveTool,
      annotationCount: annotations.length,
      onDiscardMarks: clearAll,
      onModify: () => handleModifyRef.current(),
      isModifying,
      activeColor,
      onColorChange: (color: string) => setActiveColor(color),
      palette: palette || undefined,
      contentDirty,
      hasSelection: !!selectedAnnotationId,
      onDeleteSelected: () => {
        if (selectedAnnotationId) remove(selectedAnnotationId);
      },
      zoomScale: zoomView.scale,
      onZoomIn: () => handleZoomInRef.current(),
      onZoomOut: () => handleZoomOutRef.current(),
      onZoomReset: handleZoomReset,
      onRequestFullscreen: isInline && onRequestFullscreen ? onRequestFullscreen : undefined,
      globalInstruction,
      onGlobalInstructionChange: (text: string) => setGlobalInstruction(text),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleZoomReset/isInline/onRequestFullscreen are stable or static; only toolbar-affecting state matters
  }, [
    activeTool,
    annotations.length,
    isModifying,
    activeColor,
    palette,
    contentDirty,
    selectedAnnotationId,
    clearAll,
    remove,
    zoomView.scale,
    globalInstruction,
  ]);

  // --- Mouse handlers ---
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (isEditing || isModifying) return;

      const norm = getNormCoords(e);
      const canvas = canvasRef.current;
      const coords = getCanvasCoords(e);

      // PAN: zoom tool + alt
      if (activeTool === 'zoom' && altHeld) {
        e.preventDefault();
        e.stopPropagation();
        panStartRef.current = { x: e.clientX, y: e.clientY, panX: zoomView.panX, panY: zoomView.panY };
        didPanRef.current = false;
        setZoomView((prev) => ({ ...prev, isPanning: true }));
        return;
      }

      // SELECT TOOL
      if (activeTool === 'select' && coords && canvas) {
        if (selectedAnnotationId) {
          const selAnn = annotations.find((a) => a.id === selectedAnnotationId);
          if (selAnn) {
            const img = imgRef.current;
            const logW = img ? img.offsetWidth : canvas.width;
            const logH = img ? img.offsetHeight : canvas.height;
            const handle = hitTestHandle(selAnn, coords.cx, coords.cy, logW, logH, zoomView.scale);
            if (handle && norm) {
              e.preventDefault();
              e.stopPropagation();
              dragStartRef.current = { annotationId: selectedAnnotationId, startNorm: norm, handle };
              setIsDragging(true);
              return;
            }
          }
        }
        const hitImg = imgRef.current;
        const hitLogW = hitImg ? hitImg.offsetWidth : canvas.width;
        const hitLogH = hitImg ? hitImg.offsetHeight : canvas.height;
        const hitId = hitTestAnnotation(annotations, coords.cx, coords.cy, hitLogW, hitLogH, zoomView.scale);
        if (hitId && norm) {
          e.preventDefault();
          e.stopPropagation();
          select(hitId);
          dragStartRef.current = { annotationId: hitId, startNorm: norm, handle: null };
          setIsDragging(true);
          return;
        }
        select(null);
        if (zoomView.scale > 1) {
          e.preventDefault();
          panStartRef.current = { x: e.clientX, y: e.clientY, panX: zoomView.panX, panY: zoomView.panY };
          didPanRef.current = false;
          setZoomView((prev) => ({ ...prev, isPanning: true }));
        }
        return;
      }

      // RECTANGLE TOOL
      if (activeTool === 'rectangle' && norm) {
        e.preventDefault();
        e.stopPropagation();
        rectStartRef.current = norm;
        setRubberBand({ type: 'rectangle', topLeft: norm, bottomRight: norm, color: activeColor });
        return;
      }

      // ARROW TOOL
      if (activeTool === 'arrow' && norm) {
        e.preventDefault();
        e.stopPropagation();
        arrowStartRef.current = norm;
        setRubberBand({ type: 'arrow', start: norm, end: norm, color: activeColor });
        return;
      }

      // SKETCH TOOL
      if (activeTool === 'sketch' && norm) {
        e.preventDefault();
        e.stopPropagation();
        isSketchingRef.current = true;
        sketchPointsRef.current = [norm];
        setRubberBand({ type: 'sketch', points: [norm], color: activeColor, strokeWidth: DEFAULT_SKETCH_STROKE_WIDTH });
        return;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- getCanvasCoords/getNormCoords are derived from zoomView which is already listed
    [activeTool, altHeld, zoomView, annotations, selectedAnnotationId, activeColor, isEditing, isModifying, select],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (panStartRef.current) {
        e.preventDefault();
        const dx = e.clientX - panStartRef.current.x;
        const dy = e.clientY - panStartRef.current.y;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) didPanRef.current = true;
        setZoomView((prev) => {
          const rawPanX = panStartRef.current!.panX + dx;
          const rawPanY = panStartRef.current!.panY + dy;
          const clamped = clampPan(rawPanX, rawPanY, prev.scale);
          return { ...prev, ...clamped };
        });
        return;
      }

      if (rectStartRef.current && activeTool === 'rectangle') {
        const norm = getNormCoords(e);
        if (!norm) return;
        const s = rectStartRef.current;
        setRubberBand({
          type: 'rectangle',
          topLeft: { x: Math.min(s.x, norm.x), y: Math.min(s.y, norm.y) },
          bottomRight: { x: Math.max(s.x, norm.x), y: Math.max(s.y, norm.y) },
          color: activeColor,
        });
        return;
      }

      if (arrowStartRef.current && activeTool === 'arrow') {
        const norm = getNormCoords(e);
        if (!norm) return;
        setRubberBand({ type: 'arrow', start: arrowStartRef.current, end: norm, color: activeColor });
        return;
      }

      if (isSketchingRef.current && activeTool === 'sketch') {
        const norm = getNormCoords(e);
        if (!norm) return;
        sketchPointsRef.current.push(norm);
        setRubberBand({
          type: 'sketch',
          points: [...sketchPointsRef.current],
          color: activeColor,
          strokeWidth: DEFAULT_SKETCH_STROKE_WIDTH,
        });
        return;
      }

      if (isDragging && dragStartRef.current) {
        const norm = getNormCoords(e);
        if (!norm) return;
        const { annotationId, startNorm, handle } = dragStartRef.current;
        const dx = norm.x - startNorm.x;
        const dy = norm.y - startNorm.y;

        if (handle) {
          const ann = annotations.find((a) => a.id === annotationId);
          if (ann && ann.type === 'rectangle') {
            const newRect = { ...ann };
            if (handle === 'tl') {
              newRect.topLeft = {
                x: Math.min(norm.x, ann.bottomRight.x - 0.01),
                y: Math.min(norm.y, ann.bottomRight.y - 0.01),
              };
            } else if (handle === 'tr') {
              newRect.topLeft = { ...ann.topLeft, y: Math.min(norm.y, ann.bottomRight.y - 0.01) };
              newRect.bottomRight = { ...ann.bottomRight, x: Math.max(norm.x, ann.topLeft.x + 0.01) };
            } else if (handle === 'bl') {
              newRect.topLeft = { ...ann.topLeft, x: Math.min(norm.x, ann.bottomRight.x - 0.01) };
              newRect.bottomRight = { ...ann.bottomRight, y: Math.max(norm.y, ann.topLeft.y + 0.01) };
            } else if (handle === 'br') {
              newRect.bottomRight = {
                x: Math.max(norm.x, ann.topLeft.x + 0.01),
                y: Math.max(norm.y, ann.topLeft.y + 0.01),
              };
            }
            update(annotationId, { topLeft: newRect.topLeft, bottomRight: newRect.bottomRight });
            dragStartRef.current = { ...dragStartRef.current, startNorm: norm };
          } else if (ann && ann.type === 'arrow') {
            if (handle === 'start') update(annotationId, { start: norm });
            else if (handle === 'end') update(annotationId, { end: norm });
            dragStartRef.current = { ...dragStartRef.current, startNorm: norm };
          }
        } else {
          moveAnnotation(annotationId, dx, dy);
          dragStartRef.current = { ...dragStartRef.current, startNorm: norm };
        }
        return;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- getNormCoords is derived from zoomView (captured via clampPan dep chain)
    [activeTool, activeColor, isDragging, annotations, update, moveAnnotation, clampPan],
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      if (panStartRef.current) {
        panStartRef.current = null;
        setZoomView((prev) => ({ ...prev, isPanning: false }));
        return;
      }

      if (rectStartRef.current && activeTool === 'rectangle') {
        const norm = getNormCoords(e);
        if (norm) {
          const s = rectStartRef.current;
          const tl: NormalizedPoint = { x: Math.min(s.x, norm.x), y: Math.min(s.y, norm.y) };
          const br: NormalizedPoint = { x: Math.max(s.x, norm.x), y: Math.max(s.y, norm.y) };
          if (br.x - tl.x >= MIN_RECT_SIZE && br.y - tl.y >= MIN_RECT_SIZE) {
            const newRect: RectangleAnnotation = {
              id: createAnnotationId(),
              type: 'rectangle',
              color: activeColor,
              createdAt: Date.now(),
              topLeft: tl,
              bottomRight: br,
              instruction: '',
            };
            add(newRect);
            setEditingRectId(newRect.id);
          }
        }
        rectStartRef.current = null;
        setRubberBand(null);
        return;
      }

      if (arrowStartRef.current && activeTool === 'arrow') {
        const norm = getNormCoords(e);
        if (norm) {
          const s = arrowStartRef.current;
          const length = Math.sqrt((norm.x - s.x) ** 2 + (norm.y - s.y) ** 2);
          if (length >= MIN_ARROW_LENGTH) {
            const newArrow: ArrowAnnotation = {
              id: createAnnotationId(),
              type: 'arrow',
              color: activeColor,
              createdAt: Date.now(),
              start: s,
              end: norm,
              instruction: '',
            };
            add(newArrow);
            setEditingArrowId(newArrow.id);
          }
        }
        arrowStartRef.current = null;
        setRubberBand(null);
        return;
      }

      if (isSketchingRef.current && activeTool === 'sketch') {
        const points = sketchPointsRef.current;
        if (points.length >= 2) {
          const simplified = simplifyPath(points, 0.003);
          const newSketch: SketchAnnotation = {
            id: createAnnotationId(),
            type: 'sketch',
            color: activeColor,
            createdAt: Date.now(),
            points: simplified,
            strokeWidth: DEFAULT_SKETCH_STROKE_WIDTH,
            instruction: '',
          };
          add(newSketch);
          setEditingSketchId(newSketch.id);
        }
        isSketchingRef.current = false;
        sketchPointsRef.current = [];
        setRubberBand(null);
        return;
      }

      if (isDragging) {
        dragStartRef.current = null;
        setIsDragging(false);
        return;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- getNormCoords is derived from zoomView/imgRef which are stable or already captured
    [activeTool, activeColor, isDragging, add],
  );

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (didPanRef.current) {
        didPanRef.current = false;
        return;
      }
      if (isEditing || isModifying) return;

      if (activeTool === 'zoom' && !altHeld) {
        const viewport = viewportRef.current;
        if (!viewport) return;
        const rect = viewport.getBoundingClientRect();
        const vx = e.clientX - rect.left;
        const vy = e.clientY - rect.top;
        if (ctrlHeld) zoomToward(vx, vy, zoomView.scale - ZOOM_STEP);
        else zoomToward(vx, vy, zoomView.scale + ZOOM_STEP);
        return;
      }

      if (activeTool === 'pin') {
        const norm = getNormCoords(e);
        if (!norm) return;
        const newPin: PinAnnotation = {
          id: createAnnotationId(),
          type: 'pin',
          color: activeColor,
          createdAt: Date.now(),
          position: norm,
          instruction: '',
        };
        add(newPin);
        setEditingPinId(newPin.id);
        return;
      }

      if (activeTool === 'select' && selectedAnnotationId) {
        const selAnn = annotations.find((a) => a.id === selectedAnnotationId);
        if (selAnn?.type === 'pin') setEditingPinId(selectedAnnotationId);
        else if (selAnn?.type === 'rectangle') setEditingRectId(selectedAnnotationId);
        else if (selAnn?.type === 'arrow') setEditingArrowId(selectedAnnotationId);
        else if (selAnn?.type === 'sketch') setEditingSketchId(selectedAnnotationId);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- getNormCoords is derived from zoomView.scale which is already listed
    [
      activeTool,
      altHeld,
      ctrlHeld,
      zoomView.scale,
      zoomToward,
      activeColor,
      add,
      selectedAnnotationId,
      annotations,
      isEditing,
      isModifying,
    ],
  );

  // --- Editor popover screen positions ---
  const getAnnotationScreenPos = (id: string): { x: number; y: number } => {
    const ann = annotations.find((a) => a.id === id);
    const img = imgRef.current;
    if (!ann || !img) return { x: 0, y: 0 };
    const imgRect = img.getBoundingClientRect();
    if (ann.type === 'pin') {
      return {
        x: imgRect.left + ann.position.x * img.offsetWidth * zoomView.scale,
        y: imgRect.top + ann.position.y * img.offsetHeight * zoomView.scale,
      };
    }
    if (ann.type === 'rectangle') {
      const midX = (ann.topLeft.x + ann.bottomRight.x) / 2;
      return {
        x: imgRect.left + midX * img.offsetWidth * zoomView.scale,
        y: imgRect.top + ann.topLeft.y * img.offsetHeight * zoomView.scale,
      };
    }
    if (ann.type === 'arrow') {
      const midX = (ann.start.x + ann.end.x) / 2;
      const midY = (ann.start.y + ann.end.y) / 2;
      return {
        x: imgRect.left + midX * img.offsetWidth * zoomView.scale,
        y: imgRect.top + midY * img.offsetHeight * zoomView.scale,
      };
    }
    if (ann.type === 'sketch' && ann.points.length > 0) {
      let minX = 1,
        maxX = 0,
        minY = 1;
      for (const p of ann.points) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
      }
      const midX = (minX + maxX) / 2;
      return {
        x: imgRect.left + midX * img.offsetWidth * zoomView.scale,
        y: imgRect.top + minY * img.offsetHeight * zoomView.scale,
      };
    }
    return { x: 0, y: 0 };
  };

  const getCursorClass = () => {
    if (isModifying) return 'zoom-tool-select';
    if (activeTool === 'zoom') {
      if (zoomView.isPanning) return 'zoom-tool-zoom alt-held panning';
      if (altHeld) return 'zoom-tool-zoom alt-held';
      if (ctrlHeld) return 'zoom-tool-zoom ctrl-held';
      return 'zoom-tool-zoom';
    }
    if (activeTool === 'select') return 'zoom-tool-select';
    if (activeTool === 'pin') return 'zoom-tool-pin';
    if (activeTool === 'text') return 'zoom-tool-select';
    if (activeTool === 'rectangle' || activeTool === 'arrow' || activeTool === 'sketch') return 'zoom-tool-crosshair';
    return 'zoom-tool-crosshair';
  };

  const handleColorChange = useCallback((color: string) => setActiveColor(color), []);

  const handleMouseLeave = useCallback(() => {
    panStartRef.current = null;
    if (rectStartRef.current) {
      rectStartRef.current = null;
      setRubberBand(null);
    }
    if (arrowStartRef.current) {
      arrowStartRef.current = null;
      setRubberBand(null);
    }
    if (isSketchingRef.current) {
      const points = sketchPointsRef.current;
      if (points.length >= 2) {
        const simplified = simplifyPath(points, 0.003);
        const sketchId = createAnnotationId();
        add({
          id: sketchId,
          type: 'sketch',
          color: activeColor,
          createdAt: Date.now(),
          points: simplified,
          strokeWidth: DEFAULT_SKETCH_STROKE_WIDTH,
          instruction: '',
        });
        setEditingSketchId(sketchId);
      }
      isSketchingRef.current = false;
      sketchPointsRef.current = [];
      setRubberBand(null);
    }
    if (isDragging) {
      dragStartRef.current = null;
      setIsDragging(false);
    }
    setZoomView((prev) => ({ ...prev, isPanning: false }));
  }, [activeColor, isDragging, add]);

  if (!displayImageUrl) return null;

  const editingPin = editingPinId
    ? (annotations.find((a) => a.id === editingPinId && a.type === 'pin') as PinAnnotation | undefined)
    : undefined;
  const editingRect = editingRectId
    ? (annotations.find((a) => a.id === editingRectId && a.type === 'rectangle') as RectangleAnnotation | undefined)
    : undefined;
  const editingArrow = editingArrowId
    ? (annotations.find((a) => a.id === editingArrowId && a.type === 'arrow') as ArrowAnnotation | undefined)
    : undefined;
  const editingSketch = editingSketchId
    ? (annotations.find((a) => a.id === editingSketchId && a.type === 'sketch') as SketchAnnotation | undefined)
    : undefined;

  const imageClasses = isInline
    ? 'block max-w-full max-h-full object-contain shadow-[0_0_0_1px_rgba(0,0,0,0.15),0_8px_32px_rgba(0,0,0,0.12)] dark:shadow-[0_0_0_1px_rgba(255,255,255,0.15),0_8px_32px_rgba(0,0,0,0.3)]'
    : 'max-w-[90vw] max-h-[85vh] object-contain shadow-[0_0_0_1px_rgba(0,0,0,0.15),0_50px_100px_rgba(0,0,0,0.1)] dark:shadow-[0_0_0_1px_rgba(255,255,255,0.15),0_50px_100px_rgba(0,0,0,0.3)]';

  return (
    <div className="relative w-full h-full" tabIndex={isInline ? 0 : undefined} style={{ outline: 'none' }}>
      {/* Top-right controls: version history + fullscreen */}
      <div className={`absolute top-3 right-3 z-[15] flex items-center space-x-2`}>
        {versions.length > 1 && (
          <>
            <button
              onClick={handleRestorePrevious}
              disabled={!canUndo || isModifying}
              title="Undo"
              aria-label="Undo"
              className={`w-7 h-7 flex items-center justify-center rounded-full transition-all ${
                canUndo && !isModifying
                  ? 'bg-white/80 dark:bg-zinc-900/80 backdrop-blur-sm border border-zinc-100 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200'
                  : 'bg-white/40 dark:bg-zinc-900/40 border border-zinc-50 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 opacity-40 cursor-not-allowed'
              }`}
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
              >
                <path d="M9 14L4 9l5-5" />
                <path d="M20 20v-7a4 4 0 0 0-4-4H4" />
              </svg>
            </button>
            <button
              onClick={handleRestoreNext}
              disabled={!canRedo || isModifying}
              title="Redo"
              aria-label="Redo"
              className={`w-7 h-7 flex items-center justify-center rounded-full transition-all ${
                canRedo && !isModifying
                  ? 'bg-white/80 dark:bg-zinc-900/80 backdrop-blur-sm border border-zinc-100 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200'
                  : 'bg-white/40 dark:bg-zinc-900/40 border border-zinc-50 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 opacity-40 cursor-not-allowed'
              }`}
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
              >
                <path d="M15 14l5-5-5-5" />
                <path d="M4 20v-7a4 4 0 0 1 4-4h12" />
              </svg>
            </button>
            <button
              onClick={() => setShowVersionStrip(!showVersionStrip)}
              title="Version History"
              className="text-[9px] font-bold text-zinc-600 dark:text-zinc-400 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-sm px-2 py-1.5 rounded-full border border-zinc-100 dark:border-zinc-700 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors"
            >
              v{currentIndex + 1}/{versions.length}
            </button>
          </>
        )}
      </div>

      {/* Version history thumbnail strip */}
      {showVersionStrip && versions.length > 1 && (
        <div
          className={`absolute top-12 right-3 z-[16] bg-white/95 dark:bg-zinc-900/95 backdrop-blur-xl rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-700 p-3 animate-in fade-in slide-in-from-top-2 duration-200 ${isInline ? 'max-w-[280px]' : 'max-w-[400px]'}`}
        >
          <div className="text-[9px] font-black uppercase tracking-[0.2em] text-black mb-2 px-1">Version History</div>
          <div className="flex items-center space-x-2 overflow-x-auto pb-1">
            {versions.map((v, i) => (
              <button
                key={`${v.timestamp}-${i}`}
                onClick={() => handleRestoreByIndex(i)}
                disabled={isModifying}
                title={`${v.label} — ${new Date(v.timestamp).toLocaleTimeString()}`}
                className={`relative shrink-0 w-10 h-10 rounded-lg overflow-hidden border-2 transition-all hover:scale-110 ${
                  i === currentIndex
                    ? 'border-[#2a9fd4] shadow-[0_0_0_2px_rgba(42,159,212,0.3)]'
                    : 'border-zinc-200 dark:border-zinc-700 hover:border-zinc-400 dark:hover:border-zinc-500'
                } ${isModifying ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
              >
                <img src={v.imageUrl} alt={v.label} className="w-full h-full object-cover" />
                {i === currentIndex && <div className="absolute inset-0 bg-[#2a9fd4]/10" />}
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between mt-1 px-1">
            <span className="text-[7px] text-zinc-500 dark:text-zinc-400">{versions[currentIndex]?.label}</span>
            <span className="text-[7px] text-zinc-500 dark:text-zinc-400">
              {versions[currentIndex] ? new Date(versions[currentIndex].timestamp).toLocaleTimeString() : ''}
            </span>
          </div>
        </div>
      )}

      {/* Modification overlay */}
      {isModifying && (
        <div className="absolute inset-0 z-[18] flex items-center justify-center bg-[#2a9fd4]/10 backdrop-blur-sm pointer-events-none">
          <div className="flex flex-col items-center space-y-3 animate-pulse">
            <div className="w-12 h-12 rounded-full border-4 border-[#2a9fd4] border-t-transparent animate-spin" />
            <span className="text-[11px] font-black uppercase tracking-[0.2em] text-zinc-600 dark:text-zinc-400">
              Refining...
            </span>
            <span className="text-[9px] text-zinc-500 dark:text-zinc-400 max-w-[240px] text-center">
              AI is applying your modifications
            </span>
          </div>
        </div>
      )}

      {/* Error toast */}
      {modifyError && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[20] bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 rounded-2xl px-4 py-2 flex items-center space-x-2 shadow-lg dark:shadow-black/30 animate-in fade-in slide-in-from-top-2 duration-300">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#E63946" strokeWidth="2.5">
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
          <span className="text-[10px] text-red-700 max-w-[300px]">{modifyError}</span>
          <button
            onClick={() => setModifyError(null)}
            className="text-red-400 hover:text-red-600 transition-colors ml-1"
            aria-label="Dismiss error"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Viewport */}
      <div
        ref={viewportRef}
        tabIndex={0}
        className={`relative w-full h-full overflow-hidden select-none outline-none ${getCursorClass()}`}
        onClick={handleClick}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
      >
        {/* Transform layer */}
        <div
          className={`absolute inset-0 flex items-center justify-center ${isInline ? 'p-4' : ''}`}
          style={{
            transform: `translate(${zoomView.panX}px, ${zoomView.panY}px) scale(${zoomView.scale})`,
            transformOrigin: '0 0',
            transition: zoomView.isPanning || isDragging || rubberBand ? 'none' : 'transform 0.2s ease-out',
          }}
        >
          <div className={`relative ${isInline ? 'max-w-full max-h-full' : 'inline-block'}`}>
            <img
              ref={imgRef}
              src={displayImageUrl}
              alt="Asset"
              draggable={false}
              onLoad={handleImageLoad}
              className={imageClasses}
              style={isInline && fittedSize ? { width: fittedSize.w, height: fittedSize.h } : undefined}
            />
            <canvas ref={canvasRef} className="absolute top-0 left-0 w-full h-full pointer-events-none" style={{}} />
            {overlay}
          </div>
        </div>
      </div>

      {/* Pin Editor Popover */}
      {editingPin && editingPinId && (
        <AnnotationEditorPopover
          type="pin"
          instruction={editingPin.instruction}
          position={getAnnotationScreenPos(editingPinId)}
          onSave={(instruction) => update(editingPinId, { instruction })}
          onDelete={() => {
            remove(editingPinId);
            setEditingPinId(null);
          }}
          onClose={() => setEditingPinId(null)}
        />
      )}

      {/* Rectangle Editor Popover */}
      {editingRect && editingRectId && (
        <AnnotationEditorPopover
          type="area"
          instruction={editingRect.instruction}
          position={getAnnotationScreenPos(editingRectId)}
          onSave={(instruction) => update(editingRectId, { instruction })}
          onDelete={() => {
            remove(editingRectId);
            setEditingRectId(null);
          }}
          onClose={() => setEditingRectId(null)}
        />
      )}

      {/* Arrow Editor Popover */}
      {editingArrow && editingArrowId && (
        <AnnotationEditorPopover
          type="area"
          instruction={editingArrow.instruction}
          position={getAnnotationScreenPos(editingArrowId)}
          onSave={(instruction) => update(editingArrowId, { instruction })}
          onDelete={() => {
            remove(editingArrowId);
            setEditingArrowId(null);
          }}
          onClose={() => setEditingArrowId(null)}
        />
      )}

      {/* Sketch Editor Popover */}
      {editingSketch && editingSketchId && (
        <AnnotationEditorPopover
          type="area"
          instruction={editingSketch.instruction}
          position={getAnnotationScreenPos(editingSketchId)}
          onSave={(instruction) => update(editingSketchId, { instruction })}
          onDelete={() => {
            remove(editingSketchId);
            setEditingSketchId(null);
          }}
          onClose={() => setEditingSketchId(null)}
        />
      )}

      {/* Annotation Toolbar: render inline only if parent doesn't handle it */}
      {!onToolbarStateChange && (
        <AnnotationToolbar
          activeTool={activeTool}
          onToolChange={setActiveTool}
          annotationCount={annotations.length}
          onDiscardMarks={clearAll}
          onModify={handleModify}
          isModifying={isModifying}
          activeColor={activeColor}
          onColorChange={handleColorChange}
          palette={palette || undefined}
          contentDirty={contentDirty}
          hasSelection={!!selectedAnnotationId}
          onDeleteSelected={() => {
            if (selectedAnnotationId) remove(selectedAnnotationId);
          }}
          globalInstruction={globalInstruction}
          onGlobalInstructionChange={setGlobalInstruction}
        />
      )}
    </div>
  );
};

export default AnnotationWorkbench;
