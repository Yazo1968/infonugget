import React from 'react';
import { createPortal } from 'react-dom';
import { QualityReport, TopicCluster, QualityConflict, UploadedFile } from '../types';
import { useThemeContext } from '../context/ThemeContext';
import { usePanelOverlay } from '../hooks/usePanelOverlay';
import { QualityStatus } from '../hooks/useDocumentQualityCheck';

interface QualityPanelProps {
  isOpen: boolean;
  tabBarRef?: React.RefObject<HTMLElement | null>;
  onToggle: () => void;
  qualityReport: QualityReport | undefined;
  effectiveStatus: QualityStatus;
  isChecking: boolean;
  checkError: string | null;
  onRunCheck: () => void;
  onDismiss: () => void;
  onFixDocuments: () => void;
  documents: UploadedFile[];
}

const QualityPanel: React.FC<QualityPanelProps> = ({
  isOpen,
  tabBarRef,
  qualityReport,
  effectiveStatus,
  isChecking,
  checkError,
  onRunCheck,
  onDismiss,
  onFixDocuments,
  documents,
}) => {
  const { darkMode } = useThemeContext();
  const { shouldRender, overlayStyle } = usePanelOverlay({
    isOpen,
    defaultWidth: Math.min(window.innerWidth * 0.4, 600),
    minWidth: 300,
    anchorRef: tabBarRef,
  });

  // Build document name lookup
  const docNameById = new Map<string, string>();
  for (const d of documents) docNameById.set(d.id, d.name);

  const borderColor =
    effectiveStatus === 'green'
      ? 'rgb(34, 160, 90)'
      : effectiveStatus === 'amber'
        ? 'rgb(210, 160, 30)'
        : effectiveStatus === 'red'
          ? 'rgb(200, 50, 50)'
          : 'rgb(120, 120, 120)';

  if (!shouldRender) return null;

  return createPortal(
    <div
      data-panel-overlay
      className={`fixed z-[106] flex flex-col ${darkMode ? 'bg-zinc-900 text-zinc-200' : 'bg-white text-zinc-800'} border-4 shadow-[5px_0_6px_rgba(0,0,0,0.35)] overflow-hidden`}
      style={{ borderColor, ...overlayStyle }}
    >
      {/* Header */}
      <div className={`shrink-0 px-5 py-3 border-b ${darkMode ? 'border-zinc-800' : 'border-zinc-200'}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <StatusDot status={effectiveStatus} />
            <h2 className="text-sm font-semibold">Document Quality Check</h2>
          </div>
          {effectiveStatus === 'amber' || effectiveStatus === 'red' ? (
            <button
              onClick={onRunCheck}
              disabled={isChecking}
              className={`text-[11px] font-medium px-3 py-1.5 rounded-lg transition-colors ${
                isChecking
                  ? 'opacity-50 cursor-not-allowed'
                  : darkMode
                    ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
                    : 'bg-zinc-100 hover:bg-zinc-200 text-zinc-700'
              }`}
            >
              {isChecking ? 'Checking...' : 'Run Check'}
            </button>
          ) : null}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {isChecking ? (
          <CheckingState darkMode={darkMode} />
        ) : checkError ? (
          <ErrorState darkMode={darkMode} error={checkError} onRetry={onRunCheck} />
        ) : effectiveStatus === null ? (
          <EmptyState darkMode={darkMode} />
        ) : effectiveStatus === 'amber' && !qualityReport ? (
          <AmberFirstState darkMode={darkMode} />
        ) : effectiveStatus === 'amber' && qualityReport ? (
          <AmberChangedState darkMode={darkMode} report={qualityReport} docNameById={docNameById} />
        ) : effectiveStatus === 'green' ? (
          <GreenState darkMode={darkMode} report={qualityReport} docNameById={docNameById} />
        ) : effectiveStatus === 'red' ? (
          <RedState
            darkMode={darkMode}
            report={qualityReport!}
            docNameById={docNameById}
            onFixDocuments={onFixDocuments}
            onDismiss={onDismiss}
          />
        ) : null}
      </div>
    </div>,
    document.body,
  );
};

// ── Sub-components ──

function StatusDot({ status }: { status: QualityStatus }) {
  const color =
    status === 'green' ? 'bg-emerald-500'
    : status === 'amber' ? 'bg-amber-500'
    : status === 'red' ? 'bg-red-500'
    : 'bg-zinc-400';
  return <span className={`w-2.5 h-2.5 rounded-full ${color} shrink-0`} />;
}

function CheckingState({ darkMode }: { darkMode: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center gap-3">
      <div className="w-8 h-8 border-2 border-zinc-300 dark:border-zinc-600 border-t-blue-500 rounded-full animate-spin" />
      <p className={`text-xs ${darkMode ? 'text-zinc-400' : 'text-zinc-500'}`}>
        Analyzing documents for topic coherence and conflicts...
      </p>
    </div>
  );
}

function ErrorState({ darkMode, error, onRetry }: { darkMode: boolean; error: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center gap-3">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-red-500">
        <circle cx="12" cy="12" r="10" />
        <line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
      </svg>
      <p className={`text-xs font-medium ${darkMode ? 'text-red-400' : 'text-red-600'}`}>
        Quality check failed
      </p>
      <p className={`text-[10px] max-w-[300px] break-words ${darkMode ? 'text-zinc-500' : 'text-zinc-400'}`}>
        {error}
      </p>
      <button
        onClick={onRetry}
        className={`text-[11px] font-medium px-3 py-1.5 rounded-lg transition-colors mt-1 ${
          darkMode
            ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
            : 'bg-zinc-100 hover:bg-zinc-200 text-zinc-700'
        }`}
      >
        Retry
      </button>
    </div>
  );
}

function EmptyState({ darkMode }: { darkMode: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center">
      <p className={`text-xs ${darkMode ? 'text-zinc-500' : 'text-zinc-400'}`}>
        No active documents to analyze.
      </p>
    </div>
  );
}

function AmberFirstState({ darkMode }: { darkMode: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center gap-3">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-amber-500">
        <path d="M12 9v4M12 17h.01" />
        <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      </svg>
      <p className={`text-xs ${darkMode ? 'text-zinc-400' : 'text-zinc-500'}`}>
        Documents have not been checked yet.
      </p>
      <p className={`text-[10px] ${darkMode ? 'text-zinc-600' : 'text-zinc-400'}`}>
        Click <strong>Run Check</strong> to analyze document coherence and detect conflicts.
      </p>
    </div>
  );
}

function AmberChangedState({
  darkMode,
  report,
  docNameById,
}: {
  darkMode: boolean;
  report: QualityReport;
  docNameById: Map<string, string>;
}) {
  return (
    <div className="space-y-4">
      <div className={`rounded-lg px-4 py-3 text-[11px] ${darkMode ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'bg-amber-50 text-amber-700 border border-amber-200'}`}>
        Documents have changed since the last check. Run a new check to update the report.
      </div>
      <p className={`text-[10px] font-medium uppercase tracking-wider ${darkMode ? 'text-zinc-600' : 'text-zinc-400'}`}>
        Previous report
      </p>
      <ClusterList clusters={report.clusters} docNameById={docNameById} darkMode={darkMode} />
      {report.conflicts.length > 0 && (
        <ConflictList conflicts={report.conflicts} darkMode={darkMode} />
      )}
    </div>
  );
}

function GreenState({
  darkMode,
  report,
  docNameById,
}: {
  darkMode: boolean;
  report: QualityReport | undefined;
  docNameById: Map<string, string>;
}) {
  return (
    <div className="space-y-4">
      <div className={`rounded-lg px-4 py-3 text-[11px] flex items-center gap-2 ${darkMode ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}`}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
        All documents are related. No conflicts detected.
      </div>
      {report && report.clusters.length > 0 && (
        <ClusterList clusters={report.clusters} docNameById={docNameById} darkMode={darkMode} />
      )}
      {report && (
        <p className={`text-[10px] ${darkMode ? 'text-zinc-600' : 'text-zinc-400'}`}>
          Last checked: {formatTimestamp(report.lastCheckTimestamp)}
        </p>
      )}
    </div>
  );
}

function RedState({
  darkMode,
  report,
  docNameById,
  onFixDocuments,
  onDismiss,
}: {
  darkMode: boolean;
  report: QualityReport;
  docNameById: Map<string, string>;
  onFixDocuments: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="space-y-4">
      {report.dismissed && (
        <div className={`rounded-lg px-4 py-3 text-[11px] ${darkMode ? 'bg-zinc-800 text-zinc-400 border border-zinc-700' : 'bg-zinc-100 text-zinc-500 border border-zinc-200'}`}>
          Warnings dismissed — footnotes will be added to all AI responses.
        </div>
      )}

      <ClusterList clusters={report.clusters} docNameById={docNameById} darkMode={darkMode} />

      {report.conflicts.length > 0 && (
        <ConflictList conflicts={report.conflicts} darkMode={darkMode} />
      )}

      {!report.dismissed && (
        <div className="flex items-center gap-2 pt-2">
          <button
            onClick={onFixDocuments}
            className={`text-[11px] font-medium px-4 py-2 rounded-lg transition-colors ${
              darkMode
                ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
                : 'bg-zinc-100 hover:bg-zinc-200 text-zinc-700'
            }`}
          >
            Fix Documents
          </button>
          <button
            onClick={onDismiss}
            className={`text-[11px] font-medium px-4 py-2 rounded-lg transition-colors ${
              darkMode
                ? 'bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20'
                : 'bg-red-50 hover:bg-red-100 text-red-600 border border-red-200'
            }`}
          >
            Dismiss &amp; Proceed
          </button>
        </div>
      )}

      <p className={`text-[10px] ${darkMode ? 'text-zinc-600' : 'text-zinc-400'}`}>
        Last checked: {formatTimestamp(report.lastCheckTimestamp)}
      </p>
    </div>
  );
}

// ── Shared display components ──

function ClusterList({
  clusters,
  docNameById,
  darkMode,
}: {
  clusters: TopicCluster[];
  docNameById: Map<string, string>;
  darkMode: boolean;
}) {
  if (clusters.length === 0) return null;

  return (
    <div className="space-y-3">
      <p className={`text-[10px] font-semibold uppercase tracking-wider ${darkMode ? 'text-zinc-500' : 'text-zinc-400'}`}>
        Topic Clusters
      </p>
      {clusters.map((cluster, i) => (
        <div key={i} className={`rounded-lg px-4 py-3 ${darkMode ? 'bg-zinc-800/50' : 'bg-zinc-50'}`}>
          <div className="flex items-start gap-2">
            <span className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${cluster.isolated ? 'bg-amber-500' : 'bg-emerald-500'}`} />
            <div className="min-w-0">
              <p className="text-[12px] font-medium">
                {cluster.subject}
                <span className={`ml-1.5 text-[10px] font-normal ${darkMode ? 'text-zinc-500' : 'text-zinc-400'}`}>
                  ({cluster.documentIds.length} {cluster.documentIds.length === 1 ? 'doc' : 'docs'})
                </span>
              </p>
              <p className={`text-[11px] mt-0.5 ${darkMode ? 'text-zinc-400' : 'text-zinc-500'}`}>
                {cluster.description}
              </p>
              <div className={`mt-2 space-y-0.5 text-[10px] ${darkMode ? 'text-zinc-500' : 'text-zinc-400'}`}>
                {cluster.documentIds.map((id, j) => (
                  <div key={j} className="flex items-center gap-1.5">
                    <span className="opacity-40">{j < cluster.documentIds.length - 1 ? '├' : '└'}</span>
                    <span>{docNameById.get(id) || id}</span>
                  </div>
                ))}
              </div>
              {cluster.isolated && (
                <p className="text-[10px] text-amber-500 mt-1.5 flex items-center gap-1">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                  No relationship to other clusters
                </p>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ConflictList({
  conflicts,
  darkMode,
}: {
  conflicts: QualityConflict[];
  darkMode: boolean;
}) {
  return (
    <div className="space-y-3">
      <p className={`text-[10px] font-semibold uppercase tracking-wider ${darkMode ? 'text-zinc-500' : 'text-zinc-400'}`}>
        Conflicts
      </p>
      {conflicts.map((conflict, i) => (
        <div
          key={i}
          className={`rounded-lg px-4 py-3 border ${
            darkMode
              ? 'bg-red-500/5 border-red-500/20'
              : 'bg-red-50/50 border-red-200'
          }`}
        >
          <div className="flex items-start gap-2">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-500 mt-0.5 shrink-0">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
            <div className="min-w-0">
              <p className={`text-[12px] font-medium ${darkMode ? 'text-red-400' : 'text-red-700'}`}>
                {conflict.description}
              </p>
              <div className="mt-2 space-y-1.5">
                {conflict.entries.map((entry, j) => (
                  <div key={j} className={`text-[11px] ${darkMode ? 'text-zinc-400' : 'text-zinc-600'}`}>
                    <span className="font-medium">&ldquo;{entry.documentName}&rdquo;</span>
                    {' '}states: &ldquo;{entry.claim}&rdquo;
                    <span className={`ml-1 text-[10px] ${darkMode ? 'text-zinc-600' : 'text-zinc-400'}`}>
                      ({entry.location})
                    </span>
                  </div>
                ))}
              </div>
              <p className={`text-[10px] mt-2 ${darkMode ? 'text-zinc-500' : 'text-zinc-400'}`}>
                → {conflict.recommendation}
              </p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function formatTimestamp(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} minutes ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} hours ago`;
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default React.memo(QualityPanel);
