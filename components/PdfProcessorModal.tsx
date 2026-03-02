import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { createLogger } from '../utils/logger';
import { BookmarkNode, BookmarkSource } from '../types';

const log = createLogger('PdfProcessor');
import { useFocusTrap } from '../hooks/useFocusTrap';
import { useResizeDrag } from '../hooks/useResizeDrag';
import { headingsToBookmarks, writeBookmarksToPdf, countBookmarks } from '../utils/pdfBookmarks';
import { extractHeadingsWithGemini, fileToBase64 } from '../utils/fileProcessing';
import PdfViewer, { PdfViewerHandle } from './PdfViewer';
import { UnsavedChangesDialog } from './Dialogs';

// ── Types ──

export interface PdfProcessorResult {
  pdfBase64: string;
  bookmarks: BookmarkNode[];
  bookmarkSource: BookmarkSource;
}

interface PdfProcessorModalProps {
  file?: File;                          // For new uploads
  pdfBase64Input?: string;              // For existing documents
  fileName: string;
  onAccept: (result: PdfProcessorResult) => void;
  onCancel: () => void;
  onDiscard?: () => void;               // Remove PDF entirely (full cleanup)
  onConvertToMarkdown?: () => void;     // Switch to Gemini markdown conversion
}

// ── Cumulative word count (own + all descendants) ──

function cumulativeWordCount(node: BookmarkNode): number {
  let total = node.wordCount ?? 0;
  for (const child of node.children) total += cumulativeWordCount(child);
  return total;
}

// ── Read-only bookmark tree renderer (with word counts) ──

function renderBookmarkTree(
  nodes: BookmarkNode[],
  depth: number,
  viewerRef: React.RefObject<PdfViewerHandle | null>,
): React.ReactNode {
  return nodes.map((node) => (
    <div key={node.id} style={{ paddingLeft: depth * 14 }}>
      <button
        onClick={() => viewerRef.current?.scrollToPage(node.page)}
        className="w-full text-left flex items-center gap-1.5 px-2 py-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors group"
        title={`Go to page ${node.page}`}
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-400 dark:text-zinc-500 shrink-0">
          <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />
        </svg>
        <span className="text-[11px] text-zinc-700 dark:text-zinc-300 truncate flex-1">{node.title}</span>
        {(() => {
          const wc = cumulativeWordCount(node);
          return wc > 0 ? (
            <span className="text-[9px] text-zinc-400 dark:text-zinc-500 shrink-0 tabular-nums">{wc}w</span>
          ) : null;
        })()}
        <span className="text-[9px] text-zinc-400 dark:text-zinc-500 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">p.{node.page}</span>
      </button>
      {node.children && node.children.length > 0 && renderBookmarkTree(node.children, depth + 1, viewerRef)}
    </div>
  ));
}

// ── Component ──

