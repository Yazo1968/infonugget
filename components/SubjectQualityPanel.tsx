import React, { useState, useRef, useEffect, useCallback, useMemo, useImperativeHandle, forwardRef } from 'react';
import { createPortal } from 'react-dom';
import {
  DQAFReport,
  DQAFCrossDocFinding,
  DQAFPerDocumentFlag,
  DQAFProductionNotice,
  DQAFPass1CheckId,
  DQAFVerdict,
  UploadedFile,
  AutoDeckBriefing,
  BriefingSuggestions,
  BriefingFieldName,
  SourcesLogEntry,
  SourcesLogChange,
  SourcesLogStats,
  SourcesLogTrigger,
} from '../types';
import { useThemeContext } from '../context/ThemeContext';
import { usePanelOverlay } from '../hooks/usePanelOverlay';
import { useResizeDrag } from '../hooks/useResizeDrag';
import { QualityStatus } from '../hooks/useDocumentQualityCheck';
import { BRIEFING_LIMITS, countWords } from '../utils/autoDeck/constants';
import { UnsavedChangesDialog } from './Dialogs';

// ─────────────────────────────────────────────────────────────────
// Tab type
// ─────────────────────────────────────────────────────────────────

export type SubjectQualityTab = 'logs' | 'brief' | 'assessment';

// ─────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────

export interface SubjectQualityPanelProps {
  isOpen: boolean;
  activeTab: SubjectQualityTab;
  onTabChange: (tab: SubjectQualityTab) => void;
  tabBarRef?: React.RefObject<HTMLElement | null>;
  onToggle: () => void;
  // Domain
  nuggetId: string;
  nuggetName: string;
  currentDomain: string;
  isRegeneratingDomain: boolean;
  domainReviewNeeded: boolean;
  onSaveDomain: (nuggetId: string, domain: string) => void;
  onRegenerateDomain: (nuggetId: string) => void;
  onDismissDomainReview: (nuggetId: string) => void;
  // Sources log
  sourcesLog: SourcesLogEntry[];
  sourcesLogStats: SourcesLogStats;
  hasPendingChanges: boolean;
  onDeleteLogEntry: (seq: number) => void;
  onDeleteAllLogEntries: () => void;
  onRenameLogEntry: (seq: number, label: string) => void;
  onCreateLogEntry: () => void;
  // Brief
  briefing?: AutoDeckBriefing;
  briefingSuggestions?: BriefingSuggestions;
  briefReviewNeeded: boolean;
  onBriefingChange: (briefing: AutoDeckBriefing) => void;
  onSuggestionsChange: (suggestions: BriefingSuggestions) => void;
  onDismissBriefReview: (nuggetId: string) => void;
  onBriefDirtyChange?: (dirty: boolean) => void;
  briefSaveRef?: React.MutableRefObject<(() => void) | null>;
  briefDiscardRef?: React.MutableRefObject<(() => void) | null>;
  documents: UploadedFile[];
  subject?: string;
  onGenerateSuggestions?: (subject: string | undefined, documents: UploadedFile[], totalWordCount: number) => Promise<BriefingSuggestions>;
  onAbortSuggestions?: () => void;
  // Assessment
  dqafReport: DQAFReport | undefined;
  effectiveStatus: QualityStatus;
  isChecking: boolean;
  checkError: string | null;
  onRunCheck: (engagementPurpose: string) => Promise<void>;
  onAbortCheck: () => void;
  onFixDocuments: () => void;
}

// ─────────────────────────────────────────────────────────────────
// Constants (Assessment)
// ─────────────────────────────────────────────────────────────────

const PASS1_LABELS: Record<DQAFPass1CheckId, string> = {
  'P1-01': 'Metadata Presence',
  'P1-02': 'Number Reconciliation',
  'P1-03': 'Internal Contradiction',
  'P1-04': 'Broken References',
  'P1-05': 'Version Clarity',
  'P1-06': 'Structural Coherence',
};

const SEVERITY_ORDER: Record<string, number> = { critical: 0, moderate: 1, minor: 2 };
const severityRank = (s: string): number => SEVERITY_ORDER[s] ?? 3;

// ─────────────────────────────────────────────────────────────────
// Constants (Brief)
// ─────────────────────────────────────────────────────────────────


// ─────────────────────────────────────────────────────────────────
// Sources Log helpers
// ─────────────────────────────────────────────────────────────────

const ChangeTypeIcons: Record<string, React.ReactNode> = {
  added: (<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>),
  removed: (<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /></svg>),
  updated: (<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /></svg>),
  renamed: (<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7V4h16v3M9 20h6M12 4v16" /></svg>),
  enabled: (<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>),
  disabled: (<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></svg>),
  toc_updated: (<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></svg>),
};

function getChangeIcon(type: string): React.ReactNode {
  return ChangeTypeIcons[type] ?? ChangeTypeIcons.updated;
}

const TriggerConfig: Record<SourcesLogTrigger, { label: string; color: string; darkColor: string }> = {
  chat_initiated: { label: 'Chat started', color: 'bg-blue-50 text-blue-600 border-blue-200', darkColor: 'dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800' },
  chat_continued: { label: 'Chat continued', color: 'bg-sky-50 text-sky-600 border-sky-200', darkColor: 'dark:bg-sky-900/30 dark:text-sky-400 dark:border-sky-800' },
  auto_deck: { label: 'Auto-Deck', color: 'bg-purple-50 text-purple-600 border-purple-200', darkColor: 'dark:bg-purple-900/30 dark:text-purple-400 dark:border-purple-800' },
  manual: { label: 'Manual', color: 'bg-zinc-50 text-zinc-600 border-zinc-200', darkColor: 'dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700' },
};

function formatLogTimestamp(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: sameYear ? undefined : 'numeric' });
  return `${time}, ${date}`;
}

function getEntryTitle(entry: SourcesLogEntry): string {
  if (entry.userLabel) return entry.userLabel;
  const count = entry.changes.length;
  if (count === 0) return 'No changes recorded';
  if (count === 1) return getChangeDescription(entry.changes[0]);
  const typeCounts: Record<string, number> = {};
  for (const c of entry.changes) typeCounts[c.type] = (typeCounts[c.type] || 0) + 1;
  const parts = Object.entries(typeCounts).map(([type, n]) => {
    const verb = type === 'added' ? 'added' : type === 'removed' ? 'removed' : type === 'updated' ? 'updated' : type === 'renamed' ? 'renamed' : type === 'enabled' ? 'enabled' : type === 'disabled' ? 'disabled' : type === 'toc_updated' ? 'TOC updated' : 'changed';
    return `${n} ${verb}`;
  });
  return parts.join(', ');
}

function getChangeDescription(c: SourcesLogChange): string {
  switch (c.type) {
    case 'added': return `Added "${c.docName}"`;
    case 'removed': return `Removed "${c.docName}"`;
    case 'updated': return `Updated "${c.docName}"`;
    case 'renamed': return `Renamed "${c.oldName}" → "${c.docName}"`;
    case 'enabled': return `Enabled "${c.docName}"`;
    case 'disabled': return `Disabled "${c.docName}"`;
    case 'toc_updated': return `TOC updated for "${c.docName}"`;
    default: return `Changed "${c.docName}"`;
  }
}

function formatCharDelta(before: number, after: number): string {
  const delta = after - before;
  const pct = before > 0 ? Math.round((Math.abs(delta) / before) * 100) : (after > 0 ? 100 : 0);
  const sign = delta >= 0 ? '+' : '';
  const approxWords = Math.round(Math.abs(delta) / 5);
  return `${sign}${delta.toLocaleString()} chars (~${approxWords.toLocaleString()} words, ${pct}%)`;
}

// ─────────────────────────────────────────────────────────────────
// Assessment helpers
// ─────────────────────────────────────────────────────────────────

