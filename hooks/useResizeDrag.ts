import { useState, useCallback, useRef } from 'react';

export interface UseResizeDragOptions {
  /** Starting width in pixels. */
  initialWidth: number;
  /** Minimum allowed width. */
  minWidth: number;
  /** Maximum allowed width. */
  maxWidth: number;
  /**
   * Drag direction that increases width:
   * - `'right'` — dragging right makes the panel wider (left-side panel)
   * - `'left'`  — dragging left makes the panel wider (right-side panel)
   */
  direction: 'left' | 'right';
}

/**
 * Shared resize-drag hook for sidebar panels.
 *
 * Creates a transparent overlay during drag (prevents iframe/canvas stealing events),
 * manages body cursor, and clamps width to [min, max].
 *
 * @returns `[width, onMouseDown]`
 */
export function useResizeDrag({ initialWidth, minWidth, maxWidth, direction }: UseResizeDragOptions): [number, (e: React.MouseEvent) => void] {
  const [width, setWidth] = useState(initialWidth);
  const isDragging = useRef(false);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDragging.current = true;
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'ew-resize';
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;cursor:ew-resize;';
      document.body.appendChild(overlay);
      const startX = e.clientX;
      const startW = width;
      const sign = direction === 'right' ? 1 : -1;
      const onMove = (ev: MouseEvent) => {
        if (!isDragging.current) return;
        setWidth(Math.max(minWidth, Math.min(maxWidth, startW + sign * (ev.clientX - startX))));
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
    [width, minWidth, maxWidth, direction],
  );

  return [width, onMouseDown];
}
