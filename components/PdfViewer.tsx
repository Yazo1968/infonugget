import React, { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { TextLayer } from 'pdfjs-dist';
import { loadPdfjs } from '../utils/pdfLoader';
import { base64ToUint8Array } from '../utils/pdfBookmarks';

export interface PdfViewerHandle {
  scrollToPage: (pageNum: number) => void;
  /** Scrolls to a heading by searching for its text in the text layer. If page is given, searches only that page; otherwise searches all rendered pages. */
  scrollToHeading: (text: string, page?: number) => void;
  /** Returns { pageWidth, pageHeight } at scale=1 for the current visible page, plus container dims */
  getFitDims: () => { pageWidth: number; pageHeight: number; containerWidth: number; containerHeight: number } | null;
  /** Returns currently selected text and the page it's on, or null */
  getSelectedText: () => { text: string; page: number } | null;
}

interface PdfViewerProps {
  pdfBase64: string;
  scale: number;
  rotation: number;
  onPageChange?: (pageNum: number, totalPages: number) => void;
  /** Fired when user selects text in the PDF via the text layer */
  onTextSelected?: (text: string, pageNum: number) => void;
}

interface PageInfo {
  pageNum: number;
  width: number;
  height: number;
}

const RENDER_BUFFER = 2; // render pages within +/- 2 of visible

const PdfViewer = forwardRef<PdfViewerHandle, PdfViewerProps>(
  ({ pdfBase64, scale, rotation, onPageChange, onTextSelected }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const pdfDocRef = useRef<PDFDocumentProxy | null>(null);
    const canvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map());
    const textLayerRefs = useRef<Map<number, HTMLDivElement>>(new Map());
    const renderTasksRef = useRef<Map<number, { cancel: () => void }>>(new Map());
    const textLayerInstancesRef = useRef<Map<number, TextLayer>>(new Map());
    const [pages, setPages] = useState<PageInfo[]>([]);
    const [visiblePage, setVisiblePage] = useState(1);
    const observerRef = useRef<IntersectionObserver | null>(null);
    const renderedStateRef = useRef<Map<number, { scale: number; rotation: number }>>(new Map());
    const renderTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
    const prevRenderParamsRef = useRef({ scale: 0, rotation: 0 });

    // Track selected text for imperative handle
    const selectedTextRef = useRef<{ text: string; page: number } | null>(null);

    // Lazy-loaded pdfjs-dist module (code-split)
    const pdfjsRef = useRef<typeof import('pdfjs-dist') | null>(null);
    const [pdfjsLoaded, setPdfjsLoaded] = useState(false);
    const [pdfjsError, setPdfjsError] = useState<string | null>(null);

    useImperativeHandle(ref, () => ({
      scrollToPage(pageNum: number) {
        const el = containerRef.current?.querySelector(`[data-page-number="${pageNum}"]`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      },
      scrollToHeading(text: string, page?: number) {
        const container = containerRef.current;
        if (!container) return;

        const needle = text.trim().toLowerCase();
        if (!needle) return;

        /** Search rendered text layer spans and scroll to best match */
        const searchAndScroll = (): boolean => {
          // Determine which pages to search
          const pagesToSearch: number[] = [];
          if (page != null) {
            pagesToSearch.push(page);
          } else {
            textLayerRefs.current.forEach((_, pn) => pagesToSearch.push(pn));
            pagesToSearch.sort((a, b) => a - b);
          }

          for (const pn of pagesToSearch) {
            const textDiv = textLayerRefs.current.get(pn);
            if (!textDiv || !textDiv.children.length) continue;

            const spans = textDiv.querySelectorAll('span:not(.markedContent)');
            let bestMatch: HTMLElement | null = null;
            let bestScore = 0;

            for (const span of spans) {
              const spanText = (span.textContent || '').trim().toLowerCase();
              if (!spanText) continue;

              if (spanText.includes(needle) || needle.includes(spanText)) {
                const score = spanText === needle ? 3 : spanText.includes(needle) ? 2 : 1;
                if (score > bestScore) {
                  bestScore = score;
                  bestMatch = span as HTMLElement;
                  if (score === 3) break;
                }
              }
            }

            if (bestMatch) {
              const containerRect = container.getBoundingClientRect();
              const spanRect = bestMatch.getBoundingClientRect();
              const scrollOffset = spanRect.top - containerRect.top + container.scrollTop;
              const targetScroll = scrollOffset - container.clientHeight / 3;
              container.scrollTo({ top: Math.max(0, targetScroll), behavior: 'smooth' });
              return true;
            }
          }
          return false;
        };

        // Try immediate search (works if page is already rendered)
        if (searchAndScroll()) return;

        // If page is known but text layer not rendered yet, scroll to page first
        // then retry after rendering catches up
        if (page != null) {
          const pageEl = container.querySelector(`[data-page-number="${page}"]`);
          if (pageEl) {
            pageEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
            // Retry after page renders (rendering triggered by IntersectionObserver)
            setTimeout(() => {
              if (!searchAndScroll()) {
                // Still no match — stay at page top (already scrolled there)
              }
            }, 600);
          }
        }
      },
      getFitDims() {
        if (pages.length === 0 || !containerRef.current) return null;
        const page = pages[visiblePage - 1] || pages[0];
        const rot = ((rotation % 360) + 360) % 360;
        const swapped = rot === 90 || rot === 270;
        return {
          pageWidth: swapped ? page.height : page.width,
          pageHeight: swapped ? page.width : page.height,
          containerWidth: containerRef.current.clientWidth,
          containerHeight: containerRef.current.clientHeight,
        };
      },
      getSelectedText() {
        return selectedTextRef.current;
      },
    }));

    // Load pdfjs-dist on mount (code-split)
    useEffect(() => {
      loadPdfjs()
        .then((mod) => {
          pdfjsRef.current = mod;
          setPdfjsLoaded(true);
        })
        .catch((err) => {
          console.error('Failed to load PDF viewer library:', err);
          setPdfjsError('Failed to load PDF viewer. Please refresh the page.');
        });
    }, []);

    // Load PDF document
    useEffect(() => {
      if (!pdfjsRef.current) return;
      let cancelled = false;

      const loadPdf = async () => {
        // Cancel any existing render tasks and clear cache
        renderTasksRef.current.forEach((task) => task.cancel());
        renderTasksRef.current.clear();
        renderedStateRef.current.clear();

        // Cancel any existing text layers
        textLayerInstancesRef.current.forEach((tl) => tl.cancel());
        textLayerInstancesRef.current.clear();

        // Destroy previous document
        if (pdfDocRef.current) {
          pdfDocRef.current.destroy();
          pdfDocRef.current = null;
        }

        const bytes = base64ToUint8Array(pdfBase64);

        const pdf = await pdfjsRef.current!.getDocument({ data: bytes }).promise;
        if (cancelled) {
          pdf.destroy();
          return;
        }

        pdfDocRef.current = pdf;

        // Get page dimensions for all pages
        const pageInfos: PageInfo[] = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale: 1, rotation: 0 });
          pageInfos.push({
            pageNum: i,
            width: viewport.width,
            height: viewport.height,
          });
        }
        if (cancelled) return;

        setPages(pageInfos);
        if (onPageChange) onPageChange(1, pdf.numPages);
      };

      loadPdf();
      return () => {
        cancelled = true;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps -- onPageChange is an event callback; including it would re-load the entire PDF on parent re-render
    }, [pdfBase64, pdfjsLoaded]);

    // Render a single page (canvas + text layer)
    const renderPage = useCallback(
      async (pageNum: number) => {
        const pdf = pdfDocRef.current;
        if (!pdf || !pdfjsRef.current) return;

        const canvas = canvasRefs.current.get(pageNum);
        if (!canvas) return;

        // Cancel existing render for this page
        const existingTask = renderTasksRef.current.get(pageNum);
        if (existingTask) existingTask.cancel();

        // Cancel existing text layer for this page
        const existingTextLayer = textLayerInstancesRef.current.get(pageNum);
        if (existingTextLayer) existingTextLayer.cancel();

        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale, rotation });

        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = viewport.width * dpr;
        canvas.height = viewport.height * dpr;
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const renderTask = page.render({
          canvas,
          canvasContext: ctx,
          viewport,
        });

        renderTasksRef.current.set(pageNum, { cancel: () => renderTask.cancel() });

        try {
          await renderTask.promise;
          renderTasksRef.current.delete(pageNum);
          renderedStateRef.current.set(pageNum, { scale, rotation });
        } catch (e: any) {
          if (e?.name !== 'RenderingCancelledException') {
            console.error(`Error rendering page ${pageNum}:`, e);
          }
          return; // Don't render text layer if canvas render failed
        }

        // Render text layer
        const textDiv = textLayerRefs.current.get(pageNum);
        if (textDiv) {
          textDiv.innerHTML = '';
          // Set CSS custom property for scale factor used by pdfjs textLayer CSS
          textDiv.style.setProperty('--total-scale-factor', String(scale));
          textDiv.style.width = `${viewport.width}px`;
          textDiv.style.height = `${viewport.height}px`;

          try {
            const textContent = await page.getTextContent();
            const textLayer = new pdfjsRef.current!.TextLayer({
              textContentSource: textContent,
              container: textDiv,
              viewport,
            });
            textLayerInstancesRef.current.set(pageNum, textLayer);
            await textLayer.render();
          } catch (e: any) {
            if (e?.name !== 'RenderingCancelledException') {
              console.error(`Error rendering text layer for page ${pageNum}:`, e);
            }
          }
        }
      },
      [scale, rotation],
    );

    // Set up IntersectionObserver for visible page detection
    useEffect(() => {
      if (pages.length === 0 || !containerRef.current) return;

      observerRef.current?.disconnect();

      const observer = new IntersectionObserver(
        (entries) => {
          let maxRatio = 0;
          let maxPage = visiblePage;
          entries.forEach((entry) => {
            if (entry.isIntersecting && entry.intersectionRatio > maxRatio) {
              maxRatio = entry.intersectionRatio;
              const pn = parseInt(entry.target.getAttribute('data-page-number') || '1');
              maxPage = pn;
            }
          });
          if (maxRatio > 0) {
            setVisiblePage(maxPage);
            if (onPageChange) onPageChange(maxPage, pages.length);
          }
        },
        {
          root: containerRef.current,
          threshold: [0, 0.25, 0.5, 0.75, 1],
        },
      );

      observerRef.current = observer;

      // Observe all page wrappers
      containerRef.current.querySelectorAll('[data-page-number]').forEach((el) => {
        observer.observe(el);
      });

      return () => observer.disconnect();
      // eslint-disable-next-line react-hooks/exhaustive-deps -- visiblePage is set by this effect's observer; including it would cause infinite re-observation
    }, [pages, onPageChange]);

    // Render visible pages and nearby pages (debounced for scroll, immediate for zoom/rotate)
    useEffect(() => {
      if (pages.length === 0) return;

      const paramsChanged = scale !== prevRenderParamsRef.current.scale
        || rotation !== prevRenderParamsRef.current.rotation;
      prevRenderParamsRef.current = { scale, rotation };

      const doRender = () => {
        const start = Math.max(1, visiblePage - RENDER_BUFFER);
        const end = Math.min(pages.length, visiblePage + RENDER_BUFFER);

        // Cancel renders that fell out of range
        renderTasksRef.current.forEach((task, pageNum) => {
          if (pageNum < start || pageNum > end) {
            task.cancel();
            renderTasksRef.current.delete(pageNum);
          }
        });

        for (let i = start; i <= end; i++) {
          const cached = renderedStateRef.current.get(i);
          if (cached && cached.scale === scale && cached.rotation === rotation) continue;
          renderPage(i);
        }
      };

      if (paramsChanged) {
        // Immediate render on zoom/rotate — invalidate cache
        renderedStateRef.current.clear();
        doRender();
      } else {
        // Debounce scroll-triggered renders to avoid pileup
        clearTimeout(renderTimeoutRef.current);
        renderTimeoutRef.current = setTimeout(doRender, 80);
      }
      return () => clearTimeout(renderTimeoutRef.current);
      // eslint-disable-next-line react-hooks/exhaustive-deps -- prevRenderParamsRef is a ref used for change detection, not a reactive dependency
    }, [visiblePage, pages, scale, rotation, renderPage]);

    // Handle text selection via mouseup on the container
    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      const handleMouseUp = () => {
        const sel = window.getSelection();
        const text = sel?.toString().trim();
        if (text) {
          // Determine which page the selection is in
          let pageNum = visiblePage;
          const anchorNode = sel?.anchorNode;
          if (anchorNode) {
            const pageWrapper = (anchorNode instanceof HTMLElement ? anchorNode : anchorNode.parentElement)?.closest(
              '[data-page-number]',
            );
            if (pageWrapper) {
              pageNum = parseInt(pageWrapper.getAttribute('data-page-number') || String(visiblePage));
            }
          }
          selectedTextRef.current = { text, page: pageNum };
          onTextSelected?.(text, pageNum);
        } else {
          selectedTextRef.current = null;
        }
      };

      container.addEventListener('mouseup', handleMouseUp);
      return () => container.removeEventListener('mouseup', handleMouseUp);
    }, [visiblePage, onTextSelected]);

    // Clean up on unmount
    useEffect(() => {
      const renderTasks = renderTasksRef.current;
      const textLayerInstances = textLayerInstancesRef.current;
      return () => {
        renderTasks.forEach((task) => task.cancel());
        renderTasks.clear();
        textLayerInstances.forEach((tl) => tl.cancel());
        textLayerInstances.clear();
        if (pdfDocRef.current) {
          pdfDocRef.current.destroy();
          pdfDocRef.current = null;
        }
      };
    }, []);

    const setCanvasRef = useCallback((pageNum: number, el: HTMLCanvasElement | null) => {
      if (el) canvasRefs.current.set(pageNum, el);
      else canvasRefs.current.delete(pageNum);
    }, []);

    const setTextLayerRef = useCallback((pageNum: number, el: HTMLDivElement | null) => {
      if (el) textLayerRefs.current.set(pageNum, el);
      else textLayerRefs.current.delete(pageNum);
    }, []);

    if (pdfjsError) {
      return (
        <div className="w-full h-full flex items-center justify-center bg-zinc-100 dark:bg-zinc-800/50">
          <p className="text-sm text-red-500">{pdfjsError}</p>
        </div>
      );
    }

    if (!pdfjsLoaded) {
      return (
        <div className="w-full h-full flex items-center justify-center bg-zinc-100 dark:bg-zinc-800/50">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading PDF viewer…</p>
        </div>
      );
    }

    return (
      <div ref={containerRef} className="w-full h-full overflow-auto bg-zinc-100 dark:bg-zinc-800/50">
        <div className="flex flex-col items-center gap-2 py-2 px-2">
          {pages.map((pageInfo) => {
            const viewport = getViewportDims(pageInfo, scale, rotation);
            return (
              <div
                key={pageInfo.pageNum}
                data-page-number={pageInfo.pageNum}
                className="bg-white dark:bg-zinc-900 shadow-sm relative"
                style={{
                  width: viewport.width,
                  height: viewport.height,
                }}
              >
                <canvas ref={(el) => setCanvasRef(pageInfo.pageNum, el)} />
                <div
                  ref={(el) => setTextLayerRef(pageInfo.pageNum, el)}
                  className="textLayer"
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>
    );
  },
);

PdfViewer.displayName = 'PdfViewer';

/** Calculate viewport dimensions for a page at given scale/rotation */
function getViewportDims(page: PageInfo, scale: number, rotation: number) {
  const rot = ((rotation % 360) + 360) % 360;
  const swapped = rot === 90 || rot === 270;
  return {
    width: (swapped ? page.height : page.width) * scale,
    height: (swapped ? page.width : page.height) * scale,
  };
}

export default PdfViewer;
