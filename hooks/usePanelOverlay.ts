import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Configuration for the panel overlay hook.
 */
export interface PanelOverlayConfig {
  /** Whether the panel is currently open (controlled by parent). */
  isOpen: boolean;
  /** Default width in pixels (or a dynamic expression). Reset on each open. */
  defaultWidth: number;
  /** Minimum width during resize drag. Defaults to 300. */
  minWidth?: number;
  /** External ref for overlay positioning. Falls back to stripRef if not provided. */
  anchorRef?: React.RefObject<HTMLElement | null>;
}

/**
 * Return value from the usePanelOverlay hook.
 */
export interface PanelOverlayState {
  /** Ref to attach to the strip button element (used for positioning). */
  stripRef: React.RefObject<HTMLButtonElement | null>;
  /** Whether the overlay should be rendered at all (true during open + close animation). */
  shouldRender: boolean;
  /** Whether the close animation is currently playing. */
  isClosing: boolean;
  /** Current overlay width in pixels (resizable). */
  overlayWidth: number;
  /** Mouse-down handler to attach to the resize drag handle. */
  handleResizeStart: (e: React.MouseEvent) => void;
  /** Inline style object for the overlay's position/size/animation. */
  overlayStyle: React.CSSProperties;
}

/**
 * Shared hook that manages the portal-based overlay panel pattern used by
 * ProjectsPanel, SourcesPanel, ChatPanel, and AutoDeckPanel.
 *
 * Encapsulates:
 * - Instant show/hide (no animation)
 * - Width state with reset-on-open
 * - Resize drag-handle logic (mouse listeners, cursor management)
 * - Overlay positioning via stripRef.getBoundingClientRect()
 */
export function usePanelOverlay({ isOpen, defaultWidth, minWidth = 300, anchorRef }: PanelOverlayConfig): PanelOverlayState {
  const stripRef = useRef<HTMLButtonElement>(null);
  const [overlayWidth, setOverlayWidth] = useState(defaultWidth);
  const isDragging = useRef(false);
  const [, setResizeTick] = useState(0);

  // ── Reset width on open ──
  useEffect(() => {
    if (isOpen) setOverlayWidth(defaultWidth);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only reset width when panel opens/closes, not when defaultWidth expression re-evaluates
  }, [isOpen]);

  // ── Re-compute overlay position on window resize ──
  useEffect(() => {
    if (!isOpen) return;
    const onResize = () => setResizeTick((t) => t + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [isOpen]);

  // ── Resize drag handler ──
  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDragging.current = true;
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'ew-resize';
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;cursor:ew-resize;';
      document.body.appendChild(overlay);
      const startX = e.clientX;
      const startW = overlayWidth;
      const onMove = (ev: MouseEvent) => {
        if (!isDragging.current) return;
        setOverlayWidth(Math.max(minWidth, startW + ev.clientX - startX));
      };
      const onUp = () => {
        isDragging.current = false;
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
        overlay.remove();
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [overlayWidth, minWidth],
  );

  // ── Overlay positioning style ──
  const anchor = anchorRef?.current ?? stripRef.current;
  const rect = anchor?.getBoundingClientRect();
  const overlayLeft = (rect?.right ?? 0) - 2;
  const overlayStyle: React.CSSProperties = {
    ...(!isOpen ? { display: 'none' } : undefined),
    top: rect?.top ?? 0,
    left: overlayLeft,
    height: rect?.height ?? 0,
    right: 0,
  };

  return {
    stripRef,
    shouldRender: isOpen,
    isClosing: false,
    overlayWidth,
    handleResizeStart,
    overlayStyle,
  };
}
