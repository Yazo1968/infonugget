import React, { useState, useRef, useEffect, useCallback, useMemo, useImperativeHandle, forwardRef } from 'react';
import { createPortal } from 'react-dom';
import {
  DQAFReport,
  DQAFDocumentAssessment,
  DQAFCrossDocFinding,
  DQAFPerDocumentFlag,
  DQAFCompatibilityRecord,
  DQAFCheckResult,
  DQAFProductionNotice,
  DQAFDocumentRegister,
  DQAFKPIs,
  DQAFSeverity,
  DQAFPass1CheckId,
  DQAFPass2CheckId,
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
  // Subject
  nuggetId: string;
  nuggetName: string;
  currentSubject: string;
  isRegeneratingSubject: boolean;
  subjectReviewNeeded: boolean;
  onSaveSubject: (nuggetId: string, subject: string) => void;
  onRegenerateSubject: (nuggetId: string) => void;
  onDismissSubjectReview: (nuggetId: string) => void;
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

const PASS2_LABELS: Record<DQAFPass2CheckId, string> = {
  'P2-02': 'Data Point Conflicts',
  'P2-03': 'Terminology Consistency',
  'P2-04': 'Scope Overlap',
  'P2-05': 'Version Conflict',
  'P2-06': 'Orphaned Document',
};

const DIMENSION_LABELS: Record<string, string> = {
  objective: 'Objective',
  audience: 'Audience',
  type: 'Type',
  focus: 'Focus',
  tone: 'Tone',
};

const DIMENSION_WEIGHTS: Record<string, number> = {
  objective: 0.30,
  audience: 0.20,
  type: 0.15,
  focus: 0.25,
  tone: 0.10,
};

const SEVERITY_ORDER: Record<string, number> = { critical: 0, moderate: 1, minor: 2 };
const severityRank = (s: string): number => SEVERITY_ORDER[s] ?? 3;

const SEVERITY_SUBLABELS: Record<string, string> = {
  critical: 'will directly distort output',
  moderate: 'usable with disclosed caveat',
  minor: 'no material impact',
};

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
export function deriveEngagementPurpose(briefing?: AutoDeckBriefing, subject?: string): string {
  const parts: string[] = [];
  if (briefing?.objective) parts.push(`Objective: ${briefing.objective}`);
  if (briefing?.audience) parts.push(`Audience: ${briefing.audience}`);
  if (briefing?.type) parts.push(`Type: ${briefing.type}`);
  if (briefing?.tone) parts.push(`Tone: ${briefing.tone}`);
  if (briefing?.focus) parts.push(`Focus: ${briefing.focus}`);
  if (subject) parts.push(`Subject: ${subject}`);
  return parts.join('. ');
}

// ─────────────────────────────────────────────────────────────────
// Tab bar
// ─────────────────────────────────────────────────────────────────

type SidebarSection = 'overview' | 'conflicts' | 'register' | `doc-${string}`;

const TAB_ITEMS: { id: SubjectQualityTab; label: string }[] = [
  { id: 'logs', label: 'Logs' },
  { id: 'brief', label: 'Subject & Brief' },
  { id: 'assessment', label: 'Assessment' },
];

// ─────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────

const SubjectQualityPanel: React.FC<SubjectQualityPanelProps> = (props) => {
  const {
    isOpen, activeTab, onTabChange, tabBarRef,
    // Subject
    nuggetId, nuggetName, currentSubject, isRegeneratingSubject,
    subjectReviewNeeded, onSaveSubject, onRegenerateSubject, onDismissSubjectReview,
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
    // If leaving the brief tab with unsaved changes, intercept
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
      className={`fixed z-[106] flex flex-col ${darkMode ? 'bg-zinc-900 text-zinc-200' : 'bg-white text-zinc-800'} border-l shadow-[5px_0_6px_rgba(0,0,0,0.35)] overflow-hidden`}
      style={overlayStyle}
    >
      {/* ── Tab Bar ── */}
      <div className={`shrink-0 border-b ${darkMode ? 'border-zinc-800' : 'border-zinc-200'}`}>
        <div className="flex max-w-2xl mx-auto w-full">
          {TAB_ITEMS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => handleTabClick(tab.id)}
                className={`flex-1 py-2.5 text-[11px] font-semibold tracking-wide transition-colors relative ${
                  isActive
                    ? darkMode ? 'text-zinc-100' : 'text-zinc-800'
                    : darkMode ? 'text-zinc-500 hover:text-zinc-400' : 'text-zinc-400 hover:text-zinc-600'
                }`}
              >
                {tab.label}
                {isActive && (
                  <div className={`absolute bottom-0 left-2 right-2 h-[2px] rounded-full ${darkMode ? 'bg-blue-400' : 'bg-blue-600'}`} />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Tab Content ── */}
      {activeTab === 'logs' && (
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
      )}
      {activeTab === 'brief' && (
        <BriefTab
          ref={briefTabRef}
          darkMode={darkMode}
          // Subject
          nuggetId={nuggetId}
          nuggetName={nuggetName}
          currentSubject={currentSubject}
          isRegeneratingSubject={isRegeneratingSubject}
          subjectReviewNeeded={subjectReviewNeeded}
          onSaveSubject={onSaveSubject}
          onRegenerateSubject={onRegenerateSubject}
          onDismissSubjectReview={onDismissSubjectReview}
          // Brief
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
      )}
      {activeTab === 'assessment' && (
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
      )}

      {/* ── Unsaved brief changes dialog ── */}
      {pendingTab !== null && (
        <UnsavedChangesDialog
          onSave={handleDialogSave}
          onDiscard={handleDialogDiscard}
          onCancel={handleDialogCancel}
          title="Unsaved changes"
          description="You have unsaved edits to the subject or briefing. Save or discard them to continue."
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

// ── Subject Section (inline edit, forwardRef for draft-mode gating) ──

interface SubjectSectionHandle {
  save: () => void;
  discard: () => void;
  readonly isDirty: boolean;
}

const SubjectSection = forwardRef<SubjectSectionHandle, {
  darkMode: boolean;
  nuggetId: string;
  nuggetName: string;
  currentSubject: string;
  isRegeneratingSubject: boolean;
  subjectReviewNeeded: boolean;
  onSaveSubject: (nuggetId: string, subject: string) => void;
  onRegenerateSubject: (nuggetId: string) => void;
  onDismissSubjectReview: (nuggetId: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
}>(function SubjectSection({
  darkMode, nuggetId, nuggetName, currentSubject, isRegeneratingSubject,
  subjectReviewNeeded, onSaveSubject, onRegenerateSubject, onDismissSubjectReview,
  onDirtyChange,
}, ref) {
  const [localSubject, setLocalSubject] = useState(currentSubject);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync when external value changes (e.g. regeneration completes, nugget switch)
  useEffect(() => {
    if (currentSubject !== localSubject && !isRegeneratingSubject) {
      setLocalSubject(currentSubject);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSubject, isRegeneratingSubject]);

  const handleSave = useCallback(() => {
    const trimmed = localSubject.trim();
    if (trimmed && trimmed !== currentSubject) {
      onSaveSubject(nuggetId, trimmed);
    }
  }, [localSubject, currentSubject, nuggetId, onSaveSubject]);

  const subjectIsDirty = localSubject.trim() !== currentSubject;

  useEffect(() => { onDirtyChange?.(subjectIsDirty); }, [subjectIsDirty, onDirtyChange]);

  useImperativeHandle(ref, () => ({
    save() { handleSave(); },
    discard() { setLocalSubject(currentSubject); },
    get isDirty() { return subjectIsDirty; },
  }), [handleSave, currentSubject, subjectIsDirty]);

  return (
    <div className="shrink-0 px-5 pt-4 pb-3">
      <div className="max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <h3 className={`text-[11px] font-semibold uppercase tracking-wider ${darkMode ? 'text-zinc-500' : 'text-zinc-400'}`}>
            Subject
          </h3>
          {subjectReviewNeeded && (
            <span className="text-[9px] font-medium text-amber-500 dark:text-amber-400 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              Review needed
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => onRegenerateSubject(nuggetId)}
            disabled={isRegeneratingSubject}
            className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            {isRegeneratingSubject ? (
              <><svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>Regenerating...</>
            ) : (
              <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
              </svg>Regenerate</>
            )}
          </button>
          {subjectIsDirty && (
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
        value={localSubject}
        onChange={(e) => setLocalSubject(e.target.value)}
        rows={2}
        disabled={isRegeneratingSubject}
        className={`w-full px-3 py-2 text-xs border rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-400/50 dark:focus:ring-zinc-500/50 resize-none disabled:opacity-50 disabled:cursor-not-allowed ${
          darkMode ? 'border-zinc-700 bg-zinc-800 text-zinc-100' : 'border-zinc-200 bg-white text-zinc-800'
        }`}
        placeholder="e.g. Quarterly financial performance analysis for a mid-cap technology company covering revenue, margins, and growth projections."
      />
      <p className={`text-[10px] mt-1 ${darkMode ? 'text-zinc-600' : 'text-zinc-400'}`}>
        Topic sentence to prime AI as a domain expert. Keep it specific (15-40 words).
      </p>

      {subjectReviewNeeded && !subjectIsDirty && !isRegeneratingSubject && (
        <div className="flex items-center gap-3 mt-2">
          <button
            onClick={() => onDismissSubjectReview(nuggetId)}
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
          Sources Log
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
        <div className={`flex items-center gap-3 text-[10px] rounded-lg px-3 py-2 ${darkMode ? 'text-zinc-500 bg-zinc-800/50' : 'text-zinc-400 bg-zinc-50'}`}>
          <div className="flex flex-col items-center">
            <span className={`font-semibold text-xs ${darkMode ? 'text-zinc-300' : 'text-zinc-600'}`}>{sourcesLogStats.lastUpdated ? formatLogTimestamp(sourcesLogStats.lastUpdated) : '—'}</span>
            <span>Last updated</span>
          </div>
          <div className={`w-px h-6 ${darkMode ? 'bg-zinc-700' : 'bg-zinc-200'}`} />
          <div className="flex flex-col items-center">
            <span className={`font-semibold text-xs ${darkMode ? 'text-zinc-300' : 'text-zinc-600'}`}>{sourcesLog.length}</span>
            <span>Shown</span>
          </div>
          <div className={`w-px h-6 ${darkMode ? 'bg-zinc-700' : 'bg-zinc-200'}`} />
          <div className="flex flex-col items-center">
            <span className={`font-semibold text-xs ${darkMode ? 'text-zinc-300' : 'text-zinc-600'}`}>{sourcesLogStats.logsCreated}</span>
            <span>Created</span>
          </div>
          <div className={`w-px h-6 ${darkMode ? 'bg-zinc-700' : 'bg-zinc-200'}`} />
          <div className="flex flex-col items-center">
            <span className={`font-semibold text-xs ${darkMode ? 'text-zinc-300' : 'text-zinc-600'}`}>{sourcesLogStats.logsDeleted}</span>
            <span>Deleted</span>
          </div>
          <div className={`w-px h-6 ${darkMode ? 'bg-zinc-700' : 'bg-zinc-200'}`} />
          <div className="flex flex-col items-center">
            <span className={`font-semibold text-xs ${darkMode ? 'text-zinc-300' : 'text-zinc-600'}`}>{sourcesLogStats.logsArchived}</span>
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
  // Subject
  nuggetId: string;
  nuggetName: string;
  currentSubject: string;
  isRegeneratingSubject: boolean;
  subjectReviewNeeded: boolean;
  onSaveSubject: (nuggetId: string, subject: string) => void;
  onRegenerateSubject: (nuggetId: string) => void;
  onDismissSubjectReview: (nuggetId: string) => void;
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
  // Subject
  nuggetId, nuggetName, currentSubject, isRegeneratingSubject,
  subjectReviewNeeded, onSaveSubject, onRegenerateSubject, onDismissSubjectReview,
  // Brief
  briefing, briefingSuggestions, briefReviewNeeded, onBriefingChange, onSuggestionsChange, onDismissBriefReview, onDirtyChange, documents, subject,
  onGenerateSuggestions, onAbortSuggestions, isOpen,
}, ref) {
  // Subject ref for combined dirty gating
  const subjectRef = useRef<SubjectSectionHandle>(null);
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

  // Subject dirty state (updated via SubjectSection callback)
  const [subjectDirty, setSubjectDirty] = useState(false);

  // Combined dirty: subject OR brief
  const isDirty = briefDirtyOnly || subjectDirty;

  useEffect(() => { onDirtyChange(isDirty); }, [isDirty, onDirtyChange]);

  // Imperative handle for parent — saves/discards BOTH subject + brief
  useImperativeHandle(ref, () => ({
    save() {
      subjectRef.current?.save();
      onBriefingChange(localBriefing);
      if (localSuggestions) onSuggestionsChange(localSuggestions);
      setCommittedBriefing(localBriefing);
      setCommittedSuggestions(localSuggestions);
      setSubjectDirty(false); // Immediate clear — SubjectSection will confirm on next render
    },
    discard() {
      subjectRef.current?.discard();
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
        {/* ── Subject section ── */}
        <SubjectSection
          ref={subjectRef}
          darkMode={darkMode}
          nuggetId={nuggetId}
          nuggetName={nuggetName}
          currentSubject={currentSubject}
          isRegeneratingSubject={isRegeneratingSubject}
          subjectReviewNeeded={subjectReviewNeeded}
          onSaveSubject={onSaveSubject}
          onRegenerateSubject={onRegenerateSubject}
          onDismissSubjectReview={onDismissSubjectReview}
          onDirtyChange={setSubjectDirty}
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
                <textarea value={localBriefing[field] || ''} onChange={(e) => updateField(field, e.target.value)} placeholder={hint} rows={2}
                  className={`w-full py-2 px-2.5 rounded-b-md border text-[13px] resize-y focus:outline-none focus:ring-2 focus:ring-zinc-400/50 dark:focus:ring-zinc-500/50 ${darkMode ? 'border-zinc-700 bg-zinc-800/50 text-zinc-200 placeholder:text-zinc-600' : 'border-zinc-300 bg-white text-zinc-800 placeholder:text-zinc-400'}`} />
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
  const [activeSection, setActiveSection] = useState<SidebarSection>('overview');

  const derivedPurpose = deriveEngagementPurpose(briefing, subject);
  const hasPurpose = !!derivedPurpose.trim();
  const hasNoReport = !dqafReport;
  const isStale = effectiveStatus === 'stale';

  // ── Pre-assessment states ──
  if (isChecking) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center gap-3">
        <div className="w-8 h-8 border-2 border-zinc-300 dark:border-zinc-600 border-t-blue-500 rounded-full animate-spin" />
        <p className={`text-xs font-medium ${darkMode ? 'text-zinc-300' : 'text-zinc-600'}`}>Running DQAF Assessment</p>
        <p className={`text-[10px] ${darkMode ? 'text-zinc-500' : 'text-zinc-400'}`}>Profiling documents, running structural checks, analyzing cross-document relationships...</p>
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
            To begin, set a subject or fill in the briefing to provide context for the assessment.
          </p>
        </div>
        <div className="flex gap-3">
          <button onClick={() => onTabChange('brief')}
            className={`text-[11px] font-medium px-4 py-2 rounded-lg transition-colors ${darkMode ? 'bg-blue-600 hover:bg-blue-500 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'}`}>
            Set Subject & Brief
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
          <p className={`text-[11px] mb-1 ${darkMode ? 'text-zinc-500' : 'text-zinc-400'}`}>Derived from brief + subject:</p>
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

  // ── Full report view ──
  return (
    <div className="flex flex-col flex-1 overflow-hidden max-w-4xl mx-auto w-full">
      {/* Header bar */}
      <div className={`shrink-0 px-4 py-3 border-b ${darkMode ? 'border-zinc-800' : 'border-zinc-200'}`}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <VerdictBadge verdict={dqafReport.overallVerdict} size="sm" />
            <div className="min-w-0">
              <h2 className="text-sm font-semibold truncate">Document Quality Assessment</h2>
              <p className={`text-[10px] truncate mt-0.5 ${darkMode ? 'text-zinc-500' : 'text-zinc-400'}`}>{derivedPurpose}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={() => onRunCheck(derivedPurpose)}
              className={`text-[11px] font-medium px-3 py-1.5 rounded-lg transition-colors ${darkMode ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300' : 'bg-zinc-100 hover:bg-zinc-200 text-zinc-700'}`}>
              Re-run Assessment
            </button>
          </div>
        </div>
        <div className="flex items-center gap-3 mt-2">
          <MetadataChip label={`${dqafReport.documentCountSubmitted} doc${dqafReport.documentCountSubmitted !== 1 ? 's' : ''}`} darkMode={darkMode} />
          <MetadataChip label={formatAssessmentTimestamp(dqafReport.lastCheckTimestamp)} darkMode={darkMode} />
          {dqafReport.flagsSummary && <FlagChips flags={dqafReport.flagsSummary} darkMode={darkMode} />}
        </div>
      </div>

      {/* Sidebar + Content */}
      <div className="flex flex-1 overflow-hidden">
        <AssessmentSidebar darkMode={darkMode} activeSection={activeSection} onSelect={setActiveSection} report={dqafReport} />
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {activeSection === 'overview' ? (
            <SetOverview report={dqafReport} darkMode={darkMode} />
          ) : activeSection === 'conflicts' ? (
            <ConflictsAndFlags report={dqafReport} darkMode={darkMode} />
          ) : activeSection === 'register' ? (
            <DocumentRegisterView report={dqafReport} darkMode={darkMode} />
          ) : activeSection.startsWith('doc-') ? (
            <PerDocumentDetail docId={activeSection.slice(4)} report={dqafReport} darkMode={darkMode} />
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════
// Assessment Sub-Components (from QualityPanel.tsx)
// ═════════════════════════════════════════════════════════════════

function AssessmentSidebar({ darkMode, activeSection, onSelect, report }: { darkMode: boolean; activeSection: SidebarSection; onSelect: (s: SidebarSection) => void; report: DQAFReport }) {
  const totalFlags = (report.flagsSummary?.critical ?? 0) + (report.flagsSummary?.moderate ?? 0) + (report.flagsSummary?.minor ?? 0);
  return (
    <div className={`shrink-0 w-[170px] border-r overflow-y-auto ${darkMode ? 'border-zinc-800 bg-zinc-900/50' : 'border-zinc-200 bg-zinc-50/50'}`}>
      <div className={`px-3 pt-3 pb-1.5 text-[9px] font-semibold uppercase tracking-wider ${darkMode ? 'text-zinc-600' : 'text-zinc-400'}`}>Set Level</div>
      <SidebarItem active={activeSection === 'overview'} onClick={() => onSelect('overview')} darkMode={darkMode}>
        <span className="flex-1 truncate">Set Overview</span>
        <ScoreBadge score={report.kpis.overallSetReadinessScore} size="xs" />
      </SidebarItem>
      <div className={`px-3 pt-3 pb-1.5 text-[9px] font-semibold uppercase tracking-wider ${darkMode ? 'text-zinc-600' : 'text-zinc-400'}`}>Documents</div>
      {report.documents.map((doc) => (
        <SidebarItem key={doc.documentId} active={activeSection === `doc-${doc.documentId}`} onClick={() => onSelect(`doc-${doc.documentId}`)} darkMode={darkMode}>
          <span className="flex-1 truncate text-[10px]">{doc.documentLabel}</span>
          <ScoreBadge score={doc.documentReadinessScore} size="xs" />
        </SidebarItem>
      ))}
      <div className={`px-3 pt-3 pb-1.5 text-[9px] font-semibold uppercase tracking-wider ${darkMode ? 'text-zinc-600' : 'text-zinc-400'}`}>Cross Documents</div>
      <SidebarItem active={activeSection === 'conflicts'} onClick={() => onSelect('conflicts')} darkMode={darkMode}>
        <span className="flex-1 truncate">Conflicts & Flags</span>
        {totalFlags > 0 && <span className="shrink-0 text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-500">{totalFlags}</span>}
      </SidebarItem>
      <SidebarItem active={activeSection === 'register'} onClick={() => onSelect('register')} darkMode={darkMode}>
        <span className="flex-1 truncate">Document Register</span>
      </SidebarItem>
    </div>
  );
}

function SidebarItem({ active, onClick, darkMode, children }: { active: boolean; onClick: () => void; darkMode: boolean; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-left transition-colors ${active ? (darkMode ? 'bg-zinc-800 text-zinc-200' : 'bg-zinc-200/70 text-zinc-800') : (darkMode ? 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-300' : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-700')}`}>
      {children}
    </button>
  );
}

// ── Set Overview ──

function SetOverview({ report, darkMode }: { report: DQAFReport; darkMode: boolean }) {
  const kpis = report.kpis;
  return (
    <div className="space-y-5">
      <VerdictBanner verdict={report.overallVerdict} rationale={report.verdictRationale} flags={report.flagsSummary} darkMode={darkMode} />
      <div>
        <SectionLabel darkMode={darkMode}>Key Performance Indicators</SectionLabel>
        <div className="grid grid-cols-2 xl:grid-cols-3 gap-3 mt-2">
          <KpiTile label="Document Relevance" value={kpis.documentRelevanceRate} description="Avg relevance of all docs to engagement purpose" darkMode={darkMode} />
          <KpiTile label="Internal Integrity" value={kpis.internalIntegrityRate} description="Docs with perfect internal consistency" darkMode={darkMode} />
          <KpiTile label="Cross-Doc Consistency" value={kpis.crossDocumentConsistencyScore} description="Cross-document checks without findings" darkMode={darkMode} />
          <KpiTile label="Version Confidence" value={kpis.versionConfidenceRate} description="Version clarity within and across docs" darkMode={darkMode} />
          <KpiTile label="Structural Coherence" value={kpis.structuralCoherenceRate} description="Docs with complete structural integrity" darkMode={darkMode} />
        </div>
      </div>
      <div>
        <SectionLabel darkMode={darkMode}>Weighted Readiness Score</SectionLabel>
        <div className={`mt-2 rounded-lg p-4 ${darkMode ? 'bg-zinc-800/50' : 'bg-zinc-50'}`}>
          <div className="flex items-center gap-4 mb-3">
            <ScoreRing score={kpis.overallSetReadinessScore} size={56} />
            <div>
              <p className="text-[13px] font-semibold">{kpis.overallSetReadinessScore.toFixed(1)}%</p>
              <p className={`text-[10px] ${darkMode ? 'text-zinc-500' : 'text-zinc-400'}`}>
                {kpis.overallSetReadinessScore >= 90 ? 'Ready for production' : kpis.overallSetReadinessScore >= 70 ? 'Conditional — review flagged items' : 'Not ready — critical issues found'}
              </p>
            </div>
          </div>
          <div className="space-y-2">
            <WeightedBar label="Internal Integrity" value={kpis.internalIntegrityRate} weight="30%" darkMode={darkMode} />
            <WeightedBar label="Cross-Doc Consistency" value={kpis.crossDocumentConsistencyScore} weight="30%" darkMode={darkMode} />
            <WeightedBar label="Document Relevance" value={kpis.documentRelevanceRate} weight="20%" darkMode={darkMode} />
            <WeightedBar label="Version Confidence" value={kpis.versionConfidenceRate} weight="10%" darkMode={darkMode} />
            <WeightedBar label="Structural Coherence" value={kpis.structuralCoherenceRate} weight="10%" darkMode={darkMode} />
          </div>
        </div>
      </div>
      {report.engagementPurposeProfile && (
        <div><SectionLabel darkMode={darkMode}>Engagement Purpose Profile</SectionLabel><ProfileTable profile={report.engagementPurposeProfile} darkMode={darkMode} /></div>
      )}
      {report.mandatoryProductionNotice && <ProductionNoticeBlock notice={report.mandatoryProductionNotice} darkMode={darkMode} />}
    </div>
  );
}

// ── Per Document Detail ──

function PerDocumentDetail({ docId, report, darkMode }: { docId: string; report: DQAFReport; darkMode: boolean }) {
  const doc = report.documents.find((d) => d.documentId === docId);
  if (!doc) return <p className={`text-xs ${darkMode ? 'text-zinc-500' : 'text-zinc-400'}`}>Document not found in this assessment.</p>;
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <ScoreRing score={doc.documentReadinessScore} size={48} />
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-semibold truncate">{doc.documentLabel}</h3>
          <div className="flex flex-wrap items-center gap-1.5 mt-1">
            <VerdictBadge verdict={doc.documentVerdict} size="xs" />
            {doc.metadata.detectedTitle && <MetadataTag label={doc.metadata.detectedTitle} darkMode={darkMode} />}
            {doc.metadata.detectedDate && <MetadataTag label={doc.metadata.detectedDate} darkMode={darkMode} />}
            {doc.metadata.detectedVersion && <MetadataTag label={doc.metadata.detectedVersion} darkMode={darkMode} />}
            {doc.metadata.detectedSource && <MetadataTag label={doc.metadata.detectedSource} darkMode={darkMode} />}
          </div>
        </div>
      </div>
      <div>
        <SectionLabel darkMode={darkMode}>Relevance Profile</SectionLabel>
        <div className={`mt-2 rounded-lg ${darkMode ? 'bg-zinc-800/50' : 'bg-zinc-50'}`}>
          <div className="p-3 flex items-center gap-3">
            <div className="flex-1">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] font-medium">Score A: {doc.relevanceScoreA.toFixed(0)}%</span>
                <RelevanceLabel interpretation={doc.relevanceInterpretation} />
              </div>
              <ProgressBar value={doc.relevanceScoreA} darkMode={darkMode} />
            </div>
          </div>
          <div className={`border-t px-3 py-2 ${darkMode ? 'border-zinc-700' : 'border-zinc-200'}`}>
            <table className="w-full text-[10px]">
              <thead><tr className={darkMode ? 'text-zinc-500' : 'text-zinc-400'}>
                <th className="text-left py-1 font-medium">Dimension</th>
                <th className="text-left py-1 font-medium">Engagement Profile</th>
                <th className="text-left py-1 font-medium">Document Profile</th>
                <th className="text-center py-1 font-medium w-16">Score</th>
              </tr></thead>
              <tbody>
                {(['objective', 'focus', 'audience', 'type', 'tone'] as const).map((dim) => {
                  const dimScore = doc.relevanceDimensionScores[dim];
                  const engProfile = report.engagementPurposeProfile;
                  return (
                    <tr key={dim} className={`border-t ${darkMode ? 'border-zinc-800' : 'border-zinc-100'}`}>
                      <td className="py-1.5 font-medium">{DIMENSION_LABELS[dim]}<span className={`ml-1 ${darkMode ? 'text-zinc-600' : 'text-zinc-400'}`}>({(DIMENSION_WEIGHTS[dim] * 100).toFixed(0)}%)</span></td>
                      <td className={`py-1.5 ${darkMode ? 'text-zinc-400' : 'text-zinc-500'}`}>{engProfile?.[dim] ?? '—'}</td>
                      <td className={`py-1.5 ${darkMode ? 'text-zinc-400' : 'text-zinc-500'}`}>{doc.documentProfile[dim]}</td>
                      <td className="py-1.5 text-center">{dimScore ? <ScorePill score={dimScore.alignmentScore} maxScore={2} label={dimScore.alignmentLabel} /> : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <div>
        <SectionLabel darkMode={darkMode}>Structural Checks (Pass 1)</SectionLabel>
        <div className="grid grid-cols-2 gap-2 mt-2">
          {(Object.keys(PASS1_LABELS) as DQAFPass1CheckId[]).map((checkId) => (
            <CheckCard key={checkId} checkId={checkId} label={PASS1_LABELS[checkId]} result={doc.pass1Scores[checkId]} darkMode={darkMode} />
          ))}
        </div>
      </div>
      <div><SectionLabel darkMode={darkMode}>Document Profile</SectionLabel><ProfileTable profile={doc.documentProfile} darkMode={darkMode} /></div>
    </div>
  );
}

// ── Conflicts & Flags ──

function ConflictsAndFlags({ report, darkMode }: { report: DQAFReport; darkMode: boolean }) {
  const compatibility = report.interDocumentCompatibility;
  const findings = report.crossDocumentFindings;
  const perDocFlags = report.perDocumentFlags ?? [];

  const docLabels = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of report.documents) m.set(d.documentId, d.documentLabel);
    return m;
  }, [report.documents]);

  // Split cross-doc findings by scope
  const setLevelFindings = useMemo(() =>
    findings.filter(f => f.scope === 'whole_set').sort((a, b) => severityRank(a.severity) - severityRank(b.severity)),
    [findings]
  );
  const betweenFindings = useMemo(() =>
    findings.filter(f => f.scope !== 'whole_set').sort((a, b) => severityRank(a.severity) - severityRank(b.severity)),
    [findings]
  );
  const sortedPerDocFlags = useMemo(() =>
    [...perDocFlags].sort((a, b) => severityRank(a.severity) - severityRank(b.severity)),
    [perDocFlags]
  );

  const hasGroupA = compatibility.length > 0 || setLevelFindings.length > 0;
  const hasGroupB = betweenFindings.length > 0;
  const hasGroupC = sortedPerDocFlags.length > 0;

  if (!hasGroupA && !hasGroupB && !hasGroupC) {
    return (
      <div className={`rounded-lg px-4 py-6 text-center text-[11px] ${darkMode ? 'bg-zinc-800/50 text-zinc-500' : 'bg-zinc-50 text-zinc-400'}`}>
        No cross-document conflicts or issues found.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ScopeLegend darkMode={darkMode} />

      {/* Group A: Whole Set */}
      {hasGroupA && (
        <div>
          <ScopeStripe scope="set" label="Whole Set" note="Inter-document compatibility — describes the set as a whole" darkMode={darkMode} />
          {compatibility.length > 0 && (
            <div className="mt-3 space-y-3">
              {compatibility.map((record, i) => <CompatibilityCard key={i} record={record} docLabels={docLabels} darkMode={darkMode} />)}
            </div>
          )}
          {setLevelFindings.length > 0 && (
            <div className="mt-3">
              <SeverityGroupedFindings findings={setLevelFindings} docLabels={docLabels} darkMode={darkMode} />
            </div>
          )}
        </div>
      )}

      {/* Group B: Between Documents */}
      {hasGroupB && (
        <div>
          <ScopeStripe scope="between" label="Between Documents" note="Issues from comparing documents against each other" darkMode={darkMode} />
          <div className="mt-3">
            <SeverityGroupedFindings findings={betweenFindings} docLabels={docLabels} darkMode={darkMode} />
          </div>
        </div>
      )}

      {/* Group C: This Document */}
      {hasGroupC && (
        <div>
          <ScopeStripe scope="doc" label="This Document" note="Internal to one document, but with cross-document consequences" darkMode={darkMode} />
          <div className="mt-3">
            <SeverityGroupedPerDocFlags flags={sortedPerDocFlags} docLabels={docLabels} darkMode={darkMode} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Scope helpers ──

type ScopeKind = 'set' | 'between' | 'doc';

const SCOPE_STYLES: Record<ScopeKind, { light: string; dark: string; dot: string }> = {
  set:     { light: 'bg-blue-50 text-blue-600 border-blue-200', dark: 'bg-blue-500/10 text-blue-400 border-blue-500/20', dot: 'bg-blue-500' },
  between: { light: 'bg-amber-50 text-amber-600 border-amber-200', dark: 'bg-amber-500/10 text-amber-400 border-amber-500/20', dot: 'bg-amber-500' },
  doc:     { light: 'bg-purple-50 text-purple-600 border-purple-200', dark: 'bg-purple-500/10 text-purple-400 border-purple-500/20', dot: 'bg-purple-500' },
};

const SCOPE_LEGEND_ITEMS: Array<{ scope: ScopeKind; label: string }> = [
  { scope: 'set', label: 'Whole Set' },
  { scope: 'between', label: 'Between Documents' },
  { scope: 'doc', label: 'This Document' },
];

function ScopeLegend({ darkMode }: { darkMode: boolean }) {
  return (
    <div className="flex flex-wrap gap-4">
      {SCOPE_LEGEND_ITEMS.map(({ scope, label }) => (
        <div key={scope} className="flex items-center gap-1.5">
          <div className={`w-2 h-2 rounded-sm ${SCOPE_STYLES[scope].dot}`} />
          <span className={`text-[9px] ${darkMode ? 'text-zinc-500' : 'text-zinc-400'}`}>{label}</span>
        </div>
      ))}
    </div>
  );
}

function ScopeStripe({ scope, label, note, darkMode }: { scope: ScopeKind; label: string; note: string; darkMode: boolean }) {
  const styles = SCOPE_STYLES[scope];
  return (
    <div className={`flex items-center gap-2.5 rounded-md border px-3 py-2 ${darkMode ? styles.dark : styles.light}`}>
      <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${styles.dot}`} />
      <span className="text-[10px] font-semibold uppercase tracking-wider">{label}</span>
      <span className={`text-[9px] ${darkMode ? 'text-zinc-500' : 'text-zinc-400'}`}>{note}</span>
    </div>
  );
}

function ScopeTag({ scope, label, darkMode }: { scope: ScopeKind; label?: string; darkMode: boolean }) {
  const styles = SCOPE_STYLES[scope];
  const defaultLabels: Record<ScopeKind, string> = { set: 'Whole Set', between: 'Between Documents', doc: 'This Document' };
  return (
    <span className={`inline-flex items-center gap-1.5 text-[8px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border ${darkMode ? styles.dark : styles.light}`}>
      <span className={`w-1 h-1 rounded-full ${styles.dot}`} />
      {label ?? defaultLabels[scope]}
    </span>
  );
}

function SeverityGroupHeader({ severity, darkMode }: { severity: string; darkMode: boolean }) {
  const colors: Record<string, string> = { critical: 'text-red-500', moderate: 'text-amber-500', minor: darkMode ? 'text-zinc-400' : 'text-zinc-500' };
  const dotColors: Record<string, string> = { critical: 'bg-red-500', moderate: 'bg-amber-500', minor: darkMode ? 'bg-zinc-500' : 'bg-zinc-400' };
  const sublabel = SEVERITY_SUBLABELS[severity] ?? '';
  return (
    <div className="flex items-center gap-2.5 mt-4 mb-2 first:mt-0">
      <div className={`w-2 h-2 rounded-full shrink-0 ${dotColors[severity] ?? 'bg-zinc-400'}`} />
      <span className={`text-[10px] font-semibold ${colors[severity] ?? 'text-zinc-400'}`}>
        {severity.charAt(0).toUpperCase() + severity.slice(1)}
      </span>
      {sublabel && <span className={`text-[9px] ${darkMode ? 'text-zinc-600' : 'text-zinc-400'}`}>— {sublabel}</span>}
      <div className={`flex-1 h-px ${darkMode ? 'bg-zinc-800' : 'bg-zinc-200'}`} />
    </div>
  );
}

function SeverityGroupedFindings({ findings, docLabels, darkMode }: { findings: DQAFCrossDocFinding[]; docLabels: Map<string, string>; darkMode: boolean }) {
  const groups = useMemo(() => {
    const result: { severity: string; items: DQAFCrossDocFinding[] }[] = [];
    for (const sev of ['critical', 'moderate', 'minor']) {
      const items = findings.filter(f => f.severity === sev);
      if (items.length > 0) result.push({ severity: sev, items });
    }
    return result;
  }, [findings]);
  return (
    <div>
      {groups.map(({ severity, items }) => (
        <div key={severity}>
          <SeverityGroupHeader severity={severity} darkMode={darkMode} />
          <div className="space-y-2">
            {items.map((finding, i) => <FindingCard key={i} finding={finding} docLabels={docLabels} darkMode={darkMode} />)}
          </div>
        </div>
      ))}
    </div>
  );
}

function SeverityGroupedPerDocFlags({ flags, docLabels, darkMode }: { flags: DQAFPerDocumentFlag[]; docLabels: Map<string, string>; darkMode: boolean }) {
  const groups = useMemo(() => {
    const result: { severity: string; items: DQAFPerDocumentFlag[] }[] = [];
    for (const sev of ['critical', 'moderate', 'minor']) {
      const items = flags.filter(f => f.severity === sev);
      if (items.length > 0) result.push({ severity: sev, items });
    }
    return result;
  }, [flags]);
  return (
    <div>
      {groups.map(({ severity, items }) => (
        <div key={severity}>
          <SeverityGroupHeader severity={severity} darkMode={darkMode} />
          <div className="space-y-2">
            {items.map((flag, i) => <PerDocFlagCard key={i} flag={flag} docLabels={docLabels} darkMode={darkMode} />)}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Document Register ──

function DocumentRegisterView({ report, darkMode }: { report: DQAFReport; darkMode: boolean }) {
  return (
    <div className="space-y-5">
      <SectionLabel darkMode={darkMode}>Document Register</SectionLabel>
      <div className={`rounded-lg overflow-hidden border ${darkMode ? 'border-zinc-800' : 'border-zinc-200'}`}>
        <table className="w-full text-[10px]">
          <thead className={darkMode ? 'bg-zinc-800/80' : 'bg-zinc-100'}>
            <tr>
              <th className="text-left py-2 px-3 font-medium">Document</th>
              <th className="text-left py-2 px-3 font-medium">Version & Date</th>
              <th className="text-center py-2 px-3 font-medium w-20">Relevance</th>
              <th className="text-center py-2 px-3 font-medium w-20">Readiness</th>
              <th className="text-left py-2 px-3 font-medium">Required Action</th>
            </tr>
          </thead>
          <tbody>
            {report.documentRegister.map((entry, i) => (
              <tr key={i} className={`border-t ${darkMode ? 'border-zinc-800' : 'border-zinc-100'}`}>
                <td className="py-2 px-3 font-medium">{entry.documentLabel}</td>
                <td className={`py-2 px-3 ${darkMode ? 'text-zinc-400' : 'text-zinc-500'}`}>{[entry.detectedVersion, entry.detectedDate].filter(Boolean).join(' · ') || '—'}</td>
                <td className="py-2 px-3 text-center">
                  <div className="flex flex-col items-center gap-0.5"><ScoreBadge score={entry.relevanceScoreA} size="xs" /><span className={`text-[8px] ${darkMode ? 'text-zinc-600' : 'text-zinc-400'}`}>{entry.relevanceInterpretation?.replace(/_/g, ' ')}</span></div>
                </td>
                <td className="py-2 px-3 text-center">
                  <div className="flex flex-col items-center gap-0.5"><ScoreBadge score={entry.documentReadinessScore} size="xs" /><VerdictBadge verdict={entry.documentVerdict} size="xs" /></div>
                </td>
                <td className={`py-2 px-3 ${darkMode ? 'text-zinc-300' : 'text-zinc-600'}`}>{entry.requiredAction || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {report.mandatoryProductionNotice && <ProductionNoticeBlock notice={report.mandatoryProductionNotice} darkMode={darkMode} />}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════
// Shared UI Atoms
// ═════════════════════════════════════════════════════════════════

function VerdictBadge({ verdict, size = 'sm' }: { verdict?: DQAFVerdict; size?: 'xs' | 'sm' }) {
  if (!verdict) return <span className={`inline-flex items-center rounded-full ${size === 'xs' ? 'px-1.5 py-0.5 text-[8px]' : 'px-2 py-0.5 text-[10px]'} font-medium bg-zinc-200 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400`}>No Assessment</span>;
  const styles: Record<DQAFVerdict, string> = { ready: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400', conditional: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400', not_ready: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400' };
  const labels: Record<DQAFVerdict, string> = { ready: 'Ready', conditional: 'Conditional', not_ready: 'Not Ready' };
  return <span className={`inline-flex items-center rounded-full font-medium ${size === 'xs' ? 'px-1.5 py-0.5 text-[8px]' : 'px-2 py-0.5 text-[10px]'} ${styles[verdict]}`}>{labels[verdict]}</span>;
}

function VerdictBanner({ verdict, rationale, flags, darkMode }: { verdict: DQAFVerdict; rationale: string; flags: DQAFReport['flagsSummary']; darkMode: boolean }) {
  const bg = verdict === 'ready' ? (darkMode ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-emerald-50 border-emerald-200') : verdict === 'conditional' ? (darkMode ? 'bg-amber-500/10 border-amber-500/20' : 'bg-amber-50 border-amber-200') : (darkMode ? 'bg-red-500/10 border-red-500/20' : 'bg-red-50 border-red-200');
  return (
    <div className={`rounded-lg border p-4 ${bg}`}>
      <div className="flex items-center gap-2 mb-2"><VerdictBadge verdict={verdict} size="sm" />{flags && <FlagChips flags={flags} darkMode={darkMode} />}</div>
      <p className={`text-[11px] leading-relaxed ${darkMode ? 'text-zinc-300' : 'text-zinc-600'}`}>{rationale}</p>
    </div>
  );
}

function FlagChips({ flags, darkMode }: { flags: DQAFReport['flagsSummary']; darkMode: boolean }) {
  if (!flags) return null;
  const items: Array<{ label: string; count: number; color: string }> = [];
  if (flags.critical > 0) items.push({ label: 'critical', count: flags.critical, color: 'text-red-500' });
  if (flags.moderate > 0) items.push({ label: 'moderate', count: flags.moderate, color: 'text-amber-500' });
  if (flags.minor > 0) items.push({ label: 'minor', count: flags.minor, color: darkMode ? 'text-zinc-400' : 'text-zinc-500' });
  if (items.length === 0) return null;
  return <span className="flex items-center gap-2 text-[9px]">{items.map((it) => <span key={it.label} className={`${it.color} font-medium`}>{it.count} {it.label}</span>)}</span>;
}

function ScoreBadge({ score, size = 'sm' }: { score: number; size?: 'xs' | 'sm' }) {
  const color = score >= 90 ? 'text-emerald-600 dark:text-emerald-400' : score >= 70 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400';
  return <span className={`font-semibold ${color} ${size === 'xs' ? 'text-[9px]' : 'text-[10px]'}`}>{score.toFixed(0)}%</span>;
}

function ScoreRing({ score, size = 48 }: { score: number; size?: number }) {
  const r = (size - 8) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  const color = score >= 90 ? 'stroke-emerald-500' : score >= 70 ? 'stroke-amber-500' : 'stroke-red-500';
  return (
    <svg width={size} height={size} className="shrink-0 -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" className="text-zinc-200 dark:text-zinc-700" strokeWidth={4} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" className={color} strokeWidth={4} strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round" />
      <text x={size / 2} y={size / 2} textAnchor="middle" dominantBaseline="central" className="fill-current text-[11px] font-semibold rotate-90" style={{ transformOrigin: 'center' }}>{score.toFixed(0)}</text>
    </svg>
  );
}

function ScorePill({ score, maxScore, label }: { score: number; maxScore: number; label: string }) {
  const color = score === maxScore ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400' : score === 0 ? 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400' : 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400';
  return <span className={`inline-flex px-1.5 py-0.5 rounded text-[8px] font-medium ${color}`}>{score}/{maxScore} {label}</span>;
}

function ProgressBar({ value, darkMode }: { value: number; darkMode: boolean }) {
  const color = value >= 90 ? 'bg-emerald-500' : value >= 70 ? 'bg-amber-500' : 'bg-red-500';
  return (<div className={`h-1.5 rounded-full ${darkMode ? 'bg-zinc-800' : 'bg-zinc-200'}`}><div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${Math.min(100, value)}%` }} /></div>);
}

function WeightedBar({ label, value, weight, darkMode }: { label: string; value: number; weight: string; darkMode: boolean }) {
  return (<div><div className="flex items-center justify-between mb-0.5"><span className={`text-[10px] ${darkMode ? 'text-zinc-400' : 'text-zinc-500'}`}>{label}</span><span className={`text-[9px] ${darkMode ? 'text-zinc-600' : 'text-zinc-400'}`}>{value.toFixed(0)}% · {weight}</span></div><ProgressBar value={value} darkMode={darkMode} /></div>);
}

function KpiTile({ label, value, description, darkMode }: { label: string; value: number; description: string; darkMode: boolean }) {
  const color = value >= 90 ? 'border-emerald-500/30' : value >= 70 ? 'border-amber-500/30' : 'border-red-500/30';
  return (
    <div className={`rounded-lg border p-3 ${color} ${darkMode ? 'bg-zinc-800/50' : 'bg-white'}`}>
      <div className="flex items-center justify-between mb-1"><span className={`text-[10px] font-medium ${darkMode ? 'text-zinc-300' : 'text-zinc-600'}`}>{label}</span><ScoreBadge score={value} size="sm" /></div>
      <ProgressBar value={value} darkMode={darkMode} />
      <p className={`text-[9px] mt-1.5 ${darkMode ? 'text-zinc-600' : 'text-zinc-400'}`}>{description}</p>
    </div>
  );
}

function MetadataChip({ label, darkMode }: { label: string; darkMode: boolean }) {
  return <span className={`text-[9px] px-2 py-0.5 rounded-full ${darkMode ? 'bg-zinc-800 text-zinc-400' : 'bg-zinc-100 text-zinc-500'}`}>{label}</span>;
}

function MetadataTag({ label, darkMode }: { label: string; darkMode: boolean }) {
  return <span className={`text-[9px] px-1.5 py-0.5 rounded ${darkMode ? 'bg-zinc-800 text-zinc-500' : 'bg-zinc-100 text-zinc-500'}`}>{label}</span>;
}

function RelevanceLabel({ interpretation }: { interpretation: string }) {
  const styles: Record<string, string> = { primary_source: 'text-emerald-600 dark:text-emerald-400', supporting_source: 'text-amber-600 dark:text-amber-400', orphan_review_required: 'text-red-600 dark:text-red-400' };
  const labels: Record<string, string> = { primary_source: 'Primary Source', supporting_source: 'Supporting Source', orphan_review_required: 'Orphan — Review Required' };
  return <span className={`text-[9px] font-medium ${styles[interpretation] ?? 'text-zinc-500'}`}>{labels[interpretation] ?? interpretation}</span>;
}

function SectionLabel({ darkMode, children }: { darkMode: boolean; children: React.ReactNode }) {
  return <p className={`text-[10px] font-semibold uppercase tracking-wider ${darkMode ? 'text-zinc-500' : 'text-zinc-400'}`}>{children}</p>;
}

function ProfileTable({ profile, darkMode }: { profile: { objective: string; audience: string; type: string; focus: string; tone: string }; darkMode: boolean }) {
  return (
    <div className={`mt-2 rounded-lg overflow-hidden border ${darkMode ? 'border-zinc-800' : 'border-zinc-200'}`}>
      {(['objective', 'audience', 'type', 'focus', 'tone'] as const).map((dim, i) => (
        <div key={dim} className={`flex text-[10px] ${i > 0 ? `border-t ${darkMode ? 'border-zinc-800' : 'border-zinc-100'}` : ''}`}>
          <div className={`w-20 shrink-0 px-3 py-1.5 font-medium ${darkMode ? 'bg-zinc-800/50 text-zinc-400' : 'bg-zinc-50 text-zinc-500'}`}>{DIMENSION_LABELS[dim]}</div>
          <div className={`flex-1 px-3 py-1.5 ${darkMode ? 'text-zinc-300' : 'text-zinc-600'}`}>{profile[dim]}</div>
        </div>
      ))}
    </div>
  );
}

function CheckCard({ checkId, label, result, darkMode }: { checkId: string; label: string; result?: DQAFCheckResult; darkMode: boolean }) {
  const score = result?.score ?? -1;
  const scoreLabel = score === 2 ? 'Pass' : score === 1 ? 'Caution' : score === 0 ? 'Fail' : '—';
  const scoreColor = score === 2 ? 'text-emerald-600 dark:text-emerald-400' : score === 1 ? 'text-amber-600 dark:text-amber-400' : score === 0 ? 'text-red-600 dark:text-red-400' : 'text-zinc-400';
  const borderColor = score === 2 ? 'border-emerald-500/20' : score === 1 ? 'border-amber-500/20' : score === 0 ? 'border-red-500/20' : 'border-zinc-200 dark:border-zinc-800';
  return (
    <div className={`rounded-lg border p-2.5 ${borderColor} ${darkMode ? 'bg-zinc-800/30' : 'bg-white'}`}>
      <div className="flex items-center justify-between"><span className={`text-[9px] font-medium ${darkMode ? 'text-zinc-500' : 'text-zinc-400'}`}>{checkId}</span><span className={`text-[9px] font-semibold ${scoreColor}`}>{scoreLabel}</span></div>
      <p className={`text-[10px] font-medium mt-0.5 ${darkMode ? 'text-zinc-300' : 'text-zinc-600'}`}>{label}</p>
      {result?.note && <p className={`text-[9px] mt-1 leading-relaxed ${darkMode ? 'text-zinc-500' : 'text-zinc-400'}`}>{result.note}</p>}
    </div>
  );
}

function CompatibilityCard({ record, docLabels, darkMode }: { record: DQAFCompatibilityRecord; docLabels: Map<string, string>; darkMode: boolean }) {
  const [docA, docB] = record.documentPair;
  return (
    <div className={`rounded-lg border p-3 ${darkMode ? 'border-zinc-800 bg-zinc-800/30' : 'border-zinc-200 bg-white'}`}>
      <div className="flex items-center justify-between mb-2">
        <span className={`text-[10px] font-medium ${darkMode ? 'text-zinc-300' : 'text-zinc-600'}`}>{docLabels.get(docA) ?? docA} ↔ {docLabels.get(docB) ?? docB}</span>
        <ScoreBadge score={record.compatibilityScoreB} size="xs" />
      </div>
      <div className="flex gap-1.5 flex-wrap">
        {(['objective', 'focus', 'audience', 'type', 'tone'] as const).map((dim) => {
          const ds = record.dimensionScores[dim];
          if (!ds) return null;
          const color = ds.score === 2 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400' : ds.score === 1 ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400' : 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400';
          return <span key={dim} className={`text-[8px] font-medium px-1.5 py-0.5 rounded ${color}`} title={ds.note ?? ''}>{DIMENSION_LABELS[dim]}: {ds.label}</span>;
        })}
      </div>
    </div>
  );
}

function FindingCard({ finding, docLabels, darkMode }: { finding: DQAFCrossDocFinding; docLabels: Map<string, string>; darkMode: boolean }) {
  const severityColor: Record<string, string> = { critical: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400', moderate: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400', minor: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-700/50 dark:text-zinc-400' };
  const leftBorder: Record<string, string> = { critical: 'border-l-red-500', moderate: 'border-l-amber-500', minor: darkMode ? 'border-l-zinc-500' : 'border-l-zinc-400' };
  const scope: ScopeKind = finding.scope === 'whole_set' ? 'set' : 'between';
  return (
    <div className={`rounded-lg border border-l-[3px] p-3 ${darkMode ? 'border-zinc-800 bg-zinc-900/50' : 'border-zinc-200 bg-white'} ${leftBorder[finding.severity]}`}>
      <div className={`flex items-center gap-2 mb-2 pb-2 border-b ${darkMode ? 'border-zinc-800' : 'border-zinc-100'}`}>
        <ScopeTag scope={scope} darkMode={darkMode} />
        <span className={`text-[8px] font-semibold uppercase px-1.5 py-0.5 rounded border ${severityColor[finding.severity]}`}>{finding.severity}</span>
        <span className={`text-[9px] ${darkMode ? 'text-zinc-600 bg-zinc-800 border-zinc-700' : 'text-zinc-400 bg-zinc-50 border-zinc-200'} px-1.5 py-0.5 rounded border`}>{finding.checkId} · {PASS2_LABELS[finding.checkId] ?? finding.checkId}</span>
      </div>
      <p className={`text-[11px] leading-relaxed ${darkMode ? 'text-zinc-400' : 'text-zinc-600'}`}>{finding.description}</p>
      {finding.documentsInvolved.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {finding.documentsInvolved.map((id) => <span key={id} className={`text-[8px] px-1.5 py-0.5 rounded border ${darkMode ? 'bg-blue-500/10 border-blue-500/20 text-blue-400' : 'bg-blue-50 border-blue-200 text-blue-600'}`}>{docLabels.get(id) ?? id}</span>)}
        </div>
      )}
      {finding.productionImpact && (
        <div className={`mt-2 rounded px-3 py-2 text-[10px] leading-relaxed ${darkMode ? 'bg-zinc-800/80 text-zinc-500' : 'bg-zinc-50 text-zinc-500'}`}>
          <span className={`font-medium ${darkMode ? 'text-zinc-300' : 'text-zinc-600'}`}>Production impact: </span>{finding.productionImpact}
        </div>
      )}
    </div>
  );
}

function PerDocFlagCard({ flag, docLabels, darkMode }: { flag: DQAFPerDocumentFlag; docLabels: Map<string, string>; darkMode: boolean }) {
  const severityColor: Record<string, string> = { critical: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400', moderate: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400', minor: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-700/50 dark:text-zinc-400' };
  const leftBorder: Record<string, string> = { critical: 'border-l-red-500', moderate: 'border-l-amber-500', minor: darkMode ? 'border-l-zinc-500' : 'border-l-zinc-400' };
  const docName = docLabels.get(flag.documentId) ?? flag.documentId;
  return (
    <div className={`rounded-lg border border-l-[3px] p-3 ${darkMode ? 'border-zinc-800 bg-zinc-900/50' : 'border-zinc-200 bg-white'} ${leftBorder[flag.severity]}`}>
      <div className={`flex items-center gap-2 mb-2 pb-2 border-b ${darkMode ? 'border-zinc-800' : 'border-zinc-100'}`}>
        <ScopeTag scope="doc" label={docName} darkMode={darkMode} />
        <span className={`text-[8px] font-semibold uppercase px-1.5 py-0.5 rounded border ${severityColor[flag.severity]}`}>{flag.severity}</span>
        <span className={`text-[9px] ${darkMode ? 'text-zinc-600 bg-zinc-800 border-zinc-700' : 'text-zinc-400 bg-zinc-50 border-zinc-200'} px-1.5 py-0.5 rounded border`}>{flag.checkId} · {PASS1_LABELS[flag.checkId] ?? flag.checkId}</span>
      </div>
      <p className={`text-[11px] leading-relaxed ${darkMode ? 'text-zinc-400' : 'text-zinc-600'}`}>{flag.description}</p>
      {flag.crossDocumentConsequence && (
        <div className={`mt-2 rounded px-3 py-2 text-[10px] leading-relaxed ${darkMode ? 'bg-zinc-800/80 text-zinc-500' : 'bg-zinc-50 text-zinc-500'}`}>
          <span className={`font-medium ${darkMode ? 'text-zinc-300' : 'text-zinc-600'}`}>Production impact: </span>{flag.crossDocumentConsequence}
        </div>
      )}
    </div>
  );
}

function ProductionNoticeBlock({ notice, darkMode }: { notice: DQAFProductionNotice; darkMode: boolean }) {
  return (
    <div className={`rounded-lg border-2 p-4 ${darkMode ? 'border-red-500/30 bg-red-500/5' : 'border-red-200 bg-red-50/50'}`}>
      <div className="flex items-center gap-2 mb-2">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-500 shrink-0">
          <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        <span className={`text-[11px] font-semibold ${darkMode ? 'text-red-400' : 'text-red-700'}`}>Mandatory Production Notice</span>
      </div>
      <p className={`text-[11px] leading-relaxed mb-2 ${darkMode ? 'text-zinc-300' : 'text-zinc-600'}`}>{notice.summary}</p>
      {notice.conflictsDescribed && <p className={`text-[10px] leading-relaxed mb-2 ${darkMode ? 'text-zinc-400' : 'text-zinc-500'}`}>{notice.conflictsDescribed}</p>}
      {notice.productionConsequence && <p className={`text-[10px] leading-relaxed mb-2 ${darkMode ? 'text-zinc-400' : 'text-zinc-500'}`}><span className="font-medium">Consequence:</span> {notice.productionConsequence}</p>}
      {notice.suggestedDisclosure && (
        <div className={`mt-3 rounded p-3 text-[10px] leading-relaxed font-mono ${darkMode ? 'bg-zinc-800 text-zinc-300 border border-zinc-700' : 'bg-white text-zinc-700 border border-zinc-200'}`}>
          <p className={`text-[9px] font-semibold uppercase tracking-wider mb-1 font-sans ${darkMode ? 'text-zinc-500' : 'text-zinc-400'}`}>Suggested Disclosure</p>
          {notice.suggestedDisclosure}
        </div>
      )}
    </div>
  );
}

export default React.memo(SubjectQualityPanel);