function formatAssessmentTimestamp(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function getVerdictColor(verdict?: DQAFVerdict) {
  if (!verdict) return 'rgb(120, 120, 120)';
  switch (verdict) {
    case 'ready': return 'rgb(34, 160, 90)';
    case 'conditional': return 'rgb(210, 160, 30)';
    case 'not_ready': return 'rgb(200, 50, 50)';
    default: return 'rgb(120, 120, 120)';
  }
}

/** Derive engagement purpose string from briefing + subject */
export function deriveEngagementPurpose(briefing?: AutoDeckBriefing, domain?: string): string {
  const parts: string[] = [];
  if (briefing?.objective) parts.push(`Objective: ${briefing.objective}`);
  if (briefing?.audience) parts.push(`Audience: ${briefing.audience}`);
  if (briefing?.type) parts.push(`Type: ${briefing.type}`);
  if (briefing?.tone) parts.push(`Tone: ${briefing.tone}`);
  if (briefing?.focus) parts.push(`Focus: ${briefing.focus}`);
  if (domain) parts.push(`Domain: ${domain}`);
  return parts.join('. ');
}

// ─────────────────────────────────────────────────────────────────
// Tab bar
// ─────────────────────────────────────────────────────────────────

const TAB_ITEMS: { id: SubjectQualityTab; label: string }[] = [
  { id: 'logs', label: 'Logs' },
  { id: 'brief', label: 'Domain & Brief' },
  { id: 'assessment', label: 'Assessment' },
];

// ─────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────

const SubjectQualityPanel: React.FC<SubjectQualityPanelProps> = (props) => {
  const {
    isOpen, activeTab, onTabChange, tabBarRef,
    // Domain
    nuggetId, nuggetName, currentDomain, isRegeneratingDomain,
    domainReviewNeeded, onSaveDomain, onRegenerateDomain, onDismissDomainReview,
    // Sources log
    sourcesLog, sourcesLogStats, hasPendingChanges,
    onDeleteLogEntry, onDeleteAllLogEntries, onRenameLogEntry, onCreateLogEntry,
    // Brief
    briefing, briefingSuggestions, briefReviewNeeded, onBriefingChange, onSuggestionsChange, onDismissBriefReview, onBriefDirtyChange, briefSaveRef, briefDiscardRef, documents, subject,
    onGenerateSuggestions, onAbortSuggestions,
    // Assessment
    dqafReport, effectiveStatus, isChecking, checkError,
    onRunCheck, onAbortCheck, onFixDocuments,
  } = props;

  const { darkMode } = useThemeContext();
  const { shouldRender, overlayStyle } = usePanelOverlay({
    isOpen,
    defaultWidth: Math.min(window.innerWidth * 0.5, 750),
    minWidth: 300,
    anchorRef: tabBarRef,
  });

  // ── Resize dividers ──
  const [logsWidth, handleLogsResize] = useResizeDrag({ initialWidth: 400, minWidth: 160, maxWidth: 500, direction: 'right' });

  // ── Brief draft-mode gating ──
  const briefTabRef = useRef<BriefTabHandle>(null);
  const [briefDirty, setBriefDirty] = useState(false);
  const [pendingTab, setPendingTab] = useState<SubjectQualityTab | null>(null);

  const handleBriefDirtyChange = useCallback((dirty: boolean) => {
    setBriefDirty(dirty);
    onBriefDirtyChange?.(dirty);
  }, [onBriefDirtyChange]);

  // Expose save/discard to parent (App.tsx) for panel-close gating
  useEffect(() => {
    if (briefSaveRef) briefSaveRef.current = () => briefTabRef.current?.save();
    if (briefDiscardRef) briefDiscardRef.current = () => briefTabRef.current?.discard();
    return () => {
      if (briefSaveRef) briefSaveRef.current = null;
      if (briefDiscardRef) briefDiscardRef.current = null;
    };
  }, [briefSaveRef, briefDiscardRef]);

  const handleTabClick = useCallback((tab: SubjectQualityTab) => {
    if (tab === activeTab) return;
    if (activeTab === 'brief' && briefDirty) {
      setPendingTab(tab);
      return;
    }
    onTabChange(tab);
  }, [activeTab, briefDirty, onTabChange]);

  const handleDialogSave = useCallback(() => {
    briefTabRef.current?.save();
    const target = pendingTab;
    setPendingTab(null);
    if (target) onTabChange(target);
  }, [pendingTab, onTabChange]);

  const handleDialogDiscard = useCallback(() => {
    briefTabRef.current?.discard();
    const target = pendingTab;
    setPendingTab(null);
    if (target) onTabChange(target);
  }, [pendingTab, onTabChange]);

  const handleDialogCancel = useCallback(() => {
    setPendingTab(null);
  }, []);

  if (!shouldRender) return null;

  return createPortal(
    <div
      data-panel-overlay
      className={`fixed z-[106] flex flex-col ${darkMode ? 'bg-zinc-900 text-zinc-200' : 'bg-white text-zinc-800'} border shadow-[5px_0_6px_rgba(0,0,0,0.35)] overflow-hidden`}
      style={{
        ...overlayStyle,
        borderColor: effectiveStatus === 'red' ? '#ef4444'
          : effectiveStatus === 'amber' ? '#f59e0b'
          : effectiveStatus === 'green' ? '#22c55e'
          : effectiveStatus === 'stale' ? '#a1a1aa'
          : undefined,
      }}
    >
      {/* ── Side-by-side Vertical Sections ── */}
      <div className="flex-1 flex overflow-hidden min-h-0">

        {/* ── Section 1: Logs ── */}
        <div className="shrink-0 flex flex-col overflow-hidden" style={{ width: logsWidth }}>
          <div className="shrink-0 h-[36px] flex items-center gap-2 border-b border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-900">
            <div className="h-full w-[36px] shrink-0 flex items-center justify-center" style={{ backgroundColor: darkMode ? 'rgb(30,58,100)' : 'rgb(190,215,245)' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-zinc-500 dark:text-zinc-400">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
              </svg>
            </div>
            <span className="text-[13px] font-bold uppercase tracking-wider text-zinc-800 dark:text-zinc-200">Sources Log</span>
          </div>
          <div className="flex-1 overflow-y-auto min-h-0">
            <LogsTab
              darkMode={darkMode}
              sourcesLog={sourcesLog}
              sourcesLogStats={sourcesLogStats}
              hasPendingChanges={hasPendingChanges}
              onDeleteLogEntry={onDeleteLogEntry}
              onDeleteAllLogEntries={onDeleteAllLogEntries}
              onRenameLogEntry={onRenameLogEntry}
              onCreateLogEntry={onCreateLogEntry}
            />
          </div>
        </div>

        {/* Resize divider */}
        <div
          onMouseDown={handleLogsResize}
          className="shrink-0 w-[5px] cursor-col-resize group relative select-none flex items-center justify-center"
        >
          <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-zinc-200 dark:bg-zinc-600 group-hover:bg-zinc-400 dark:group-hover:bg-zinc-500 transition-colors" />
          <div className="w-[5px] h-6 rounded-full bg-zinc-300 dark:bg-zinc-500 group-hover:bg-zinc-400 dark:group-hover:bg-zinc-400 transition-colors" />
        </div>

        {/* ── Section 2: Domain & Brief ── */}
        <div className="flex-1 flex flex-col overflow-hidden border-r border-zinc-200 dark:border-zinc-600 min-w-0">
          <div className="shrink-0 h-[36px] flex items-center gap-2 border-b border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-900">
            <div className="h-full w-[36px] shrink-0 flex items-center justify-center" style={{ backgroundColor: darkMode ? 'rgb(25,50,90)' : 'rgb(140,185,230)' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-zinc-500 dark:text-zinc-400">
                <rect width="18" height="18" x="3" y="3" rx="2" />
                <path d="M9 3v18" />
              </svg>
            </div>
            <span className="text-[13px] font-bold uppercase tracking-wider text-zinc-800 dark:text-zinc-200">Domain & Brief</span>
          </div>
          <div className="flex-1 overflow-y-auto min-h-0">
            <BriefTab
              ref={briefTabRef}
              darkMode={darkMode}
              nuggetId={nuggetId}
              nuggetName={nuggetName}
              currentDomain={currentDomain}
              isRegeneratingDomain={isRegeneratingDomain}
              domainReviewNeeded={domainReviewNeeded}
              onSaveDomain={onSaveDomain}
              onRegenerateDomain={onRegenerateDomain}
              onDismissDomainReview={onDismissDomainReview}
              briefing={briefing}
              briefingSuggestions={briefingSuggestions}
              briefReviewNeeded={briefReviewNeeded}
              onBriefingChange={onBriefingChange}
              onSuggestionsChange={onSuggestionsChange}
              onDismissBriefReview={onDismissBriefReview}
              onDirtyChange={handleBriefDirtyChange}
              documents={documents}
              subject={subject}
              onGenerateSuggestions={onGenerateSuggestions}
              onAbortSuggestions={onAbortSuggestions}
              isOpen={isOpen}
            />
          </div>
        </div>

        {/* Resize divider */}
        <div className="shrink-0 w-[5px] relative select-none flex items-center justify-center">
          <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-zinc-200 dark:bg-zinc-600" />
        </div>

        {/* ── Section 3: Assessment ── */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          <div className="shrink-0 h-[36px] flex items-center gap-2 border-b border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-900">
            <div className="h-full w-[36px] shrink-0 flex items-center justify-center" style={{ backgroundColor: darkMode ? 'rgb(30,60,100)' : 'rgb(200,225,250)' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-zinc-500 dark:text-zinc-400">
                <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            </div>
            <span className="text-[13px] font-bold uppercase tracking-wider text-zinc-800 dark:text-zinc-200">Assessment</span>
          </div>
          {/* Toolbar */}
          <div className="shrink-0 px-4 pt-3 pb-2 flex items-center justify-between">
            <h3 className={`text-[11px] font-semibold uppercase tracking-wider ${darkMode ? 'text-zinc-500' : 'text-zinc-400'}`}>
              Status
            </h3>
            <button
              onClick={() => {
                const purpose = deriveEngagementPurpose(briefing, subject);
                if (purpose.trim()) onRunCheck(purpose);
              }}
              disabled={isChecking || !deriveEngagementPurpose(briefing, subject).trim()}
              className={`text-[10px] font-medium px-2.5 py-1 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                darkMode ? 'bg-blue-600 hover:bg-blue-500 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'
              }`}
            >
              {isChecking ? 'Running…' : dqafReport ? 'Re-run' : 'Run Assessment'}
            </button>
          </div>
          <div className="flex-1 flex flex-col overflow-y-auto min-h-0">
            <AssessmentTab
              darkMode={darkMode}
              dqafReport={dqafReport}
              effectiveStatus={effectiveStatus}
              isChecking={isChecking}
              checkError={checkError}
              onRunCheck={onRunCheck}
              onAbortCheck={onAbortCheck}
              onFixDocuments={onFixDocuments}
              documents={documents}
              briefing={briefing}
              subject={subject}
              onTabChange={onTabChange}
            />
          </div>
        </div>

      </div>

      {/* ── Unsaved brief changes dialog ── */}
      {pendingTab !== null && (
        <UnsavedChangesDialog
          onSave={handleDialogSave}
          onDiscard={handleDialogDiscard}
          onCancel={handleDialogCancel}
          title="Unsaved changes"
          description="You have unsaved edits to the domain or briefing. Save or discard them to continue."
          saveLabel="Update"
          discardLabel="Discard Changes"
        />
      )}
    </div>,
    document.body,
  );
};

// ═════════════════════════════════════════════════════════════════
// TAB 1: Logs (sources log only)
// ═════════════════════════════════════════════════════════════════

function LogsTab({
  darkMode,
  sourcesLog, sourcesLogStats, hasPendingChanges,
  onDeleteLogEntry, onDeleteAllLogEntries, onRenameLogEntry, onCreateLogEntry,
}: {
  darkMode: boolean;
  sourcesLog: SourcesLogEntry[];
  sourcesLogStats: SourcesLogStats;
  hasPendingChanges: boolean;
  onDeleteLogEntry: (seq: number) => void;
  onDeleteAllLogEntries: () => void;
  onRenameLogEntry: (seq: number, label: string) => void;
  onCreateLogEntry: () => void;
}) {
  return (
    <div className="flex flex-col flex-1 overflow-hidden max-w-2xl mx-auto w-full">
      <SourcesLogSection
        darkMode={darkMode}
        sourcesLog={sourcesLog}
        sourcesLogStats={sourcesLogStats}
        hasPendingChanges={hasPendingChanges}
        onDeleteLogEntry={onDeleteLogEntry}
        onDeleteAllLogEntries={onDeleteAllLogEntries}
        onRenameLogEntry={onRenameLogEntry}
        onCreateLogEntry={onCreateLogEntry}
      />
    </div>
  );
}

// ── Domain Section (inline edit, forwardRef for draft-mode gating) ──

interface DomainSectionHandle {
  save: () => void;
  discard: () => void;
  readonly isDirty: boolean;
}

const DomainSection = forwardRef<DomainSectionHandle, {
  darkMode: boolean;
  nuggetId: string;
  nuggetName: string;
  currentDomain: string;
  isRegeneratingDomain: boolean;
  domainReviewNeeded: boolean;
  onSaveDomain: (nuggetId: string, domain: string) => void;
  onRegenerateDomain: (nuggetId: string) => void;
  onDismissDomainReview: (nuggetId: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
}>(function DomainSection({
  darkMode, nuggetId, nuggetName, currentDomain, isRegeneratingDomain,
  domainReviewNeeded, onSaveDomain, onRegenerateDomain, onDismissDomainReview,
  onDirtyChange,
}, ref) {
  const [localDomain, setLocalDomain] = useState(currentDomain);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync when external value changes (e.g. regeneration completes, nugget switch)
  useEffect(() => {
    if (currentDomain !== localDomain && !isRegeneratingDomain) {
      setLocalDomain(currentDomain);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentDomain, isRegeneratingDomain]);

  // Auto-resize textarea on value change
  useEffect(() => {
    const el = textareaRef.current;
    if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; }
  }, [localDomain]);

  const handleSave = useCallback(() => {
    const trimmed = localDomain.trim();
    if (trimmed && trimmed !== currentDomain) {
      onSaveDomain(nuggetId, trimmed);
    }
  }, [localDomain, currentDomain, nuggetId, onSaveDomain]);

  const domainIsDirty = localDomain.trim() !== currentDomain;

  useEffect(() => { onDirtyChange?.(domainIsDirty); }, [domainIsDirty, onDirtyChange]);

  useImperativeHandle(ref, () => ({
    save() { handleSave(); },
    discard() { setLocalDomain(currentDomain); },
    get isDirty() { return domainIsDirty; },
  }), [handleSave, currentDomain, domainIsDirty]);

  return (
    <div className="shrink-0 px-5 pt-4 pb-3">
      <div className="max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <h3 className={`text-[11px] font-semibold uppercase tracking-wider ${darkMode ? 'text-zinc-500' : 'text-zinc-400'}`}>
            Domain
          </h3>
          {domainReviewNeeded && (
            <span className="text-[9px] font-medium text-amber-500 dark:text-amber-400 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              Review needed
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => onRegenerateDomain(nuggetId)}
            disabled={isRegeneratingDomain}
            className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            {isRegeneratingDomain ? (
              <><svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>Regenerating...</>
            ) : (
              <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
              </svg>Regenerate</>
            )}
          </button>
          {domainIsDirty && (
            <button
              type="button"
              onClick={handleSave}
              className={`text-[11px] font-semibold px-2.5 py-0.5 rounded transition-colors ${darkMode ? 'bg-blue-600 hover:bg-blue-500 text-white' : 'bg-blue-600 hover:bg-blue-500 text-white'}`}
            >
              Update
            </button>
          )}
        </div>
      </div>
      <textarea
        ref={textareaRef}
        value={localDomain}
        onChange={(e) => {
          setLocalDomain(e.target.value);
          // Auto-resize
          const el = e.target;
          el.style.height = 'auto';
          el.style.height = el.scrollHeight + 'px';
        }}
        rows={1}
        disabled={isRegeneratingDomain}
        className={`w-full px-3 py-2 text-xs border rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-400/50 dark:focus:ring-zinc-500/50 resize-none disabled:opacity-50 disabled:cursor-not-allowed overflow-hidden ${
          darkMode ? 'border-zinc-700 bg-zinc-800 text-zinc-100' : 'border-zinc-200 bg-white text-zinc-800'
        }`}
        placeholder="e.g. Quarterly financial performance analysis for a mid-cap technology company covering revenue, margins, and growth projections."
        style={{ minHeight: 32 }}
      />
      <p className={`text-[10px] mt-1 ${darkMode ? 'text-zinc-600' : 'text-zinc-400'}`}>
        Domain context sentence to prime AI as a domain expert. Keep it specific (15-40 words).
      </p>

      {domainReviewNeeded && !domainIsDirty && !isRegeneratingDomain && (
        <div className="flex items-center gap-3 mt-2">
          <button
            onClick={() => onDismissDomainReview(nuggetId)}
            className="text-[11px] font-medium text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 transition-colors flex items-center gap-1.5"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Keep
          </button>
        </div>
      )}
      </div>
    </div>
  );
});

// ── Sources Log Section ──

function SourcesLogSection({
  darkMode, sourcesLog, sourcesLogStats, hasPendingChanges,
  onDeleteLogEntry, onDeleteAllLogEntries, onRenameLogEntry, onCreateLogEntry,
}: {
  darkMode: boolean;
  sourcesLog: SourcesLogEntry[];
  sourcesLogStats: SourcesLogStats;
  hasPendingChanges: boolean;
  onDeleteLogEntry: (seq: number) => void;
  onDeleteAllLogEntries: () => void;
  onRenameLogEntry: (seq: number, label: string) => void;
  onCreateLogEntry: () => void;
}) {
  const [expandedSeq, setExpandedSeq] = useState<number | null>(null);
  const [kebabSeq, setKebabSeq] = useState<number | null>(null);
  const [confirmDeleteSeq, setConfirmDeleteSeq] = useState<number | null>(null);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [renamingSeq, setRenamingSeq] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);
  const kebabRef = useRef<HTMLDivElement>(null);

  const sortedLog = [...sourcesLog].sort((a, b) => b.seq - a.seq);

  useEffect(() => {
    if (renamingSeq !== null) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [renamingSeq]);

  useEffect(() => {
    if (kebabSeq === null) return;
    const handler = (e: MouseEvent) => {
      if (kebabRef.current && !kebabRef.current.contains(e.target as Node)) {
        setKebabSeq(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [kebabSeq]);

  const handleRenameSubmit = (seq: number) => {
    const trimmed = renameValue.trim();
    if (trimmed) onRenameLogEntry(seq, trimmed);
    setRenamingSeq(null);
    setRenameValue('');
  };

  const handleDeleteEntry = (seq: number) => {
    onDeleteLogEntry(seq);
    setConfirmDeleteSeq(null);
    setKebabSeq(null);
  };

  const handleDeleteAll = () => {
    onDeleteAllLogEntries();
    setConfirmDeleteAll(false);
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Header row */}
      <div className="shrink-0 px-4 pt-3 pb-2 flex items-center justify-between">
        <h3 className={`text-[11px] font-semibold uppercase tracking-wider ${darkMode ? 'text-zinc-500' : 'text-zinc-400'}`}>
          Status
        </h3>
        <div className="flex items-center gap-2">
          {hasPendingChanges && !confirmDeleteAll && (
            <button
              onClick={onCreateLogEntry}
              className="text-[10px] font-medium text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 transition-colors"
            >
              Create Entry
            </button>
          )}
          {sourcesLog.length > 0 && !confirmDeleteAll && (
            <button
              onClick={() => setConfirmDeleteAll(true)}
              className="text-[10px] font-medium text-red-400 hover:text-red-500 dark:text-red-400 dark:hover:text-red-300 transition-colors"
            >
              Delete Logs
            </button>
          )}
          {confirmDeleteAll && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-red-500 dark:text-red-400">Delete all?</span>
              <button onClick={handleDeleteAll} className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-500 text-white hover:bg-red-600 transition-colors">Yes</button>
              <button onClick={() => setConfirmDeleteAll(false)} className="px-1.5 py-0.5 rounded text-[10px] text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">No</button>
            </div>
          )}
        </div>
      </div>

      {/* Stats bar */}
      <div className="shrink-0 px-4 pb-2">
        <div className={`flex items-center gap-3 text-[8px] rounded-lg px-3 py-1.5 ${darkMode ? 'text-zinc-500 bg-zinc-800' : 'text-zinc-400 bg-zinc-100'}`}>
          <div className="flex flex-col items-center">
            <span className={`font-semibold text-[9px] ${darkMode ? 'text-zinc-300' : 'text-zinc-600'}`}>{sourcesLogStats.lastUpdated ? formatLogTimestamp(sourcesLogStats.lastUpdated) : '—'}</span>
            <span>Last updated</span>
          </div>
          <div className={`w-px h-5 ${darkMode ? 'bg-zinc-700' : 'bg-zinc-200'}`} />
          <div className="flex flex-col items-center">
            <span className={`font-semibold text-[10px] ${darkMode ? 'text-zinc-300' : 'text-zinc-600'}`}>{sourcesLog.length}</span>
            <span>Shown</span>
          </div>
          <div className={`w-px h-5 ${darkMode ? 'bg-zinc-700' : 'bg-zinc-200'}`} />
          <div className="flex flex-col items-center">
            <span className={`font-semibold text-[10px] ${darkMode ? 'text-zinc-300' : 'text-zinc-600'}`}>{sourcesLogStats.logsCreated}</span>
            <span>Created</span>
          </div>
          <div className={`w-px h-5 ${darkMode ? 'bg-zinc-700' : 'bg-zinc-200'}`} />
          <div className="flex flex-col items-center">
            <span className={`font-semibold text-[10px] ${darkMode ? 'text-zinc-300' : 'text-zinc-600'}`}>{sourcesLogStats.logsDeleted}</span>
            <span>Deleted</span>
          </div>
          <div className={`w-px h-5 ${darkMode ? 'bg-zinc-700' : 'bg-zinc-200'}`} />
          <div className="flex flex-col items-center">
            <span className={`font-semibold text-[10px] ${darkMode ? 'text-zinc-300' : 'text-zinc-600'}`}>{sourcesLogStats.logsArchived}</span>
            <span>Archived</span>
          </div>
        </div>
      </div>

      {/* Log entries */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {sortedLog.length === 0 ? (
          <div className="text-center py-8">
            <p className={`text-xs ${darkMode ? 'text-zinc-500' : 'text-zinc-400'}`}>No log entries</p>
            <p className={`text-[10px] mt-1 ${darkMode ? 'text-zinc-600' : 'text-zinc-300'}`}>
              Entries are created when you start a chat, continue after changes, or generate an Auto-Deck.
            </p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {sortedLog.map((entry) => {
              const isExpanded = expandedSeq === entry.seq;
              const isKebabOpen = kebabSeq === entry.seq;
              const isConfirmingDelete = confirmDeleteSeq === entry.seq;
              const isRenaming = renamingSeq === entry.seq;
              const triggerCfg = TriggerConfig[entry.trigger];
              return (
                <div key={entry.seq} className={`group rounded-lg border transition-colors ${darkMode ? 'border-zinc-800 hover:border-zinc-700' : 'border-zinc-100 hover:border-zinc-200'}`}>
                  {/* Collapsed row */}
                  <div className="flex items-center gap-2.5 px-3 py-2 cursor-pointer" onClick={() => setExpandedSeq(isExpanded ? null : entry.seq)}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                      className={`shrink-0 text-zinc-300 dark:text-zinc-600 transition-transform ${isExpanded ? 'rotate-0' : '-rotate-90'}`}
                    ><polyline points="6 9 12 15 18 9" /></svg>
                    <span className={`shrink-0 px-1.5 py-0.5 rounded text-[9px] font-medium border ${triggerCfg.color} ${triggerCfg.darkColor}`}>{triggerCfg.label}</span>
                    <div className="min-w-0 flex-1">
                      {isRenaming ? (
                        <input ref={renameInputRef} value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') handleRenameSubmit(entry.seq); if (e.key === 'Escape') { setRenamingSeq(null); setRenameValue(''); } }}
                          onBlur={() => handleRenameSubmit(entry.seq)}
                          className={`w-full text-[11px] px-1.5 py-0.5 border rounded focus:outline-none focus:ring-1 focus:ring-zinc-400 ${darkMode ? 'border-zinc-600 bg-zinc-800 text-zinc-200' : 'border-zinc-300 bg-white text-zinc-800'}`}
                          onClick={(e) => e.stopPropagation()} />
                      ) : (
                        <p className={`text-[11px] truncate ${darkMode ? 'text-zinc-300' : 'text-zinc-700'}`}>{getEntryTitle(entry)}</p>
                      )}
                    </div>
                    <span className={`shrink-0 text-[9px] rounded-full px-1.5 py-0.5 tabular-nums ${darkMode ? 'text-zinc-500 bg-zinc-800' : 'text-zinc-400 bg-zinc-100'}`}>{entry.changes.length}</span>
                    <span className={`shrink-0 text-[10px] tabular-nums ${darkMode ? 'text-zinc-500' : 'text-zinc-400'}`}>{formatLogTimestamp(entry.timestamp)}</span>
                    {isConfirmingDelete ? (
                      <div className="shrink-0 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        <span className="text-[9px] text-red-500 dark:text-red-400">Delete?</span>
                        <button onClick={() => handleDeleteEntry(entry.seq)} className="px-1 py-0.5 rounded text-[9px] font-semibold bg-red-500 text-white hover:bg-red-600 transition-colors">Yes</button>
                        <button onClick={() => setConfirmDeleteSeq(null)} className="px-1 py-0.5 rounded text-[9px] text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">No</button>
                      </div>
                    ) : (
                      <div className="relative shrink-0" ref={isKebabOpen ? kebabRef : undefined}>
                        <button
                          onClick={(e) => { e.stopPropagation(); setKebabSeq(isKebabOpen ? null : entry.seq); }}
                          className="p-0.5 rounded text-zinc-300 dark:text-zinc-600 opacity-0 group-hover:opacity-100 hover:text-zinc-500 dark:hover:text-zinc-400 transition-all"
                          aria-label="Actions"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" /></svg>
                        </button>
                        {isKebabOpen && (
                          <div className={`absolute right-0 top-full mt-1 rounded-lg shadow-lg border py-1 min-w-[100px] z-10 ${darkMode ? 'bg-zinc-800 border-zinc-700 shadow-black/30' : 'bg-white border-zinc-200'}`} onClick={(e) => e.stopPropagation()}>
                            <button onClick={() => { setRenamingSeq(entry.seq); setRenameValue(entry.userLabel || getEntryTitle(entry)); setKebabSeq(null); }}
                              className={`w-full text-left px-3 py-1.5 text-[11px] transition-colors ${darkMode ? 'text-zinc-300 hover:bg-zinc-700' : 'text-zinc-600 hover:bg-zinc-50'}`}>Rename</button>
                            <button onClick={() => { setConfirmDeleteSeq(entry.seq); setKebabSeq(null); }}
                              className={`w-full text-left px-3 py-1.5 text-[11px] text-red-500 dark:text-red-400 transition-colors ${darkMode ? 'hover:bg-zinc-700' : 'hover:bg-zinc-50'}`}>Delete</button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  {/* Expanded details */}
                  {isExpanded && (
                    <div className={`px-3 pb-2.5 pt-0.5 ml-[22px] border-t ${darkMode ? 'border-zinc-800' : 'border-zinc-50'}`}>
                      <div className="space-y-1">
                        {entry.changes.map((change, idx) => (
                          <div key={idx}>
                            <div className="flex items-center gap-2">
                              <span className="shrink-0 text-zinc-400 dark:text-zinc-500">{getChangeIcon(change.type)}</span>
                              <span className={`text-[10px] truncate ${darkMode ? 'text-zinc-400' : 'text-zinc-600'}`}>{getChangeDescription(change)}</span>
                            </div>
                            {change.magnitude && (
                              <div className="ml-[18px] mt-0.5 mb-1 grid grid-cols-3 gap-x-4 gap-y-0.5 text-[9px]">
                                <div>
                                  <span className="text-zinc-400 dark:text-zinc-500">Characters</span>
                                  <p className={`font-medium ${darkMode ? 'text-zinc-300' : 'text-zinc-600'}`}>{formatCharDelta(change.magnitude.charCountBefore, change.magnitude.charCountAfter)}</p>
                                </div>
                                <div>
                                  <span className="text-zinc-400 dark:text-zinc-500">Headings</span>
                                  <p className={`font-medium ${darkMode ? 'text-zinc-300' : 'text-zinc-600'}`}>
                                    {change.magnitude.headingCountBefore} → {change.magnitude.headingCountAfter}
                                    {change.magnitude.headingCountBefore !== change.magnitude.headingCountAfter && (
                                      <span className="ml-1 text-zinc-400">({change.magnitude.headingCountAfter - change.magnitude.headingCountBefore >= 0 ? '+' : ''}{change.magnitude.headingCountAfter - change.magnitude.headingCountBefore})</span>
                                    )}
                                  </p>
                                </div>
                                <div>
                                  <span className="text-zinc-400 dark:text-zinc-500">Heading text</span>
                                  <p className={`font-medium ${change.magnitude.headingTextChanged ? 'text-amber-500 dark:text-amber-400' : darkMode ? 'text-zinc-300' : 'text-zinc-600'}`}>
                                    {change.magnitude.headingTextChanged ? 'Changed' : 'Unchanged'}
                                  </p>
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════
// TAB 2: Brief (draft mode — manual save required)
// ═════════════════════════════════════════════════════════════════

export interface BriefTabHandle {
  save: () => void;
  discard: () => void;
  readonly isDirty: boolean;
}

interface BriefTabProps {
  darkMode: boolean;
  // Domain
  nuggetId: string;
  nuggetName: string;
  currentDomain: string;
  isRegeneratingDomain: boolean;
  domainReviewNeeded: boolean;
  onSaveDomain: (nuggetId: string, domain: string) => void;
  onRegenerateDomain: (nuggetId: string) => void;
  onDismissDomainReview: (nuggetId: string) => void;
  // Brief
  briefing?: AutoDeckBriefing;
  briefingSuggestions?: BriefingSuggestions;
  briefReviewNeeded: boolean;
  onBriefingChange: (briefing: AutoDeckBriefing) => void;
  onSuggestionsChange: (suggestions: BriefingSuggestions) => void;
  onDismissBriefReview: (nuggetId: string) => void;
  onDirtyChange: (dirty: boolean) => void;
  documents: UploadedFile[];
  subject?: string;
  onGenerateSuggestions?: (subject: string | undefined, documents: UploadedFile[], totalWordCount: number) => Promise<BriefingSuggestions>;
  onAbortSuggestions?: () => void;
  isOpen: boolean;
}

const EMPTY_BRIEFING: AutoDeckBriefing = { audience: '', type: '', objective: '', tone: '', focus: '' };

const BriefTab = forwardRef<BriefTabHandle, BriefTabProps>(function BriefTab({
  darkMode,
  // Domain
  nuggetId, nuggetName, currentDomain, isRegeneratingDomain,
  domainReviewNeeded, onSaveDomain, onRegenerateDomain, onDismissDomainReview,
  // Brief
  briefing, briefingSuggestions, briefReviewNeeded, onBriefingChange, onSuggestionsChange, onDismissBriefReview, onDirtyChange, documents, subject,
  onGenerateSuggestions, onAbortSuggestions, isOpen,
}, ref) {
  // Domain ref for combined dirty gating
  const domainRef = useRef<DomainSectionHandle>(null);
  // Draft state — only committed on explicit save
  const [localBriefing, setLocalBriefing] = useState<AutoDeckBriefing>(briefing ?? EMPTY_BRIEFING);
  const [localSuggestions, setLocalSuggestions] = useState<BriefingSuggestions | null>(briefingSuggestions ?? null);
  // Committed snapshots for dirty comparison
  const [committedBriefing, setCommittedBriefing] = useState<AutoDeckBriefing>(briefing ?? EMPTY_BRIEFING);
  const [committedSuggestions, setCommittedSuggestions] = useState<BriefingSuggestions | null>(briefingSuggestions ?? null);

  const [isSuggesting, setIsSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);

  // Sync local + committed state when parent props change (e.g. switching nuggets)
  const briefingRef = useRef(briefing);
  if (briefing !== briefingRef.current) {
    briefingRef.current = briefing;
    const b = briefing ?? EMPTY_BRIEFING;
    setLocalBriefing(b);
    setCommittedBriefing(b);
  }
  const suggestionsRef = useRef(briefingSuggestions);
  if (briefingSuggestions !== suggestionsRef.current) {
    suggestionsRef.current = briefingSuggestions;
    setLocalSuggestions(briefingSuggestions ?? null);
    setCommittedSuggestions(briefingSuggestions ?? null);
  }

  // Dirty detection — brief fields
  const briefDirtyOnly = useMemo(() => {
    return JSON.stringify(localBriefing) !== JSON.stringify(committedBriefing)
      || JSON.stringify(localSuggestions) !== JSON.stringify(committedSuggestions);
  }, [localBriefing, committedBriefing, localSuggestions, committedSuggestions]);

  // Domain dirty state (updated via DomainSection callback)
  const [domainDirty, setDomainDirty] = useState(false);

  // Combined dirty: domain OR brief
  const isDirty = briefDirtyOnly || domainDirty;

  useEffect(() => {
    onDirtyChange(isDirty);
    return () => { onDirtyChange(false); };
  }, [isDirty, onDirtyChange]);

  // Imperative handle for parent — saves/discards BOTH domain + brief
  useImperativeHandle(ref, () => ({
    save() {
      domainRef.current?.save();
      onBriefingChange(localBriefing);
      if (localSuggestions) onSuggestionsChange(localSuggestions);
      setCommittedBriefing(localBriefing);
      setCommittedSuggestions(localSuggestions);
      setDomainDirty(false); // Immediate clear — DomainSection will confirm on next render
    },
    discard() {
      domainRef.current?.discard();
      setLocalBriefing(committedBriefing);
      setLocalSuggestions(committedSuggestions);
    },
    get isDirty() { return isDirty; },
  }), [localBriefing, localSuggestions, committedBriefing, committedSuggestions, isDirty, onBriefingChange, onSuggestionsChange]);

  const availableDocs = documents.filter((d) => d.content || d.fileId || d.pdfBase64);
  const selectedDocs = availableDocs.filter((d) => d.enabled !== false);
  const totalWordCount = selectedDocs.reduce((sum, d) => sum + (d.content ? countWords(d.content) : 0), 0);

  // Abort suggestions on panel close
  useEffect(() => {
    if (!isOpen && isSuggesting && onAbortSuggestions) onAbortSuggestions();
  }, [isOpen, isSuggesting, onAbortSuggestions]);

  const updateField = useCallback((field: keyof typeof BRIEFING_LIMITS, value: string) => {
    const { max } = BRIEFING_LIMITS[field];
    const words = value.split(/\s+/).filter(Boolean);
    const trimmed = words.length > max ? words.slice(0, max).join(' ') : value;
    setLocalBriefing((prev) => ({ ...prev, [field]: trimmed }));
  }, []);

  const handleGenerateBriefing = useCallback(async () => {
    if (!onGenerateSuggestions) { setSuggestError('Generate handler not available'); return; }
    if (availableDocs.length === 0) { setSuggestError('No documents with content available'); return; }
    setLocalBriefing(EMPTY_BRIEFING);
    setLocalSuggestions(null);
    setIsSuggesting(true);
    setSuggestError(null);
    try {
      const result = await onGenerateSuggestions(subject, selectedDocs, totalWordCount);
      setLocalSuggestions(result);
      // Auto-select the first suggestion for each field
      const fields: (keyof typeof BRIEFING_LIMITS)[] = ['objective', 'audience', 'type', 'focus', 'tone'];
      const autoFilled: AutoDeckBriefing = { ...EMPTY_BRIEFING };
      for (const f of fields) {
        const first = result[f]?.[0];
        if (first) autoFilled[f] = first.text;
      }
      setLocalBriefing(autoFilled);
    } catch (err: any) {
      if (err?.name !== 'AbortError') setSuggestError(err?.message || 'Failed to generate suggestions');
    } finally {
      setIsSuggesting(false);
    }
  }, [onGenerateSuggestions, subject, selectedDocs, totalWordCount, availableDocs.length]);

  const handleSave = useCallback(() => {
    onBriefingChange(localBriefing);
    if (localSuggestions) onSuggestionsChange(localSuggestions);
    setCommittedBriefing(localBriefing);
    setCommittedSuggestions(localSuggestions);
  }, [localBriefing, localSuggestions, onBriefingChange, onSuggestionsChange]);

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        {/* ── Domain section ── */}
        <DomainSection
          ref={domainRef}
          darkMode={darkMode}
          nuggetId={nuggetId}
          nuggetName={nuggetName}
          currentDomain={currentDomain}
          isRegeneratingDomain={isRegeneratingDomain}
          domainReviewNeeded={domainReviewNeeded}
          onSaveDomain={onSaveDomain}
          onRegenerateDomain={onRegenerateDomain}
          onDismissDomainReview={onDismissDomainReview}
          onDirtyChange={setDomainDirty}
        />
        {/* ── Divider ── */}
        <div className={`mx-5 border-t ${darkMode ? 'border-zinc-800' : 'border-zinc-200'}`} />
        {/* ── Brief section ── */}
        <div className="px-5 pt-4 pb-3">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <h3 className={`text-[11px] font-semibold uppercase tracking-wider ${darkMode ? 'text-zinc-500' : 'text-zinc-400'}`}>
                Briefing
              </h3>
              {briefReviewNeeded && (
                <span className="text-[9px] font-medium text-amber-500 dark:text-amber-400 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                  Review needed
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleGenerateBriefing}
                disabled={isSuggesting}
                className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
              >
                {isSuggesting ? (
                  <><svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>Analyzing...</>
                ) : (
                  <><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" className={darkMode ? 'text-zinc-400' : 'text-zinc-500'}>
                    <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
                    <path d="M20 3v4M22 5h-4" />
                  </svg>{localSuggestions ? 'Regenerate Briefing' : 'Generate Briefing'}</>
                )}
              </button>
              {briefDirtyOnly && !isSuggesting && (
                <button
                  onClick={handleSave}
                  className={`text-[11px] font-semibold px-2.5 py-0.5 rounded transition-colors ${darkMode ? 'bg-blue-600 hover:bg-blue-500 text-white' : 'bg-blue-600 hover:bg-blue-500 text-white'}`}
                >
                  Update
                </button>
              )}
            </div>
          </div>
          {([
            { field: 'objective' as const, label: 'Objective', required: true, hint: 'What should the audience take away?' },
            { field: 'audience' as const, label: 'Audience', required: true, hint: 'Who will view this?' },
            { field: 'type' as const, label: 'Type', required: true, hint: 'What kind of presentation?' },
            { field: 'focus' as const, label: 'Focus', required: false, hint: 'What to prioritize?' },
            { field: 'tone' as const, label: 'Tone', required: false, hint: 'How should it sound?' },
          ]).map(({ field, label, required, hint }) => {
            const fieldValue = localBriefing[field] || '';
            const fieldWordCount = fieldValue.trim() ? fieldValue.trim().split(/\s+/).length : 0;
            const { min: fieldMin, max: fieldMax } = BRIEFING_LIMITS[field];
            const fieldBelowMin = fieldWordCount > 0 && fieldWordCount < fieldMin;
            const fieldNearMax = fieldWordCount >= fieldMax * 0.85;
            const fwcColor = fieldBelowMin ? 'text-red-500 dark:text-red-400' : fieldNearMax ? 'text-amber-600 dark:text-amber-400' : 'text-zinc-400 dark:text-zinc-500';
            return (
              <div key={field} className="mb-3.5">
                <div className="flex justify-between items-baseline mb-1">
                  <label className={`text-[12px] font-semibold ${darkMode ? 'text-zinc-400' : 'text-zinc-500'}`}>{label}{required && <span className="text-red-500 ml-0.5">*</span>}</label>
                  <span className={`text-[10px] tabular-nums ${fwcColor}`}>{fieldMin}–{fieldMax} words</span>
                </div>
                <select value={localSuggestions?.[field as BriefingFieldName]?.find(o => o.text === fieldValue)?.text ?? ''} onChange={(e) => { if (e.target.value) updateField(field, e.target.value); }} disabled={isSuggesting}
                  className={`w-full py-1.5 px-2.5 rounded-t-md border border-b-0 text-[12px] transition-colors ${darkMode ? 'border-zinc-700 bg-zinc-800/50 text-zinc-200' : 'border-zinc-300 bg-white text-zinc-800'} ${localSuggestions ? 'cursor-pointer' : 'cursor-default'} ${isSuggesting ? 'opacity-50' : ''}`}>
                  <option value="" disabled>{isSuggesting ? 'Generating...' : localSuggestions ? 'Select a suggestion...' : 'No suggestions yet'}</option>
                  {localSuggestions?.[field as BriefingFieldName]?.map((opt, i) => (<option key={i} value={opt.text}>{opt.label}</option>))}
                </select>
                <textarea value={localBriefing[field] || ''} onChange={(e) => {
                    updateField(field, e.target.value);
                    const el = e.target;
                    el.style.height = 'auto';
                    el.style.height = el.scrollHeight + 'px';
                  }} placeholder={hint} rows={1}
                  ref={(el) => { if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; } }}
                  className={`w-full py-2 px-2.5 rounded-b-md border text-[13px] resize-none overflow-hidden focus:outline-none focus:ring-2 focus:ring-zinc-400/50 dark:focus:ring-zinc-500/50 ${darkMode ? 'border-zinc-700 bg-zinc-800/50 text-zinc-200 placeholder:text-zinc-600' : 'border-zinc-300 bg-white text-zinc-800 placeholder:text-zinc-400'}`}
                  style={{ minHeight: 32 }} />
              </div>
            );
          })}

          {briefReviewNeeded && !briefDirtyOnly && !isSuggesting && (
            <div className="flex items-center gap-3 mt-2">
              <button
                onClick={() => onDismissBriefReview(nuggetId)}
                className="text-[11px] font-medium text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 transition-colors flex items-center gap-1.5"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Keep
              </button>
            </div>
          )}
          {suggestError && <div className="text-[11px] text-red-500 dark:text-red-400 mt-1">{suggestError}</div>}
        </div>
        </div>
      </div>
    </div>
  );
});

// ═════════════════════════════════════════════════════════════════
// TAB 3: Assessment
// ═════════════════════════════════════════════════════════════════

function AssessmentTab({
  darkMode, dqafReport, effectiveStatus, isChecking, checkError,
  onRunCheck, onAbortCheck, onFixDocuments, documents, briefing, subject, onTabChange,
}: {
  darkMode: boolean;
  dqafReport: DQAFReport | undefined;
  effectiveStatus: QualityStatus;
  isChecking: boolean;
  checkError: string | null;
  onRunCheck: (engagementPurpose: string) => Promise<void>;
  onAbortCheck: () => void;
  onFixDocuments: () => void;
  documents: UploadedFile[];
  briefing?: AutoDeckBriefing;
  subject?: string;
  onTabChange: (tab: SubjectQualityTab) => void;
}) {
  const derivedPurpose = deriveEngagementPurpose(briefing, subject);
  const hasPurpose = !!derivedPurpose.trim();
  const hasNoReport = !dqafReport;
  const isStale = effectiveStatus === 'stale';

  // ── Pre-assessment states ──
  if (isChecking) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center gap-3">
        <div className="w-8 h-8 border-2 border-zinc-300 dark:border-zinc-600 border-t-blue-500 rounded-full animate-spin" />
        <p className={`text-xs font-medium ${darkMode ? 'text-zinc-300' : 'text-zinc-600'}`}>Analyzing documents…</p>
        <p className={`text-[10px] ${darkMode ? 'text-zinc-500' : 'text-zinc-400'}`}>Checking structure, relevance, and cross-document consistency</p>
        <button onClick={onAbortCheck} className={`text-[11px] font-medium px-3 py-1.5 rounded-lg transition-colors mt-2 ${darkMode ? 'bg-red-900/30 hover:bg-red-900/50 text-red-400' : 'bg-red-50 hover:bg-red-100 text-red-600'}`}>Cancel</button>
      </div>
    );
  }

  if (checkError) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center gap-3 px-8">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-red-500">
          <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
        </svg>
        <p className={`text-xs font-medium ${darkMode ? 'text-red-400' : 'text-red-600'}`}>Assessment failed</p>
        <p className={`text-[10px] max-w-[400px] break-words ${darkMode ? 'text-zinc-500' : 'text-zinc-400'}`}>{checkError}</p>
        <button onClick={() => onRunCheck(derivedPurpose)}
          className={`text-[11px] font-medium px-3 py-1.5 rounded-lg transition-colors mt-1 ${darkMode ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300' : 'bg-zinc-100 hover:bg-zinc-200 text-zinc-700'}`}>Retry</button>
      </div>
    );
  }

  if (!hasPurpose) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-8 py-10 text-center gap-5">
        <div>
          <h3 className="text-[13px] font-semibold mb-2">Document Quality Assessment</h3>
          <p className={`text-[11px] leading-relaxed max-w-md ${darkMode ? 'text-zinc-400' : 'text-zinc-500'}`}>
            DQAF evaluates your documents across relevance profiling, structural integrity, and cross-document consistency.
            To begin, set a domain or fill in the briefing to provide context for the assessment.
          </p>
        </div>
        <div className="flex gap-3">
          <button onClick={() => onTabChange('brief')}
            className={`text-[11px] font-medium px-4 py-2 rounded-lg transition-colors ${darkMode ? 'bg-blue-600 hover:bg-blue-500 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'}`}>
            Set Domain & Brief
          </button>
        </div>
      </div>
    );
  }

  if (hasNoReport || isStale) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-8 py-10 text-center gap-5">
        {isStale && dqafReport && (
          <div className={`w-full max-w-md rounded-lg px-4 py-3 text-[11px] text-left ${darkMode ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'bg-amber-50 text-amber-700 border border-amber-200'}`}>
            Documents have changed since the last assessment. Run a new assessment to update the report.
          </div>
        )}
        <div>
          <p className={`text-[11px] mb-1 ${darkMode ? 'text-zinc-500' : 'text-zinc-400'}`}>Derived from brief + domain:</p>
          <p className={`text-[11px] max-w-md leading-relaxed ${darkMode ? 'text-zinc-400' : 'text-zinc-500'}`}>{derivedPurpose}</p>
        </div>
        <button onClick={() => onRunCheck(derivedPurpose)}
          className={`text-[12px] font-medium px-6 py-2.5 rounded-lg transition-colors ${darkMode ? 'bg-blue-600 hover:bg-blue-500 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'}`}>
          Run Assessment
        </button>
      </div>
    );
  }

  if (!dqafReport) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center">
        <p className={`text-xs ${darkMode ? 'text-zinc-500' : 'text-zinc-400'}`}>No active documents to analyze.</p>
      </div>
    );
  }

  // ── Full report view — clean dashboard ──
  const docLabels = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of dqafReport.documents) m.set(d.documentId, d.documentLabel);
    return m;
  }, [dqafReport.documents]);

  // Collect all issues into a flat sorted list
  const allIssues = useMemo(() => {
    const items: Array<{ severity: string; description: string; impact?: string; docs: string[] }> = [];
    for (const f of dqafReport.crossDocumentFindings) {
      items.push({
        severity: f.severity,
        description: f.description,
        impact: f.productionImpact,
        docs: f.documentsInvolved.map(id => docLabels.get(id) ?? id),
      });
    }
    for (const f of (dqafReport.perDocumentFlags ?? [])) {
      items.push({
        severity: f.severity,
        description: f.description,
        impact: f.crossDocumentConsequence,
        docs: [docLabels.get(f.documentId) ?? f.documentId],
      });
    }
    return items.sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
  }, [dqafReport, docLabels]);

  return (
    <div className="flex flex-col flex-1 overflow-hidden max-w-2xl mx-auto w-full">
      {/* ── 1. Verdict Banner (fixed above scroll) ── */}
      <div className="shrink-0 px-4 pb-2">
        <DashboardVerdictBanner
          verdict={dqafReport.overallVerdict}
          rationale={dqafReport.verdictRationale}
          flags={dqafReport.flagsSummary}
          timestamp={dqafReport.lastCheckTimestamp}
          docCount={dqafReport.documentCountSubmitted}
          darkMode={darkMode}
          onRerun={() => onRunCheck(derivedPurpose)}
        />
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

        {/* ── 2. Document Cards ── */}
        <div>
          <DashboardSectionLabel darkMode={darkMode}>Documents</DashboardSectionLabel>
          <div className="space-y-2 mt-2">
            {dqafReport.documents.map((doc) => (
              <DocumentCard key={doc.documentId} doc={doc} darkMode={darkMode} />
            ))}
          </div>
        </div>

        {/* ── 3. Cross-Document Issues ── */}
        {allIssues.length > 0 && (
          <div>
            <DashboardSectionLabel darkMode={darkMode}>Cross-Document Issues</DashboardSectionLabel>
            <div className="space-y-2 mt-2">
              {allIssues.map((issue, i) => (
                <IssueCard key={i} issue={issue} darkMode={darkMode} />
              ))}
            </div>
          </div>
        )}

        {/* ── 4. Action Items ── */}
        {dqafReport.documentRegister.length > 0 && (
          <div>
            <DashboardSectionLabel darkMode={darkMode}>Action Items</DashboardSectionLabel>
            <div className={`mt-2 rounded-lg border ${darkMode ? 'border-zinc-800 bg-zinc-800/30' : 'border-zinc-200 bg-white'}`}>
              {dqafReport.documentRegister.map((entry, i) => {
                const action = entry.requiredAction || 'No action required';
                const isClean = action.toLowerCase().includes('no action') || action.toLowerCase().includes('use as-is');
                return (
                  <div key={i} className={`flex items-start gap-2.5 px-3 py-2.5 ${i > 0 ? `border-t ${darkMode ? 'border-zinc-800' : 'border-zinc-100'}` : ''}`}>
                    <span className="mt-0.5 shrink-0">
                      {isClean ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-500">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      ) : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-500">
                          <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                        </svg>
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <span className={`text-[11px] font-medium ${darkMode ? 'text-zinc-200' : 'text-zinc-700'}`}>{entry.documentLabel}</span>
                      <p className={`text-[11px] mt-0.5 ${darkMode ? 'text-zinc-400' : 'text-zinc-500'}`}>{action}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── 5. Production Notice ── */}
        {dqafReport.mandatoryProductionNotice && (
          <ProductionNoticeBlock notice={dqafReport.mandatoryProductionNotice} darkMode={darkMode} />
        )}
      </div>
    </div>
  );
}


// ═════════════════════════════════════════════════════════════════
// Dashboard Components
// ═════════════════════════════════════════════════════════════════

function DashboardSectionLabel({ darkMode, children }: { darkMode: boolean; children: React.ReactNode }) {
  return <p className={`text-[10px] font-semibold uppercase tracking-wider ${darkMode ? 'text-zinc-500' : 'text-zinc-400'}`}>{children}</p>;
}

/** Top verdict banner with status, rationale, meta, and re-run */
function DashboardVerdictBanner({ verdict, rationale, flags, timestamp, docCount, darkMode }: {
  verdict: DQAFVerdict; rationale: string; flags: DQAFReport['flagsSummary'];
  timestamp: number; docCount: number; darkMode: boolean; onRerun: () => void;
}) {
  const verdictLabel: Record<DQAFVerdict, string> = {
    ready: 'Ready',
    conditional: 'Conditional',
    not_ready: 'Not Ready',
  };
  const verdictColor: Record<DQAFVerdict, string> = {
    ready: 'text-emerald-600 dark:text-emerald-400',
    conditional: 'text-amber-600 dark:text-amber-400',
    not_ready: 'text-red-600 dark:text-red-400',
  };

  const divider = <div className={`w-px h-5 ${darkMode ? 'bg-zinc-700' : 'bg-zinc-200'}`} />;

  return (
    <div className="space-y-2">
      {/* ── Stats bar ── */}
      <div className={`flex items-center gap-3 text-[8px] rounded-lg px-3 py-1.5 ${darkMode ? 'text-zinc-500 bg-zinc-800' : 'text-zinc-400 bg-zinc-100'}`}>
        <div className="flex flex-col items-center">
          <span className={`font-semibold text-[9px] ${darkMode ? 'text-zinc-300' : 'text-zinc-600'}`}>{new Date(timestamp).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
          <span>Last updated</span>
        </div>
        {divider}
        <div className="flex flex-col items-center">
          <span className={`font-semibold text-[10px] ${verdictColor[verdict]}`}>{verdictLabel[verdict]}</span>
          <span>Status</span>
        </div>
        {divider}
        <div className="flex flex-col items-center">
          <span className="font-semibold text-[10px] text-red-500">{flags?.critical ?? 0}</span>
          <span>Critical</span>
        </div>
        {divider}
        <div className="flex flex-col items-center">
          <span className="font-semibold text-[10px] text-amber-500">{flags?.moderate ?? 0}</span>
          <span>Moderate</span>
        </div>
        {divider}
        <div className="flex flex-col items-center">
          <span className={`font-semibold text-[10px] ${darkMode ? 'text-zinc-400' : 'text-zinc-500'}`}>{flags?.minor ?? 0}</span>
          <span>Minor</span>
        </div>
        {divider}
        <div className="flex flex-col items-center">
          <span className={`font-semibold text-[10px] ${darkMode ? 'text-zinc-300' : 'text-zinc-600'}`}>{docCount}</span>
          <span>Docs</span>
        </div>
      </div>
      {/* ── Rationale ── */}
      <p className={`text-[11px] leading-relaxed ${darkMode ? 'text-zinc-400' : 'text-zinc-500'}`}>{rationale}</p>
    </div>
  );
}

/** Per-document card showing relevance, contribution, and issues */
function DocumentCard({ doc, darkMode }: { doc: DQAFReport['documents'][0]; darkMode: boolean }) {
  const [expanded, setExpanded] = useState(true);

  // Relevance tag
  const relevanceConfig: Record<string, { label: string; color: string }> = {
    primary_source: { label: 'Primary', color: darkMode ? 'bg-emerald-500/15 text-emerald-400' : 'bg-emerald-100 text-emerald-700' },
    supporting_source: { label: 'Supporting', color: darkMode ? 'bg-amber-500/15 text-amber-400' : 'bg-amber-100 text-amber-700' },
    orphan_review_required: { label: 'Weak Fit', color: darkMode ? 'bg-red-500/15 text-red-400' : 'bg-red-100 text-red-700' },
  };
  const rel = relevanceConfig[doc.relevanceInterpretation] ?? { label: doc.relevanceInterpretation, color: darkMode ? 'bg-zinc-700 text-zinc-400' : 'bg-zinc-100 text-zinc-500' };

  // Contribution — use the objective dimension note, or fall back to profile objective
  const contribution = doc.relevanceDimensionScores?.objective?.note || doc.documentProfile?.objective || '';

  // Issues from Pass 1 checks
  const issues: Array<{ label: string; note: string; severity: 'fail' | 'caution' }> = [];
  if (doc.pass1Scores) {
    for (const [checkId, result] of Object.entries(doc.pass1Scores)) {
      if (result.score < 2 && result.note) {
        issues.push({
          label: PASS1_LABELS[checkId as DQAFPass1CheckId] ?? checkId,
          note: result.note,
          severity: result.score === 0 ? 'fail' : 'caution',
        });
      }
    }
  }

  const hasIssues = issues.length > 0;

  return (
    <div className={`rounded-lg border ${darkMode ? 'border-zinc-800 bg-zinc-800/30' : 'border-zinc-200 bg-white'}`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left"
      >
        {/* Chevron */}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          className={`shrink-0 transition-transform ${darkMode ? 'text-zinc-500' : 'text-zinc-400'} ${expanded ? '' : '-rotate-90'}`}>
          <polyline points="6 9 12 15 18 9" />
        </svg>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-[12px] font-medium truncate ${darkMode ? 'text-zinc-200' : 'text-zinc-700'}`}>{doc.documentLabel}</span>
            <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full shrink-0 ${rel.color}`}>{rel.label}</span>
          </div>
        </div>

        {/* Issue count badge */}
        {hasIssues && (
          <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full shrink-0 ${
            issues.some(i => i.severity === 'fail')
              ? 'bg-red-500/15 text-red-500'
              : 'bg-amber-500/15 text-amber-500'
          }`}>
            {issues.length} issue{issues.length !== 1 ? 's' : ''}
          </span>
        )}
      </button>

      {expanded && (
        <div className={`px-3 pb-3 pt-0 border-t ${darkMode ? 'border-zinc-800' : 'border-zinc-100'}`}>
          {/* Contribution line */}
          {contribution && (
            <p className={`text-[11px] mt-2 ${darkMode ? 'text-zinc-400' : 'text-zinc-500'}`}>{contribution}</p>
          )}

          {/* Issues */}
          {hasIssues ? (
            <div className="mt-2 space-y-1.5">
              {issues.map((issue, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className={`mt-0.5 w-1.5 h-1.5 rounded-full shrink-0 ${issue.severity === 'fail' ? 'bg-red-500' : 'bg-amber-500'}`} />
                  <div className="min-w-0">
                    <span className={`text-[10px] font-medium ${darkMode ? 'text-zinc-300' : 'text-zinc-600'}`}>{issue.label}: </span>
                    <span className={`text-[10px] ${darkMode ? 'text-zinc-400' : 'text-zinc-500'}`}>{issue.note}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className={`text-[10px] mt-2 flex items-center gap-1.5 ${darkMode ? 'text-emerald-400' : 'text-emerald-600'}`}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              All checks passed
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** Cross-document issue card — simplified from FindingCard */
function IssueCard({ issue, darkMode }: { issue: { severity: string; description: string; impact?: string; docs: string[] }; darkMode: boolean }) {
  const leftBorder: Record<string, string> = { critical: 'border-l-red-500', moderate: 'border-l-amber-500', minor: darkMode ? 'border-l-zinc-500' : 'border-l-zinc-400' };
  const sevColor: Record<string, string> = { critical: 'text-red-500', moderate: 'text-amber-500', minor: darkMode ? 'text-zinc-400' : 'text-zinc-500' };

  return (
    <div className={`rounded-lg border border-l-[3px] px-3 py-2.5 ${darkMode ? 'border-zinc-800 bg-zinc-800/30' : 'border-zinc-200 bg-white'} ${leftBorder[issue.severity] ?? ''}`}>
      <div className="flex items-center gap-2 mb-1">
        <span className={`text-[9px] font-semibold uppercase ${sevColor[issue.severity] ?? ''}`}>{issue.severity}</span>
        {issue.docs.length > 0 && (
          <span className={`text-[9px] ${darkMode ? 'text-zinc-500' : 'text-zinc-400'}`}>
            {issue.docs.join(' · ')}
          </span>
        )}
      </div>
      <p className={`text-[11px] leading-relaxed ${darkMode ? 'text-zinc-300' : 'text-zinc-600'}`}>{issue.description}</p>
      {issue.impact && (
        <p className={`text-[10px] mt-1 ${darkMode ? 'text-zinc-500' : 'text-zinc-400'}`}>
          Impact: {issue.impact}
        </p>
      )}
    </div>
  );
}

/** Production notice — shown when critical issues exist */
function ProductionNoticeBlock({ notice, darkMode }: { notice: DQAFProductionNotice; darkMode: boolean }) {
  return (
    <div className={`rounded-lg border-2 p-4 ${darkMode ? 'border-red-500/30 bg-red-500/5' : 'border-red-200 bg-red-50/50'}`}>
      <div className="flex items-center gap-2 mb-2">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-500 shrink-0">
          <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        <span className={`text-[11px] font-semibold ${darkMode ? 'text-red-400' : 'text-red-700'}`}>Production Notice</span>
      </div>
      <p className={`text-[11px] leading-relaxed ${darkMode ? 'text-zinc-300' : 'text-zinc-600'}`}>{notice.summary}</p>
      {notice.productionConsequence && (
        <p className={`text-[10px] mt-1.5 ${darkMode ? 'text-zinc-400' : 'text-zinc-500'}`}>{notice.productionConsequence}</p>
      )}
    </div>
  );
}

export default React.memo(SubjectQualityPanel);
