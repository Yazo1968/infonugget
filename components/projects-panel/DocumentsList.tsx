import React, { useRef, useEffect, useState, useMemo } from 'react';
import { UploadedFile, QualityReport } from '../../types';

interface DocumentsListProps {
  documents: UploadedFile[];
  selectedDocumentId: string | null;
  renamingId: string | null;
  renameValue: string;
  renameError: string;
  onSelect: (docId: string) => void;
  onDoubleClick: (docId: string) => void;
  onContextMenu: (docId: string, pos: { x: number; y: number }) => void;
  onRenameChange: (value: string) => void;
  onRenameCommit: () => void;
  onRenameCancel: () => void;
  onUpload: () => void;
  onDropFiles?: (files: FileList) => void;
  qualityReport?: QualityReport;
}

const DocumentsList: React.FC<DocumentsListProps> = ({
  documents,
  selectedDocumentId,
  renamingId,
  renameValue,
  renameError,
  onSelect,
  onDoubleClick,
  onContextMenu,
  onRenameChange,
  onRenameCommit,
  onRenameCancel,
  onUpload,
  onDropFiles,
  qualityReport,
}) => {
  const renameInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);

  useEffect(() => {
    if (renamingId) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [renamingId]);

  // Build quality issue lookup: docId → { isolated, conflict }
  const qualityIssues = useMemo(() => {
    const issues = new Map<string, { isolated: boolean; conflict: boolean }>();
    if (!qualityReport || qualityReport.status !== 'red') return issues;

    // Check isolated clusters
    for (const cluster of qualityReport.clusters) {
      if (cluster.isolated) {
        for (const docId of cluster.documentIds) {
          const existing = issues.get(docId) || { isolated: false, conflict: false };
          existing.isolated = true;
          issues.set(docId, existing);
        }
      }
    }

    // Check conflicts
    for (const conflict of qualityReport.conflicts) {
      for (const entry of conflict.entries) {
        const existing = issues.get(entry.documentId) || { isolated: false, conflict: false };
        existing.conflict = true;
        issues.set(entry.documentId, existing);
      }
    }

    return issues;
  }, [qualityReport]);

  const getSourceBadge = (doc: UploadedFile) => {
    if (doc.sourceType === 'native-pdf') return 'PDF';
    if (doc.originalFormat === 'pdf') return 'PDF';
    return 'MD';
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setIsDragging(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setIsDragging(false);
    if (e.dataTransfer.files?.length && onDropFiles) {
      onDropFiles(e.dataTransfer.files);
    }
  };

  return (
    <div
      className="flex-1 overflow-y-auto px-2 py-1 relative"
      style={{ scrollbarWidth: 'thin' }}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {documents.map((doc) => {
        const isSelected = selectedDocumentId === doc.id;
        const isRenaming = renamingId === doc.id;
        const isProcessing = doc.status === 'processing' || doc.status === 'uploading';

        return (
          <div
            key={doc.id}
            role="button"
            tabIndex={0}
            onClick={() => {
              if (isRenaming) return;
              onSelect(doc.id);
            }}
            onDoubleClick={() => {
              if (isRenaming) return;
              onDoubleClick(doc.id);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              onSelect(doc.id);
              onContextMenu(doc.id, { x: e.clientX, y: e.clientY });
            }}
            onKeyDown={(e) => {
              if (isRenaming) return;
              if (e.key === 'Enter') {
                e.preventDefault();
                onDoubleClick(doc.id);
              }
            }}
            className={`group relative flex items-center gap-2 px-2.5 py-1.5 cursor-pointer select-none transition-all duration-150 rounded ${
              isSelected ? 'sidebar-node-active' : 'border border-transparent hover:border-blue-300'
            }`}
          >
            {/* File icon or spinner */}
            {isProcessing ? (
              <div className="w-3.5 h-3.5 border-2 border-zinc-300 border-t-transparent rounded-full animate-spin shrink-0" />
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
                className="shrink-0"
                style={{ color: isSelected ? 'var(--tree-icon)' : 'var(--tree-icon-dim)' }}
              >
                <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
                <path d="M14 2v4a2 2 0 0 0 2 2h4" />
              </svg>
            )}

            {/* Quality issue dot */}
            {(() => {
              const issue = qualityIssues.get(doc.id);
              if (!issue) return null;
              const dotColor = issue.conflict ? 'rgb(200,50,50)' : 'rgb(210,160,30)';
              const tooltip = issue.conflict
                ? 'Conflicting data detected'
                : 'Unrelated to other documents';
              return (
                <span
                  className="shrink-0 w-2 h-2 rounded-full -ml-1"
                  style={{ backgroundColor: dotColor }}
                  title={tooltip}
                />
              );
            })()}

            {/* Name */}
            <div className="flex-1 min-w-0">
              {isRenaming ? (
                <div>
                  <input
                    ref={renameInputRef}
                    value={renameValue}
                    onChange={(e) => onRenameChange(e.target.value)}
                    onBlur={onRenameCommit}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') onRenameCommit();
                      if (e.key === 'Escape') onRenameCancel();
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className={`w-full text-[11px] font-normal text-zinc-800 dark:text-zinc-200 bg-white dark:bg-zinc-900 border rounded px-1.5 py-0.5 outline-none ${
                      renameError ? 'border-red-400 focus:border-red-400' : 'border-zinc-300 dark:border-zinc-600 focus:border-zinc-400'
                    }`}
                  />
                  {renameError && <p className="text-[9px] text-red-500 mt-0.5">{renameError}</p>}
                </div>
              ) : (
                <p
                  className="text-[11px] truncate font-normal"
                  style={{ color: isSelected ? 'var(--tree-active)' : 'var(--tree-text-dim)' }}
                  title={doc.name}
                >
                  {doc.name}
                </p>
              )}
            </div>

            {/* Source type badge */}
            {!isRenaming && (
              <span
                className="shrink-0 text-[9px] font-medium uppercase tracking-wider px-1 py-0.5 rounded"
                style={{
                  color: isSelected ? 'var(--tree-icon)' : 'var(--tree-icon-dim)',
                  backgroundColor: isSelected ? 'rgba(140,180,205,0.15)' : 'rgba(140,180,205,0.08)',
                }}
              >
                {getSourceBadge(doc)}
              </span>
            )}

            {/* Kebab button */}
            {!isRenaming && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onContextMenu(doc.id, { x: e.clientX, y: e.clientY });
                }}
                className="shrink-0 w-5 h-5 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ color: isSelected ? 'var(--tree-icon)' : 'rgba(100,116,139,0.5)' }}
                aria-label="Document menu"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="5" r="1" />
                  <circle cx="12" cy="12" r="1" />
                  <circle cx="12" cy="19" r="1" />
                </svg>
              </button>
            )}
          </div>
        );
      })}

      {/* Upload area: click to browse + drag-and-drop */}
      <button
        onClick={onUpload}
        className={`w-full flex flex-col items-center gap-1.5 px-2.5 py-4 mt-1 rounded border-2 border-dashed transition-colors cursor-pointer ${
          isDragging
            ? 'border-[var(--accent-blue)] bg-[rgba(42,159,212,0.06)]'
            : 'border-zinc-200 dark:border-zinc-700 hover:border-zinc-400 dark:hover:border-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
        }`}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={isDragging ? 'text-[var(--accent-blue)]' : 'text-zinc-400 dark:text-zinc-500'}
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
        <span className={`text-[11px] font-medium ${isDragging ? 'text-[var(--accent-blue)]' : 'text-zinc-500 dark:text-zinc-400'}`}>
          {isDragging ? 'Drop files here' : 'Click to browse or drag files here'}
        </span>
        <span className="text-[9px] text-zinc-400 dark:text-zinc-500">.md, .pdf</span>
      </button>

      {/* Drag overlay for entire list area */}
      {isDragging && (
        <div className="absolute inset-0 rounded pointer-events-none border-2 border-[var(--accent-blue)] bg-[rgba(42,159,212,0.04)]" />
      )}
    </div>
  );
};

export default DocumentsList;