const PdfProcessorModal: React.FC<PdfProcessorModalProps> = ({
  file,
  pdfBase64Input,
  fileName,
  onAccept,
  onCancel,
  onDiscard,
  onConvertToMarkdown,
}) => {
  // ── PDF data ──
  const [pdfBase64, setPdfBase64] = useState<string | null>(null);
  const [loadingPdf, setLoadingPdf] = useState(true);
  const [pdfError, setPdfError] = useState<string | null>(null);

  // ── Bookmarks ──
  const [bookmarks, setBookmarks] = useState<BookmarkNode[]>([]);
  const [bookmarkSource, setBookmarkSource] = useState<BookmarkSource>('manual');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisComplete, setAnalysisComplete] = useState(false);
  const [bookmarkError, setBookmarkError] = useState<string | null>(null);

  // ── Saving (baking bookmarks into PDF) ──
  const [isAccepting, setIsAccepting] = useState(false);

  // ── Unsaved changes dialog ──
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);

  // ── Viewer state ──
  const [pdfScale, setPdfScale] = useState(1.0);
  const [pdfPageInfo, setPdfPageInfo] = useState({ current: 1, total: 0 });
  const pdfViewerRef = useRef<PdfViewerHandle>(null);

  // ── Sidebar width ──
  const [sidebarWidth, handleResizeStart] = useResizeDrag({ initialWidth: 300, minWidth: 200, maxWidth: 600, direction: 'left' });

  // ── Step 1: Encode file to base64 on mount (skip if pdfBase64Input provided) ──
  useEffect(() => {
    if (pdfBase64Input) {
      setPdfBase64(pdfBase64Input);
      setLoadingPdf(false);
      return;
    }
    if (!file) {
      setPdfError('No PDF file or data provided.');
      setLoadingPdf(false);
      return;
    }
    let cancelled = false;
    setLoadingPdf(true);
    fileToBase64(file)
      .then((b64) => {
        if (!cancelled) {
          setPdfBase64(b64);
          setLoadingPdf(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setPdfError('Failed to read PDF file.');
          setLoadingPdf(false);
          log.error('Base64 encoding failed:', err);
        }
      });
    return () => { cancelled = true; };
  }, [file, pdfBase64Input]);

  // ── Step 2: Auto-analyze via Gemini once PDF is loaded ──
  useEffect(() => {
    if (!pdfBase64) return;

    let cancelled = false;
    setIsAnalyzing(true);
    setBookmarkError(null);

    (async () => {
      try {
        const headings = await extractHeadingsWithGemini(pdfBase64, fileName);
        if (!cancelled) {
          if (headings.length > 0) {
            const aiBookmarks = headingsToBookmarks(headings);
            setBookmarks(aiBookmarks);
            setBookmarkSource('ai_generated');
          } else {
            setBookmarkError('AI could not detect any headings in this PDF.');
          }
          setAnalysisComplete(true);
        }
      } catch (err) {
        if (!cancelled) {
          log.error('Gemini analysis failed:', err);
          setBookmarkError('Document analysis failed. You can convert to markdown instead.');
          setAnalysisComplete(true);
        }
      } finally {
        if (!cancelled) setIsAnalyzing(false);
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfBase64]);

  // ── Fit-to-height on initial load ──
  const hasAppliedInitialFit = useRef(false);
  useEffect(() => {
    if (pdfPageInfo.total > 0 && !hasAppliedInitialFit.current && pdfViewerRef.current) {
      hasAppliedInitialFit.current = true;
      const dims = pdfViewerRef.current.getFitDims();
      if (dims && dims.pageHeight > 0) {
        setPdfScale(Math.max(0.25, Math.min(3, dims.containerHeight / dims.pageHeight)));
      }
    }
  }, [pdfPageInfo.total]);

  // ── Save: bake bookmarks into PDF and return ──
  const handleSave = useCallback(async () => {
    if (!pdfBase64 || bookmarks.length === 0) return;
    setIsAccepting(true);
    try {
      let finalBase64 = pdfBase64;
      try {
        finalBase64 = await writeBookmarksToPdf(pdfBase64, bookmarks);
      } catch (err) {
        log.error('Failed to bake bookmarks, using original PDF:', err);
      }
      onAccept({ pdfBase64: finalBase64, bookmarks, bookmarkSource });
    } finally {
      setIsAccepting(false);
    }
  }, [pdfBase64, bookmarks, bookmarkSource, onAccept]);

  // ── Close with unsaved-changes check ──
  const handleClose = useCallback(() => {
    if (analysisComplete && bookmarks.length > 0) {
      setShowUnsavedDialog(true);
    } else if (onDiscard) {
      onDiscard();
    } else {
      onCancel();
    }
  }, [analysisComplete, bookmarks.length, onDiscard, onCancel]);

  const handleUnsavedSave = useCallback(async () => {
    setShowUnsavedDialog(false);
    await handleSave();
  }, [handleSave]);

  const handleUnsavedDiscard = useCallback(() => {
    setShowUnsavedDialog(false);
    onCancel();
  }, [onCancel]);

  const handleUnsavedCancel = useCallback(() => {
    setShowUnsavedDialog(false);
  }, []);

  // ── Focus trap ──
  const focusTrapRef = useFocusTrap<HTMLDivElement>({ onEscape: handleClose });

  // ── Render ──
  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 dark:bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        ref={focusTrapRef}
        role="dialog"
        aria-modal="true"
        aria-label="PDF Processor"
        className="flex flex-col w-full h-full max-w-7xl max-h-[94vh] my-[3vh] mx-4 bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl dark:shadow-black/30 overflow-hidden animate-in zoom-in-95 duration-300"
        style={{ boxShadow: '0 12px 48px rgba(0,0,0,0.25), 0 4px 16px rgba(0,0,0,0.15)' }}
      >
        {/* ── Header ── */}
        <div className="flex items-center h-11 px-4 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 shrink-0">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {/* PDF icon */}
            <div className="w-6 h-6 rounded bg-red-50 dark:bg-red-950 flex items-center justify-center shrink-0">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-red-500">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
            </div>
            <span className="text-[12px] font-semibold text-zinc-800 dark:text-zinc-200 truncate">{fileName}</span>
            {/* Source badge */}
            {!isAnalyzing && analysisComplete && (
              <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${
                bookmarkSource === 'ai_generated'
                  ? 'bg-violet-50 dark:bg-violet-950 text-violet-600 dark:text-violet-400'
                  : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400'
              }`}>
                {bookmarkSource === 'ai_generated' ? 'AI Generated' : bookmarks.length > 0 ? 'Manual' : 'No Bookmarks'}
              </span>
            )}
          </div>
          {/* Close button */}
          <button
            onClick={handleClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            aria-label="Close"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18" /><path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        {/* ── Body: Viewer + Sidebar ── */}
        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* PDF Viewer area */}
          <div className="flex-1 min-w-0 flex flex-col">
            {/* Mini toolbar */}
            <div className="flex items-center justify-center gap-2 px-3 py-1.5 border-b border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 shrink-0">
              {/* Zoom out */}
              <button
                onClick={() => setPdfScale((s) => Math.max(0.25, s - 0.25))}
                className="w-6 h-6 flex items-center justify-center rounded text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                title="Zoom out"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.3-4.3" /><path d="M8 11h6" />
                </svg>
              </button>
              {/* Zoom percentage */}
              <span className="text-[10px] text-zinc-500 dark:text-zinc-400 w-10 text-center font-mono">{Math.round(pdfScale * 100)}%</span>
              {/* Zoom in */}
              <button
                onClick={() => setPdfScale((s) => Math.min(3, s + 0.25))}
                className="w-6 h-6 flex items-center justify-center rounded text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                title="Zoom in"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.3-4.3" /><path d="M11 8v6" /><path d="M8 11h6" />
                </svg>
              </button>
              {/* Separator */}
              <div className="w-px h-4 bg-zinc-200 dark:bg-zinc-700" />
              {/* Fit to height */}
              <button
                onClick={() => {
                  const dims = pdfViewerRef.current?.getFitDims();
                  if (dims && dims.pageHeight > 0) setPdfScale(dims.containerHeight / dims.pageHeight);
                }}
                className="w-6 h-6 flex items-center justify-center rounded text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                title="Fit to height"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="6" y="3" width="12" height="18" rx="2" />
                </svg>
              </button>
              {/* Fit to width */}
              <button
                onClick={() => {
                  const dims = pdfViewerRef.current?.getFitDims();
                  if (dims && dims.pageWidth > 0) setPdfScale(dims.containerWidth / dims.pageWidth);
                }}
                className="w-6 h-6 flex items-center justify-center rounded text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                title="Fit to width"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="6" width="18" height="12" rx="2" />
                </svg>
              </button>
              {/* Separator */}
              <div className="w-px h-4 bg-zinc-200 dark:bg-zinc-700" />
              {/* Page indicator */}
              <span className="text-[10px] text-zinc-500 dark:text-zinc-400 font-mono">
                {pdfPageInfo.total > 0 ? `${pdfPageInfo.current} / ${pdfPageInfo.total}` : '–'}
              </span>
            </div>

            {/* Viewer */}
            <div className="flex-1 min-h-0">
              {loadingPdf ? (
                <div className="w-full h-full flex items-center justify-center">
                  <div className="flex flex-col items-center gap-2">
                    <div className="w-5 h-5 border-2 border-zinc-300 dark:border-zinc-600 border-t-blue-500 rounded-full animate-spin" />
                    <span className="text-[11px] text-zinc-500 dark:text-zinc-400">Reading PDF...</span>
                  </div>
                </div>
              ) : pdfError ? (
                <div className="w-full h-full flex items-center justify-center">
                  <span className="text-[12px] text-red-500">{pdfError}</span>
                </div>
              ) : pdfBase64 ? (
                <PdfViewer
                  ref={pdfViewerRef}
                  pdfBase64={pdfBase64}
                  scale={pdfScale}
                  rotation={0}
                  onPageChange={(current, total) => setPdfPageInfo({ current, total })}
                />
              ) : null}
            </div>
          </div>

          {/* Resize divider */}
          <div
            className="shrink-0 w-[5px] cursor-ew-resize group relative flex items-center justify-center"
            onMouseDown={handleResizeStart}
          >
            <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-zinc-200 dark:bg-zinc-600 group-hover:bg-zinc-400" />
            <div className="w-[5px] h-6 rounded-full bg-zinc-300 dark:bg-zinc-500 group-hover:bg-zinc-400 dark:group-hover:bg-zinc-300 transition-colors" />
          </div>

          {/* Bookmark sidebar */}
          <div className="shrink-0 flex flex-col bg-white dark:bg-zinc-900 border-l border-zinc-200 dark:border-zinc-700 overflow-hidden" style={{ width: sidebarWidth }}>
            {/* Sidebar header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 shrink-0">
              <div className="flex items-center gap-2">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-500">
                  <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />
                </svg>
                <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">Bookmarks</span>
              </div>
              <span className="text-[9px] text-zinc-400">
                {isAnalyzing ? 'Analyzing...' : bookmarks.length === 0 ? 'None' : `${countBookmarks(bookmarks)}`}
              </span>
            </div>

            {/* Status bar during analysis */}
            {isAnalyzing && (
              <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-100 dark:border-zinc-800 shrink-0">
                <div className="w-3 h-3 border-2 border-violet-300 border-t-violet-600 rounded-full animate-spin" />
                <span className="text-[10px] text-violet-600 dark:text-violet-400 font-medium">Analyzing document structure...</span>
              </div>
            )}

            {/* Content area — bookmark tree or loading/empty state */}
            {isAnalyzing ? (
              <div className="flex-1 flex flex-col items-center justify-center py-8">
                <div className="w-5 h-5 border-2 border-zinc-300 dark:border-zinc-600 border-t-violet-500 rounded-full animate-spin" />
                <span className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-2">Analyzing document structure...</span>
                <span className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-1">Extracting headings and word counts</span>
              </div>
            ) : bookmarks.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-300 dark:text-zinc-600 mb-2">
                  <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />
                </svg>
                <span className="text-[11px] text-zinc-500 dark:text-zinc-400">No headings detected</span>
                <span className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-1">Convert to markdown or discard this PDF</span>
                {bookmarkError && <span className="text-[10px] text-red-500 mt-2">{bookmarkError}</span>}
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto px-2 py-2">
                {bookmarkError && <div className="text-[10px] text-red-500 px-2 pb-2">{bookmarkError}</div>}
                {renderBookmarkTree(bookmarks, 0, pdfViewerRef)}
              </div>
            )}
          </div>
        </div>

        {/* ── Action Bar ── */}
        <div className="flex items-center justify-end gap-2 px-4 py-2.5 border-t border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 shrink-0">
          {analysisComplete && bookmarks.length === 0 && (
            <span className="text-[10px] text-amber-600 dark:text-amber-400 mr-auto">
              No headings detected — convert to markdown or discard
            </span>
          )}
          {/* Convert to Markdown + Discard — shown when no bookmarks after analysis */}
          {analysisComplete && bookmarks.length === 0 && onConvertToMarkdown && (
            <button
              onClick={onConvertToMarkdown}
              disabled={loadingPdf}
              className="text-[11px] px-4 py-1.5 rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Convert to Markdown
            </button>
          )}
          {analysisComplete && bookmarks.length === 0 && onDiscard && (
            <button
              onClick={onDiscard}
              disabled={loadingPdf}
              className="text-[11px] px-4 py-1.5 rounded-lg bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Discard PDF
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={loadingPdf || isAccepting || isAnalyzing || bookmarks.length === 0}
            className="text-[11px] px-4 py-1.5 rounded-lg bg-blue-500 text-white hover:bg-blue-600 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            {isAccepting ? (
              <>
                <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Saving...
              </>
            ) : (
              'Save'
            )}
          </button>
        </div>
      </div>

      {/* Unsaved changes dialog */}
      {showUnsavedDialog && (
        <UnsavedChangesDialog
          onSave={handleUnsavedSave}
          onDiscard={handleUnsavedDiscard}
          onCancel={handleUnsavedCancel}
          title="Unsaved bookmark changes"
          description="Bookmarks were generated but not saved. Save them to the PDF or discard."
          saveLabel="Save"
          discardLabel="Discard"
        />
      )}
    </div>,
    document.body,
  );
};

export default PdfProcessorModal;
