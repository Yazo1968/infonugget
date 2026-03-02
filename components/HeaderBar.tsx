import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useNuggetContext } from '../context/NuggetContext';
import { useProjectContext } from '../context/ProjectContext';
import { useThemeContext } from '../context/ThemeContext';
import { TokenUsageTotals, formatTokens, formatCost } from '../hooks/useTokenUsage';

interface HeaderBarProps {
  expandedPanel: string | null;
  onReturnToLanding: () => void;
  onBreadcrumbDocSelect: (docId: string) => void;
  usageTotals: TokenUsageTotals;
  resetUsage: () => void;
}

function HeaderBar({ expandedPanel, onReturnToLanding, onBreadcrumbDocSelect, usageTotals, resetUsage }: HeaderBarProps) {
  const { selectedNugget, selectedNuggetId, selectedDocumentId, toggleNuggetDocument } = useNuggetContext();
  const { projects } = useProjectContext();
  const { darkMode, toggleDarkMode } = useThemeContext();

  // ── Local state (moved from App.tsx) ──
  const [showUsageDropdown, setShowUsageDropdown] = useState(false);
  const usageDropdownRef = useRef<HTMLDivElement>(null);
  const [breadcrumbDropdown, setBreadcrumbDropdown] = useState<'project' | 'nugget' | 'document' | null>(null);
  const breadcrumbRef = useRef<HTMLDivElement>(null);

  // ── Derived values ──
  const nuggetDocs = selectedNugget?.documents ?? [];

  const activeDocForBreadcrumb = useMemo(() => {
    if (!nuggetDocs.length) return null;
    if (selectedDocumentId) {
      const found = nuggetDocs.find((d) => d.id === selectedDocumentId);
      if (found) return found;
    }
    return nuggetDocs[0];
  }, [nuggetDocs, selectedDocumentId]);

  const parentProject = selectedNugget
    ? projects.find((p) => p.nuggetIds.includes(selectedNugget.id))
    : null;

  // ── Effects ──

  // Close usage dropdown on outside click
  useEffect(() => {
    if (!showUsageDropdown) return;
    const handler = (e: MouseEvent) => {
      if (usageDropdownRef.current && !usageDropdownRef.current.contains(e.target as Node)) {
        setShowUsageDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showUsageDropdown]);

  // Close breadcrumb dropdown on outside click or Escape
  useEffect(() => {
    if (!breadcrumbDropdown) return;
    const onClick = (e: MouseEvent) => {
      if (breadcrumbRef.current && !breadcrumbRef.current.contains(e.target as Node)) setBreadcrumbDropdown(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setBreadcrumbDropdown(null);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [breadcrumbDropdown]);

  // Auto-close breadcrumb dropdown on nugget change
  useEffect(() => {
    setBreadcrumbDropdown(null);
  }, [selectedNuggetId]);

  // ── Local handler: select doc + close dropdown ──
  const handleDocSelect = (docId: string) => {
    onBreadcrumbDocSelect(docId);
    setBreadcrumbDropdown(null);
  };

  return (
    <header className="shrink-0 flex flex-col pt-2 border-b border-zinc-100 dark:border-zinc-700 relative z-[110]">
      {/* Top row: logo + controls */}
      <div className="h-9 flex items-center justify-between px-5">
        <button
          onClick={onReturnToLanding}
          className="flex items-center gap-2 hover:opacity-70 transition-opacity cursor-pointer bg-transparent border-none p-0"
          title="Return to projects"
        >
          <div className="w-7 h-7 bg-accent-blue rounded-full flex items-center justify-center shrink-0">
            <div className="w-[9px] h-[9px] bg-white rounded-[2px] rotate-45" />
          </div>
          <span className="text-[17px] tracking-tight text-zinc-900 dark:text-zinc-100">
            <span className="font-light italic">info</span>
            <span className="font-semibold not-italic">nugget</span>
          </span>
        </button>

      {/* Right: dark mode toggle + token/cost counter */}
      <div className="w-48 shrink-0 flex items-center justify-end gap-1 relative" ref={usageDropdownRef}>
        <button
          onClick={toggleDarkMode}
          className="w-6 h-6 rounded-full flex items-center justify-center text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
          title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {darkMode ? (
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="5" />
              <line x1="12" y1="1" x2="12" y2="3" />
              <line x1="12" y1="21" x2="12" y2="23" />
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
              <line x1="1" y1="12" x2="3" y2="12" />
              <line x1="21" y1="12" x2="23" y2="12" />
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
            </svg>
          ) : (
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          )}
        </button>
        <button
          onClick={() => setShowUsageDropdown((prev) => !prev)}
          className={`text-[10px] transition-colors font-mono tracking-tight px-2 py-0.5 rounded hover:bg-zinc-50 dark:hover:bg-zinc-700 ${usageTotals.callCount > 0 ? 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300' : 'text-zinc-300 dark:text-zinc-600 hover:text-zinc-400 dark:hover:text-zinc-500'}`}
          aria-expanded={showUsageDropdown}
        >
          {formatCost(usageTotals.totalCost)} ·{' '}
          {formatTokens(usageTotals.totalInputTokens + usageTotals.totalOutputTokens)} tokens
        </button>

        {showUsageDropdown && (
          <div className="absolute top-full right-0 mt-1 w-64 bg-white dark:bg-zinc-900 rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-700 z-50 py-2 px-3 text-[11px] text-zinc-600 dark:text-zinc-300">
            {/* Claude row */}
            <div className="flex justify-between items-center py-1 border-b border-zinc-50 dark:border-zinc-700">
              <span className="font-medium text-zinc-700 dark:text-zinc-300">Claude</span>
              <span className="font-mono">{formatCost(usageTotals.claudeCost)}</span>
            </div>
            <div className="flex justify-between items-center py-0.5 text-[10px] text-zinc-400 dark:text-zinc-500 pl-2">
              <span>
                In: {formatTokens(usageTotals.claudeInputTokens)} · Out:{' '}
                {formatTokens(usageTotals.claudeOutputTokens)}
              </span>
            </div>

            {/* Gemini row */}
            <div className="flex justify-between items-center py-1 border-b border-zinc-50 dark:border-zinc-700 mt-1">
              <span className="font-medium text-zinc-700 dark:text-zinc-300">Gemini</span>
              <span className="font-mono">{formatCost(usageTotals.geminiCost)}</span>
            </div>
            <div className="flex justify-between items-center py-0.5 text-[10px] text-zinc-400 dark:text-zinc-500 pl-2">
              <span>
                In: {formatTokens(usageTotals.geminiInputTokens)} · Out:{' '}
                {formatTokens(usageTotals.geminiOutputTokens)}
              </span>
            </div>

            {/* Cache savings */}
            {usageTotals.totalCacheReadTokens > 0 && (
              <div className="flex justify-between items-center py-0.5 text-[10px] text-zinc-400 dark:text-zinc-500 mt-1 border-t border-zinc-100 dark:border-zinc-700 pt-1">
                <span>Cache reads</span>
                <span className="font-mono">{formatTokens(usageTotals.totalCacheReadTokens)}</span>
              </div>
            )}

            {/* Total */}
            <div className="flex justify-between items-center py-1 mt-1 border-t border-zinc-100 dark:border-zinc-700 font-medium text-zinc-700 dark:text-zinc-300">
              <span>Total ({usageTotals.callCount} calls)</span>
              <span className="font-mono">{formatCost(usageTotals.totalCost)}</span>
            </div>

            {/* Reset button */}
            <button
              onClick={() => {
                resetUsage();
                setShowUsageDropdown(false);
              }}
              className="w-full mt-1.5 text-[10px] text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700 rounded py-1 transition-colors"
            >
              Reset counters
            </button>
          </div>
        )}
      </div>
      </div>

      {/* Bottom row: breadcrumb navigation */}
      <div className="h-7 flex items-center gap-0 min-w-0 px-2 text-[13px] text-zinc-900 dark:text-zinc-100">
      {selectedNugget && (
        <nav
          ref={breadcrumbRef}
          aria-label="Breadcrumb"
          data-breadcrumb-dropdown
          className="flex items-center gap-0 min-w-0 flex-1"
        >
          {/* ── Project segment (static label — scoped by landing page) ── */}
          {parentProject && (
            <>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-400 shrink-0" aria-label="Project">
                <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
              </svg>
              <span className="ml-1 font-semibold not-italic px-1 py-0.5 whitespace-nowrap text-zinc-900 dark:text-zinc-100" title={parentProject.name}>
                {parentProject.name}
              </span>
              <span className="mx-1.5 text-zinc-900 dark:text-zinc-100 font-light select-none">/</span>
            </>
          )}

          {/* ── Document segment ── */}
          {(expandedPanel === null || expandedPanel === 'sources' || expandedPanel === 'chat' || expandedPanel === 'auto-deck' || expandedPanel === 'quality') ? (
            /* Default / Sources / Chat / Auto-Deck: "Active Documents" with check/uncheck dropdown */
            nuggetDocs.length > 0 && (
              <>
                <span className="mx-1.5 text-zinc-900 dark:text-zinc-100 font-light select-none">/</span>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-400 shrink-0" aria-label="Active Documents">
                  <path d="M16 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2Z" />
                  <path d="M8 2h10a2 2 0 0 1 2 2v12" />
                </svg>
                <div className="relative ml-1">
                  <button
                    onClick={() => setBreadcrumbDropdown((prev) => (prev === 'document' ? null : 'document'))}
                    className="font-semibold not-italic px-1 py-0.5 -my-0.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors inline-flex items-center gap-0.5"
                    aria-expanded={breadcrumbDropdown === 'document'}
                  >
                    Active Documents
                    <span className="text-[10px] font-normal text-zinc-400 ml-0.5">
                      ({nuggetDocs.filter((d) => d.enabled !== false).length}/{nuggetDocs.length})
                    </span>
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="ml-0.5 opacity-40 shrink-0">
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>
                  {breadcrumbDropdown === 'document' && (
                    <div className="absolute top-full left-0 mt-1 min-w-[200px] max-h-64 overflow-y-auto bg-white dark:bg-zinc-900 rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-700 z-[120] py-1 text-[12px]">
                      {(() => { const enabledCount = nuggetDocs.filter((d) => d.enabled !== false).length; return nuggetDocs.map((doc) => {
                        const isEnabled = doc.enabled !== false;
                        const isLastEnabled = isEnabled && enabledCount <= 1;
                        const isActive = doc.id === selectedDocumentId;
                        return (
                          <div
                            key={doc.id}
                            className="flex items-center gap-2 px-3 py-1.5 select-none transition-colors rounded text-zinc-800 dark:text-zinc-200"
                          >
                            <button
                              onClick={(e) => { e.stopPropagation(); if (!isLastEnabled) toggleNuggetDocument(doc.id); }}
                              className={`shrink-0 w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors ${isLastEnabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'} ${isEnabled ? 'border-zinc-300 dark:border-zinc-600 bg-zinc-900' : 'border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:border-zinc-400 dark:hover:border-zinc-500'}`}
                              aria-label={isLastEnabled ? 'At least one document must be active' : isEnabled ? `Disable ${doc.name}` : `Enable ${doc.name}`}
                            >
                              {isEnabled && (
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                  <polyline points="20 6 9 17 4 12" />
                                </svg>
                              )}
                            </button>
                            <span
                              className={`truncate flex-1 min-w-0 cursor-pointer rounded px-1 -mx-1 transition-colors ${isActive ? 'bg-zinc-200 dark:bg-zinc-700 font-medium' : 'hover:underline'}`}
                              onClick={() => handleDocSelect(doc.id)}
                            >
                              {doc.name}
                            </span>
                            <span className="text-[10px] text-zinc-400 dark:text-zinc-500 shrink-0 uppercase">
                              {doc.sourceType === 'native-pdf' ? 'pdf' : 'md'}
                            </span>
                          </div>
                        );
                      }); })()}
                    </div>
                  )}
                </div>
              </>
            )
          ) : (
            /* Default: single active doc with dropdown */
            activeDocForBreadcrumb && (
              <>
                <span className="mx-1.5 text-zinc-900 dark:text-zinc-100 font-light select-none">/</span>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-400 shrink-0" aria-label="Document">
                  <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
                  <path d="M14 2v4a2 2 0 0 0 2 2h4" />
                </svg>
                <div className="relative ml-1">
                  <button
                    onClick={() => setBreadcrumbDropdown((prev) => (prev === 'document' ? null : 'document'))}
                    className="font-semibold not-italic px-1 py-0.5 -my-0.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors inline-flex items-center gap-0.5 whitespace-nowrap"
                    title={activeDocForBreadcrumb.name}
                    aria-expanded={breadcrumbDropdown === 'document'}
                  >
                    {activeDocForBreadcrumb.name}
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="ml-0.5 opacity-40 shrink-0">
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>
                  {breadcrumbDropdown === 'document' && (
                    <div className="absolute top-full left-0 mt-1 min-w-[180px] max-h-64 overflow-y-auto bg-white dark:bg-zinc-900 rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-700 z-[120] py-1 text-[12px]">
                      {nuggetDocs.map((doc) => (
                        <button
                          key={doc.id}
                          onClick={() => handleDocSelect(doc.id)}
                          className={`w-full text-left px-3 py-1.5 truncate transition-colors flex items-center gap-2 ${doc.id === activeDocForBreadcrumb.id ? 'bg-zinc-200 dark:bg-zinc-700 font-medium text-zinc-800 dark:text-zinc-200' : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 hover:text-zinc-800 dark:hover:text-zinc-200'}`}
                        >
                          <span className="truncate">{doc.name}</span>
                          <span className="text-[10px] text-zinc-400 dark:text-zinc-500 shrink-0 uppercase">
                            {doc.sourceType === 'native-pdf' ? 'pdf' : 'md'}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )
          )}
        </nav>
      )}
      </div>
    </header>
  );
}

export default HeaderBar;
