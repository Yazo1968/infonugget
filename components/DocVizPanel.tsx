import React, { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toPng } from 'html-to-image';
import { UploadedFile, DocVizProposal, DocVizData, StylingOptions, ZoomState } from '../types';
import { useThemeContext } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { usePanelOverlay } from '../hooks/usePanelOverlay';
import { useDocViz } from '../hooks/useDocViz';
import PanelRequirements from './PanelRequirements';
import StyleToolbar from './StyleToolbar';
import { exportDocVizToDocx } from '../utils/exportDocViz';
import { convertPdfBase64ToMarkdown } from '../utils/fileProcessing';
import { createLogger } from '../utils/logger';

const log = createLogger('DocVizPanel');

interface DocVizPanelProps {
  isOpen: boolean;
  tabBarRef?: React.RefObject<HTMLElement | null>;
  documents: UploadedFile[];
  menuDraftOptions: StylingOptions;
  setMenuDraftOptions: React.Dispatch<React.SetStateAction<StylingOptions>>;
  onOpenStyleStudio?: () => void;
  onZoomImage?: (state: ZoomState) => void;
}

const DocVizPanel: React.FC<DocVizPanelProps> = ({ isOpen, tabBarRef, documents, menuDraftOptions, setMenuDraftOptions, onOpenStyleStudio, onZoomImage }) => {
  const { darkMode } = useThemeContext();
  const { profile } = useAuth();
  const isDevMode = profile?.devMode ?? false;
  const { shouldRender, overlayStyle } = usePanelOverlay({
    isOpen,
    defaultWidth: Math.min(window.innerWidth * 0.5, 700),
    minWidth: 300,
    anchorRef: tabBarRef,
  });
  const { proposals, status, error, selectedDocId, setSelectedDocId, analyse, abort, reset, persistedResult, generatingRows, generateGraphic, deleteGraphic, deleteSectionProposals, deleteProposal, renameProposal } = useDocViz();

  // Active section — which section's proposals are shown on the right
  const [activeSectionTitle, setActiveSectionTitle] = useState<string | null>(null);
  // Generate dropdown menu
  const [showGenerateMenu, setShowGenerateMenu] = useState(false);
  // Section kebab menu
  const [sectionMenuTitle, setSectionMenuTitle] = useState<string | null>(null);
  // Proposal row kebab menu (proposal index)
  const [rowMenuIndex, setRowMenuIndex] = useState<number | null>(null);
  // Dismiss inline error
  const [dismissedError, setDismissedError] = useState<string | null>(null);
  // Rename state
  const [renamingIndex, setRenamingIndex] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // Refs for capturing screenshots of data sections
  const dataRefs = useRef<Record<number, HTMLDivElement | null>>({});

  // Track which visual type is selected per row
  const [selectedTypes, setSelectedTypes] = useState<Record<number, string>>({});
  // Track which rows are expanded
  const [expandedRows, setExpandedRows] = useState<Record<number, boolean>>({});
  // Track selected rows (checkboxes)
  const [selectedRows, setSelectedRows] = useState<Record<number, boolean>>({});
  // Active proposal index — explicitly set by clicking a row
  const [activeProposalIndex, setActiveProposalIndex] = useState<number | null>(null);
  const [prevProposalCount, setPrevProposalCount] = useState(0);
  if (proposals.length !== prevProposalCount) {
    setPrevProposalCount(proposals.length);
    setSelectedTypes({});
    setExpandedRows({});
    setSelectedRows({});
    setActiveProposalIndex(null);
  }

  const allSelected = proposals.length > 0 && proposals.every((_, i) => selectedRows[i]);
  const someSelected = proposals.some((_, i) => selectedRows[i]);

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedRows({});
    } else {
      const all: Record<number, boolean> = {};
      proposals.forEach((_, i) => { all[i] = true; });
      setSelectedRows(all);
    }
  };

  const toggleSelectRow = (idx: number) => {
    setSelectedRows((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  const toggleRow = (idx: number) => {
    setExpandedRows((prev) => ({ ...prev, [idx]: !prev[idx] }));
    setActiveProposalIndex(idx);
  };

  /** Capture a screenshot of a proposal's data section */
  const captureDataScreenshot = async (rowIdx: number): Promise<string> => {
    const el = dataRefs.current[rowIdx];
    if (!el) throw new Error('Data section not rendered — expand the row first');
    const dataUrl = await toPng(el, {
      backgroundColor: '#ffffff',
      pixelRatio: 2,
      cacheBust: true,
      skipFonts: true,
    });
    // Return base64 without the data:image/png;base64, prefix
    return dataUrl.replace(/^data:image\/\w+;base64,/, '');
  };

  const handleGenerate = async (proposal: DocVizProposal, rowIdx: number) => {
    const activeType = selectedTypes[rowIdx] ?? proposal.visual_type;
    // Ensure row is expanded so the data section is rendered for screenshot
    setExpandedRows((prev) => ({ ...prev, [rowIdx]: true }));
    // Wait for DOM to render the expanded section
    await new Promise((r) => setTimeout(r, 100));
    try {
      const screenshot = await captureDataScreenshot(rowIdx);
      log.info(`Screenshot captured for proposal ${rowIdx}: ${Math.round(screenshot.length / 1024)} KB`);
      await generateGraphic(rowIdx, activeType, menuDraftOptions, screenshot);
    } catch (err) {
      log.error('Screenshot capture failed:', err);
    }
  };

  const isAnyGenerating = Object.values(generatingRows).some(Boolean);

  const handleGenerateSelected = async () => {
    const selected = proposals
      .map((p, i) => ({ proposal: p, index: i }))
      .filter(({ index }) => selectedRows[index]);
    if (selected.length === 0) return;

    for (const { proposal, index } of selected) {
      const activeType = selectedTypes[index] ?? proposal.visual_type;
      setExpandedRows((prev) => ({ ...prev, [index]: true }));
      await new Promise((r) => setTimeout(r, 100));
      try {
        const screenshot = await captureDataScreenshot(index);
        await generateGraphic(index, activeType, menuDraftOptions, screenshot);
      } catch (err) {
        log.error(`Screenshot capture failed for proposal ${index}:`, err);
      }
    }
  };

  const [exporting, setExporting] = useState(false);

  const handleExportDocx = async () => {
    if (!selectedDoc || !persistedResult) return;
    setExporting(true);
    try {
      // Get markdown content — convert PDF on the fly if needed
      let markdown = selectedDoc.content || '';
      if (!markdown && selectedDoc.pdfBase64) {
        log.info('Converting PDF to markdown for export...');
        markdown = await convertPdfBase64ToMarkdown(selectedDoc.pdfBase64);
      }
      if (!markdown) {
        log.error('No content available for export');
        setExporting(false);
        return;
      }

      const count = await exportDocVizToDocx({
        documentName: selectedDoc.name,
        markdownContent: markdown,
        proposals,
      });
      log.info(`Export complete: ${count} visuals inserted`);
    } catch (err) {
      log.error('Export failed:', err);
    } finally {
      setExporting(false);
    }
  };

  const hasAnyImages = proposals.some((p) => p.imageUrl);

  const borderColor = darkMode ? 'rgba(100,160,230,0.25)' : 'rgba(30,90,180,0.2)';
  const textPrimary = darkMode ? 'text-zinc-200' : 'text-zinc-800';
  const textSecondary = darkMode ? 'text-zinc-400' : 'text-zinc-500';
  const hintColor = darkMode ? 'text-zinc-500' : 'text-zinc-400';
  const selectBg = darkMode ? 'bg-zinc-800/50' : 'bg-zinc-50';
  const selectBorder = darkMode ? 'border-zinc-700' : 'border-zinc-200';
  const cellBorder = darkMode ? 'border-zinc-700/50' : 'border-zinc-200';
  const hoverBg = darkMode ? 'hover:bg-zinc-800/40' : 'hover:bg-zinc-50/80';
  const miniHeaderBg = darkMode ? 'bg-zinc-800' : 'bg-zinc-100';

  // Documents available for analysis (have content or fileId)
  const availableDocs = useMemo(
    () => documents.filter((d) => d.fileId || d.content || d.pdfBase64),
    [documents],
  );

  const selectedDoc = useMemo(
    () => availableDocs.find((d) => d.id === selectedDocId) ?? null,
    [availableDocs, selectedDocId],
  );

  // Extract top-level headings from selected document's bookmarks
  const topHeadings = useMemo(() => {
    if (!selectedDoc?.bookmarks?.length) return [];
    // Get level-1 headings (or the minimum level present)
    const minLevel = Math.min(...selectedDoc.bookmarks.map((b) => b.level));
    return selectedDoc.bookmarks.filter((b) => b.level === minLevel);
  }, [selectedDoc]);

  const handleAnalyse = (sections?: string[]) => {
    if (selectedDoc) analyse(selectedDoc, sections);
  };

  // Download section proposals as JSON
  const handleDownloadSectionProposals = (sectionTitle: string) => {
    const sectionProposals = proposals.filter((p) => p.section_ref === sectionTitle);
    if (sectionProposals.length === 0) return;
    const blob = new Blob([JSON.stringify(sectionProposals, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `docviz-${sectionTitle.replace(/[^a-zA-Z0-9-_ ]/g, '')}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setSectionMenuTitle(null);
  };


  const handleGenerateActive = async () => {
    if (activeProposalIndex == null) return;
    const p = proposals[activeProposalIndex];
    const activeType = selectedTypes[activeProposalIndex] ?? p.visual_type;
    try {
      const screenshot = await captureDataScreenshot(activeProposalIndex);
      await generateGraphic(activeProposalIndex, activeType, menuDraftOptions, screenshot);
    } catch (err) {
      log.error(`Screenshot capture failed for active proposal ${activeProposalIndex}:`, err);
    }
  };

  // Proposals filtered by active section
  const filteredProposals = useMemo(() => {
    if (!activeSectionTitle) return proposals;
    return proposals.filter((p) => p.section_ref === activeSectionTitle);
  }, [proposals, activeSectionTitle]);

  // Which sections have been analyzed (have proposals)
  const analyzedSections = useMemo(() => {
    const refs = new Set(proposals.map((p) => p.section_ref));
    return refs;
  }, [proposals]);

  // ── Visual type badge color ──
  const typeBadgeColor = darkMode ? 'bg-blue-900/50 text-blue-300 border-blue-700/50' : 'bg-blue-50 text-blue-700 border-blue-200';

  // ── Universal data table renderer ──
  const renderData = (data: DocVizData) => {
    if (!data?.headers?.length || !data?.rows?.length) {
      return <span className={`text-[10px] ${hintColor}`}>No data</span>;
    }
    return (
      <div className={`border ${cellBorder} rounded overflow-hidden`}>
        {/* Header row */}
        <div className={`flex ${miniHeaderBg}`}>
          {data.headers.map((h, i) => (
            <div key={i} className={`flex-1 px-2 py-1 text-[10px] font-medium ${textSecondary} ${i < data.headers.length - 1 ? `border-r ${cellBorder}` : ''}`}>
              {h}
            </div>
          ))}
        </div>
        {/* Data rows */}
        {data.rows.map((row, ri) => (
          <div key={ri} className={`flex border-t ${cellBorder}`}>
            {row.map((cell, ci) => (
              <div key={ci} className={`flex-1 px-2 py-1 text-[11px] ${textPrimary} ${ci < row.length - 1 ? `border-r ${cellBorder}` : ''}`}>
                {cell ?? '—'}
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  };

  // ── Render: Idle state ──
  const renderIdle = () => (
    <div className="flex-1 flex flex-col items-center justify-center px-8 gap-4">
      <PanelRequirements level="sources" />
      {availableDocs.length > 0 && (
        <>
          <div className="w-10 h-10 bg-zinc-100 dark:bg-zinc-800/50 rounded-full flex items-center justify-center mb-1">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={textSecondary}>
              <path d="M3 3v18h18" />
              <path d="M7 16l4-8 4 5 5-6" />
            </svg>
          </div>
          <p className={`text-[12px] ${textSecondary} text-center max-w-xs`}>
            Select a document to analyse. DocViz will identify sections that would benefit from charts, diagrams, or graphs.
          </p>
          <select
            value={selectedDocId ?? ''}
            onChange={(e) => { setSelectedDocId(e.target.value || null); setActiveSectionTitle(null); }}
            className={`w-full max-w-xs px-3 py-2 rounded-lg text-[12px] border ${selectBorder} ${selectBg} ${textPrimary} focus:outline-none focus:ring-1 focus:ring-blue-500`}
          >
            <option value="">Choose a document...</option>
            {availableDocs.map((doc) => (
              <option key={doc.id} value={doc.id}>
                {doc.sourceType === 'native-pdf' ? 'PDF: ' : 'MD: '}{doc.name}
              </option>
            ))}
          </select>
        </>
      )}
    </div>
  );

  // ── Render: Analysing state ──
  const renderAnalysing = () => (
    <div className="flex-1 flex flex-col items-center justify-center px-8 gap-5">
      <div
        className="w-10 h-10 rounded-full border-[3px]"
        style={{
          borderColor: darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
          borderTopColor: darkMode ? '#4db8e0' : '#2289b5',
          animation: 'spin 0.8s linear infinite',
        }}
      />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <div className={`text-[13px] font-semibold ${textPrimary}`}>Analysing document...</div>
      <div className={`text-[11px] ${hintColor}`}>
        Scanning for visual opportunities in {selectedDoc?.name ?? 'document'}
      </div>
      <button
        onClick={abort}
        className="px-4 py-1 rounded-full text-[11px] font-medium border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
      >
        Abort
      </button>
    </div>
  );

  // ── Render: Error state ──
  const renderError = () => (
    <div className="flex-1 flex flex-col items-center justify-center px-8 gap-4">
      <div className="w-10 h-10 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-red-500">
          <circle cx="12" cy="12" r="10" />
          <line x1="15" y1="9" x2="9" y2="15" />
          <line x1="9" y1="9" x2="15" y2="15" />
        </svg>
      </div>
      <p className="text-[12px] text-red-600 dark:text-red-400 text-center max-w-xs">{error}</p>
      <button
        onClick={() => reset()}
        className="px-4 py-1 rounded-full text-[11px] font-medium border border-zinc-300 dark:border-zinc-600 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
      >
        Try Again
      </button>
    </div>
  );

  // ── Render: Done state (proposals table) ──
  const renderDone = () => (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Results header bar */}
      <div className={`shrink-0 flex items-center justify-between px-4 py-2 border-b ${cellBorder}`}>
        <div className="flex items-center gap-2">
          <span className={`text-[12px] font-medium ${textPrimary}`}>
            {filteredProposals.length} visual{filteredProposals.length !== 1 ? 's' : ''}{activeSectionTitle ? ` for "${activeSectionTitle}"` : ' proposed'}
          </span>
          <span className={`text-[11px] ${textSecondary}`}>
            from {persistedResult?.documentName ?? selectedDoc?.name}
          </span>
        </div>
        <button
          onClick={() => reset()}
          className={`text-[10px] font-medium px-2.5 py-1 rounded border ${selectBorder} ${darkMode ? 'hover:bg-zinc-800 text-zinc-400' : 'hover:bg-zinc-100 text-zinc-500'} transition-colors`}
        >
          New Analysis
        </button>
      </div>

      {proposals.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center py-12 gap-3">
          <div className={`text-[12px] ${textSecondary}`}>No visual opportunities found in this document.</div>
          <button
            onClick={() => reset()}
            className="px-4 py-1 rounded-full text-[11px] font-medium border border-zinc-300 dark:border-zinc-600 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
          >
            Try Another Document
          </button>
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
          <div className="max-w-2xl mx-auto">
            {/* Table header */}
            <div className={`flex items-center ${miniHeaderBg} rounded-t-lg border ${cellBorder}`}>
              {/* Select all checkbox */}
              <div className="w-8 shrink-0 flex items-center justify-center">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
                  onChange={toggleSelectAll}
                  className="w-3.5 h-3.5 rounded border-zinc-300 dark:border-zinc-600 accent-blue-600 cursor-pointer"
                />
              </div>
              <div className="w-6 shrink-0" />
              <div className={`flex-1 px-2.5 py-2 text-[10px] font-medium uppercase tracking-wider ${textSecondary} border-r ${cellBorder}`}>Visual</div>
              <div className={`flex-1 px-2.5 py-2 text-[10px] font-medium uppercase tracking-wider ${textSecondary} border-r ${cellBorder}`}>Type</div>
              <div className="w-[40px] shrink-0" />
            </div>

            {/* Table rows */}
            {filteredProposals.map((p, fi) => {
              // Map back to original index in full proposals array
              const i = proposals.indexOf(p);
              const hasAlts = p.alternative_types && p.alternative_types.length > 0;
              const activeType = selectedTypes[i] ?? p.visual_type;
              const isExpanded = !!expandedRows[i];
              const isActiveRow = activeProposalIndex === i;

              return (
                <div key={i} className={`border-l border-r border-b ${cellBorder} ${fi === filteredProposals.length - 1 ? 'rounded-b-lg' : ''} ${isActiveRow ? 'ring-1 ring-blue-400 dark:ring-blue-600' : ''}`}>
                  {/* Compact row — clickable */}
                  <div
                    className={`flex items-center cursor-pointer select-none ${hoverBg} transition-colors`}
                    onClick={() => toggleRow(i)}
                  >
                    {/* Checkbox */}
                    <div className="w-8 shrink-0 flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={!!selectedRows[i]}
                        onChange={() => toggleSelectRow(i)}
                        className="w-3.5 h-3.5 rounded border-zinc-300 dark:border-zinc-600 accent-blue-600 cursor-pointer"
                      />
                    </div>
                    {/* Chevron */}
                    <div
                      className="w-6 shrink-0 flex items-center justify-center self-stretch"
                      style={{ backgroundColor: darkMode ? (i % 2 === 0 ? 'rgb(26,54,96)' : 'rgb(20,42,75)') : (i % 2 === 0 ? 'rgb(195,218,245)' : 'rgb(220,233,250)') }}
                    >
                      <svg
                        width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                        className={`${textSecondary} transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                      >
                        <path d="M3.5 2L6.5 5L3.5 8" />
                      </svg>
                    </div>
                    {/* Title */}
                    <div className={`flex-1 px-2.5 py-2.5 text-[11px] font-medium ${textPrimary} leading-snug border-r ${cellBorder}`} onClick={(e) => { if (renamingIndex === i) e.stopPropagation(); }}>
                      {renamingIndex === i ? (
                        <input
                          autoFocus
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { renameProposal(i, renameValue); setRenamingIndex(null); }
                            if (e.key === 'Escape') setRenamingIndex(null);
                          }}
                          onBlur={() => { renameProposal(i, renameValue); setRenamingIndex(null); }}
                          className={`w-full text-[11px] px-1.5 py-0.5 rounded border border-blue-400 outline-none bg-transparent ${textPrimary}`}
                        />
                      ) : (
                        p.visual_title
                      )}
                    </div>
                    {/* Type — dropdown or badge */}
                    <div className={`flex-1 px-2.5 py-2.5 border-r ${cellBorder}`} onClick={(e) => e.stopPropagation()}>
                      {hasAlts ? (
                        <select
                          value={activeType}
                          onChange={(e) => setSelectedTypes((prev) => ({ ...prev, [i]: e.target.value }))}
                          className={`w-full text-[10px] font-medium px-1.5 py-1 rounded border ${selectBorder} ${selectBg} ${textPrimary} focus:outline-none focus:ring-1 focus:ring-blue-500`}
                        >
                          <option value={p.visual_type}>{p.visual_type}</option>
                          {p.alternative_types!.map((alt, ai) => (
                            <option key={ai} value={alt}>{alt}</option>
                          ))}
                        </select>
                      ) : (
                        <span className={`inline-block text-[10px] font-medium px-2 py-0.5 rounded-full border ${typeBadgeColor}`}>
                          {p.visual_type}
                        </span>
                      )}
                    </div>
                    {/* Row kebab menu */}
                    <div className="w-[40px] shrink-0 flex items-center justify-center relative" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => setRowMenuIndex(rowMenuIndex === i ? null : i)}
                        className={`w-6 h-6 flex items-center justify-center rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors ${textSecondary}`}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" /></svg>
                      </button>
                      {rowMenuIndex === i && (
                        <>
                          <div className="fixed inset-0 z-[129]" onClick={() => setRowMenuIndex(null)} />
                          <div className={`absolute right-0 top-full mt-1 z-[130] min-w-[140px] rounded-lg border shadow-lg ${darkMode ? 'bg-zinc-800 border-zinc-700' : 'bg-white border-zinc-200'}`}>
                            <button
                              onClick={() => { setRowMenuIndex(null); handleGenerate(p, i); }}
                              disabled={!!generatingRows[i]}
                              className={`w-full text-left px-3 py-2 text-[11px] rounded-t-lg transition-colors disabled:opacity-40 ${darkMode ? 'hover:bg-zinc-700 text-zinc-200' : 'hover:bg-zinc-50 text-zinc-700'}`}
                            >
                              {generatingRows[i] ? 'Generating...' : p.imageUrl ? 'Regenerate' : 'Generate'}
                            </button>
                            <button
                              onClick={() => { setRowMenuIndex(null); setRenamingIndex(i); setRenameValue(p.visual_title); }}
                              className={`w-full text-left px-3 py-2 text-[11px] border-t ${cellBorder} transition-colors ${darkMode ? 'hover:bg-zinc-700 text-zinc-200' : 'hover:bg-zinc-50 text-zinc-700'}`}
                            >
                              Rename
                            </button>
                            <button
                              onClick={() => { setRowMenuIndex(null); deleteProposal(i); }}
                              className={`w-full text-left px-3 py-2 text-[11px] border-t ${cellBorder} rounded-b-lg transition-colors text-red-500 ${darkMode ? 'hover:bg-red-900/20' : 'hover:bg-red-50'}`}
                            >
                              Delete
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Expanded detail — stacked: description, data table, then image */}
                  {isExpanded && (
                    <div className={`border-t ${cellBorder} px-4 py-3`}>
                      {/* Data section — captured as screenshot for image generation */}
                      <div ref={(el) => { dataRefs.current[i] = el; }} className="mb-3">
                        <div className={`text-[11px] ${textSecondary} mb-3 leading-relaxed`}>{p.description}</div>
                        {renderData(p.data)}
                      </div>
                      {/* Generated image */}
                      {(p.imageUrl || generatingRows[i]) && (
                        <div>
                            {generatingRows[i] ? (
                              <div className="flex flex-col items-center gap-2 py-6">
                                <div
                                  className="w-8 h-8 rounded-full border-[3px]"
                                  style={{
                                    borderColor: darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
                                    borderTopColor: darkMode ? '#4db8e0' : '#2289b5',
                                    animation: 'spin 0.8s linear infinite',
                                  }}
                                />
                                <span className={`text-[10px] ${hintColor}`}>Generating...</span>
                              </div>
                            ) : (
                              <div className="w-full relative group/img">
                                <img
                                  src={p.imageUrl}
                                  alt={p.visual_title}
                                  className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700"
                                />
                                {/* Hover overlay with icon buttons */}
                                <div className="absolute inset-0 rounded-lg bg-black/0 group-hover/img:bg-black/40 transition-colors flex items-center justify-center gap-3 opacity-0 group-hover/img:opacity-100">
                                  {/* Zoom */}
                                  <button
                                    onClick={() => onZoomImage?.({ imageUrl: p.imageUrl!, cardId: null, cardText: null, palette: menuDraftOptions.palette, aspectRatio: menuDraftOptions.aspectRatio, resolution: menuDraftOptions.resolution })}
                                    title="Zoom"
                                    className="w-8 h-8 rounded-full bg-white/90 dark:bg-zinc-800/90 flex items-center justify-center hover:bg-white dark:hover:bg-zinc-700 transition-colors shadow-md"
                                  >
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-700 dark:text-zinc-300">
                                      <circle cx="11" cy="11" r="8" />
                                      <line x1="21" y1="21" x2="16.65" y2="16.65" />
                                      <line x1="11" y1="8" x2="11" y2="14" />
                                      <line x1="8" y1="11" x2="14" y2="11" />
                                    </svg>
                                  </button>
                                  {/* Download */}
                                  <a
                                    href={p.imageUrl}
                                    download={`${p.visual_title.replace(/[^a-zA-Z0-9-_ ]/g, '')}.png`}
                                    title="Download"
                                    className="w-8 h-8 rounded-full bg-white/90 dark:bg-zinc-800/90 flex items-center justify-center hover:bg-white dark:hover:bg-zinc-700 transition-colors shadow-md"
                                  >
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-700 dark:text-zinc-300">
                                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                      <polyline points="7 10 12 15 17 10" />
                                      <line x1="12" y1="15" x2="12" y2="3" />
                                    </svg>
                                  </a>
                                  {/* Delete */}
                                  <button
                                    onClick={() => deleteGraphic(i)}
                                    title="Delete"
                                    className="w-8 h-8 rounded-full bg-white/90 dark:bg-zinc-800/90 flex items-center justify-center hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors shadow-md"
                                  >
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-500">
                                      <polyline points="3 6 5 6 21 6" />
                                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                    </svg>
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      {/* Debug: show semantic prompt sent to Gemini */}
                      {isDevMode && p.lastPrompt && (
                        <div className={`mt-3 border ${cellBorder} rounded-lg overflow-hidden`}>
                          <div className={`px-3 py-1.5 ${miniHeaderBg} text-[10px] font-medium uppercase tracking-wider ${textSecondary}`}>
                            Prompt sent to Gemini
                          </div>
                          <div className={`px-3 py-2 text-[11px] ${textSecondary} leading-relaxed whitespace-pre-wrap font-mono`}>
                            {p.lastPrompt}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );

  // ── Main render ──
  if (!shouldRender) return null;

  return createPortal(
    <div
      data-panel-overlay
      className="fixed z-[104] flex flex-col bg-white dark:bg-zinc-900 border shadow-[5px_0_6px_rgba(0,0,0,0.35)] overflow-hidden"
      style={{
        borderColor,
        ...overlayStyle,
      }}
    >
      {/* Content area */}
      {!selectedDoc ? (
        renderIdle()
      ) : (
        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* Left column: sections list */}
          <div className={`shrink-0 w-[300px] flex flex-col border-r ${cellBorder} overflow-hidden`}>
            {/* Section header — Document Sections */}
            <div className="shrink-0 h-[36px] flex items-center gap-2 border-b border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-900">
              <div className="h-full w-[36px] shrink-0 flex items-center justify-center" style={{ backgroundColor: darkMode ? 'rgb(26,54,96)' : 'rgb(195,218,245)' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-zinc-500 dark:text-zinc-400">
                  <path d="M4 6h16" /><path d="M4 12h16" /><path d="M4 18h10" />
                </svg>
              </div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-800 dark:text-zinc-200">Sections</span>
            </div>

            {/* Document selector */}
            <div className={`shrink-0 px-3 py-2 ${miniHeaderBg} border-b ${cellBorder}`}>
              <select
                value={selectedDocId ?? ''}
                onChange={(e) => { setSelectedDocId(e.target.value || null); setActiveSectionTitle(null); }}
                className={`w-full text-[11px] bg-transparent ${textPrimary} border-none outline-none cursor-pointer`}
              >
                <option value="">Choose a document...</option>
                {availableDocs.map((doc) => (
                  <option key={doc.id} value={doc.id}>
                    {doc.sourceType === 'native-pdf' ? 'PDF: ' : 'MD: '}{doc.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Section list */}
            <div className="flex-1 overflow-y-auto min-h-0">
              {topHeadings.length > 0 ? (
                topHeadings.map((h) => {
                  const isActive = activeSectionTitle === h.title;
                  const isAnalyzed = analyzedSections.has(h.title);
                  const proposalCount = proposals.filter((p) => p.section_ref === h.title).length;

                  return (
                    <div
                      key={h.id}
                      className={`relative flex items-center border-b ${cellBorder} transition-colors cursor-pointer ${
                        isActive
                          ? 'bg-blue-50 dark:bg-blue-950/30'
                          : hoverBg
                      }`}
                      onClick={() => setActiveSectionTitle(h.title)}
                    >
                      <div className="flex-1 px-3 py-2 min-w-0">
                        <span className={`text-[11px] leading-tight ${
                          isActive ? 'text-blue-700 dark:text-blue-300 font-medium' : textPrimary
                        }`}>
                          {h.title}
                        </span>
                        <div className="flex items-center gap-1 mt-0.5">
                          {h.wordCount ? <span className={`text-[9px] ${hintColor}`}>{h.wordCount}w</span> : null}
                          {isAnalyzed && (
                            <span className="text-[9px] text-green-600 dark:text-green-400">{proposalCount} visual{proposalCount !== 1 ? 's' : ''}</span>
                          )}
                          {!isAnalyzed && (
                            <span className={`text-[9px] ${hintColor}`}>not analysed</span>
                          )}
                        </div>
                      </div>

                      {/* Kebab menu — only on active + analyzed sections */}
                      {isActive && isAnalyzed && (
                        <div className="shrink-0 pr-2 relative">
                          <button
                            onClick={(e) => { e.stopPropagation(); setSectionMenuTitle(sectionMenuTitle === h.title ? null : h.title); }}
                            className={`w-6 h-6 flex items-center justify-center rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors ${textSecondary}`}
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" /></svg>
                          </button>
                          {sectionMenuTitle === h.title && (
                            <>
                              <div className="fixed inset-0 z-[129]" onClick={() => setSectionMenuTitle(null)} />
                              <div className={`absolute right-0 top-full mt-1 z-[130] min-w-[140px] rounded-lg border shadow-lg ${darkMode ? 'bg-zinc-800 border-zinc-700' : 'bg-white border-zinc-200'}`}>
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleDownloadSectionProposals(h.title); }}
                                  className={`w-full text-left px-3 py-2 text-[11px] rounded-t-lg transition-colors ${darkMode ? 'hover:bg-zinc-700 text-zinc-200' : 'hover:bg-zinc-50 text-zinc-700'}`}
                                >
                                  Download
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); deleteSectionProposals(h.title); setSectionMenuTitle(null); }}
                                  className={`w-full text-left px-3 py-2 text-[11px] border-t ${cellBorder} rounded-b-lg transition-colors text-red-500 ${darkMode ? 'hover:bg-red-900/20' : 'hover:bg-red-50'}`}
                                >
                                  Delete
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              ) : (
                <div className={`px-3 py-4 text-[11px] ${hintColor} text-center italic`}>
                  No sections found in this document.
                </div>
              )}
            </div>
          </div>

          {/* Right column: proposals for active section */}
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            {/* Section header — Visual Analysis */}
            <div className="shrink-0 h-[36px] flex items-center gap-2 border-b border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-900">
              <div className="h-full w-[36px] shrink-0 flex items-center justify-center" style={{ backgroundColor: darkMode ? 'rgb(26,54,96)' : 'rgb(195,218,245)' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-zinc-500 dark:text-zinc-400">
                  <path d="M3 3v18h18" /><path d="M7 16l4-8 4 5 5-6" />
                </svg>
              </div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-800 dark:text-zinc-200">Visual Analysis</span>
            </div>

            {/* Toolbar row */}
            <div className="shrink-0 px-3 h-[40px] flex items-center justify-center gap-2 border-b border-zinc-200 dark:border-zinc-700">
              <StyleToolbar
                menuDraftOptions={menuDraftOptions}
                setMenuDraftOptions={setMenuDraftOptions}
                onOpenStyleStudio={onOpenStyleStudio}
              />
              {status === 'done' && filteredProposals.length > 0 && (
                <>
                  <div className="w-px h-3.5 bg-zinc-200 dark:bg-zinc-700 mx-0.5" />
                  {/* Generate dropdown */}
                  <div className="relative">
                    <button
                      onClick={() => setShowGenerateMenu((p) => !p)}
                      disabled={isAnyGenerating}
                      className="flex items-center gap-1 px-3 py-1 rounded-full text-[10px] font-medium border border-zinc-300 dark:border-zinc-600 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors whitespace-nowrap disabled:opacity-40 disabled:pointer-events-none"
                    >
                      {isAnyGenerating ? 'Generating...' : 'Generate'}
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
                    </button>
                    {showGenerateMenu && (
                      <>
                        <div className="fixed inset-0 z-[129]" onClick={() => setShowGenerateMenu(false)} />
                        <div className={`absolute right-0 top-full mt-1 z-[130] min-w-[180px] rounded-lg border shadow-lg ${darkMode ? 'bg-zinc-800 border-zinc-700' : 'bg-white border-zinc-200'}`}>
                          <button
                            onClick={() => { setShowGenerateMenu(false); handleGenerateActive(); }}
                            disabled={activeProposalIndex == null}
                            className={`w-full text-left px-3 py-2 text-[11px] ${darkMode ? 'hover:bg-zinc-700 text-zinc-200' : 'hover:bg-zinc-50 text-zinc-700'} disabled:opacity-40 disabled:pointer-events-none rounded-t-lg transition-colors`}
                          >
                            Generate Active
                            {activeProposalIndex != null && (
                              <span className={`ml-1 text-[9px] ${hintColor}`}>(1)</span>
                            )}
                          </button>
                          <button
                            onClick={() => { setShowGenerateMenu(false); handleGenerateSelected(); }}
                            disabled={!someSelected}
                            className={`w-full text-left px-3 py-2 text-[11px] border-t ${cellBorder} ${darkMode ? 'hover:bg-zinc-700 text-zinc-200' : 'hover:bg-zinc-50 text-zinc-700'} disabled:opacity-40 disabled:pointer-events-none rounded-b-lg transition-colors`}
                          >
                            Generate Selected
                            <span className={`ml-1 text-[9px] ${hintColor}`}>({Object.values(selectedRows).filter(Boolean).length})</span>
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                  {hasAnyImages && (
                    <>
                      <div className="w-px h-3.5 bg-zinc-200 dark:bg-zinc-700 mx-0.5" />
                      <button
                        onClick={handleExportDocx}
                        disabled={exporting}
                        className="px-3 py-1 rounded-full text-[10px] font-medium border border-zinc-300 dark:border-zinc-600 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors whitespace-nowrap disabled:opacity-40 disabled:pointer-events-none"
                      >
                        {exporting ? 'Exporting...' : 'Export DOCX'}
                      </button>
                    </>
                  )}
                </>
              )}
            </div>

            {/* Inline error banner (shown above results when error occurs but proposals exist) */}
            {error && status === 'done' && dismissedError !== error && (
              <div className="shrink-0 mx-4 mt-2 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 flex items-center gap-2">
                <span className="text-[11px] text-red-600 dark:text-red-400 flex-1">{error}</span>
                <button onClick={() => setDismissedError(error)} className="text-[10px] text-red-400 hover:text-red-600 dark:hover:text-red-300">Dismiss</button>
              </div>
            )}

            {/* Right column content */}
            {status === 'analysing' && renderAnalysing()}
            {status === 'error' && renderError()}
            {!activeSectionTitle && status !== 'analysing' && status !== 'error' && (
              <div className={`flex-1 flex flex-col items-center justify-center px-8 gap-3`}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={textSecondary}>
                  <path d="M3 3v18h18" /><path d="M7 16l4-8 4 5 5-6" />
                </svg>
                <p className={`text-[12px] ${textSecondary} text-center`}>
                  Select a section from the left to analyse.
                </p>
              </div>
            )}
            {activeSectionTitle && status !== 'analysing' && status !== 'error' && filteredProposals.length === 0 && (
              <div className={`flex-1 flex flex-col items-center justify-center px-8 gap-4`}>
                <p className={`text-[12px] ${textSecondary} text-center`}>
                  "{activeSectionTitle}" has not been analysed yet.
                </p>
                <button
                  onClick={() => handleAnalyse([activeSectionTitle])}
                  disabled={!selectedDoc?.fileId}
                  className="px-6 py-2 rounded-full text-[12px] font-medium bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-700 dark:hover:bg-zinc-300 disabled:opacity-40 disabled:pointer-events-none transition-colors"
                >
                  Analyse Section
                </button>
              </div>
            )}
            {activeSectionTitle && filteredProposals.length > 0 && renderDone()}
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
};

export default React.memo(DocVizPanel);
