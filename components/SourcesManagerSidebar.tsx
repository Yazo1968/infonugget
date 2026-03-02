import React, { useState, useRef, useCallback } from 'react';
import { UploadedFile } from '../types';

interface SourcesManagerSidebarProps {
  documents: UploadedFile[];
  activeDocId: string | null;
  onSelectDocument: (docId: string) => void;
  onRename: (docId: string, newName: string) => void;
  onDelete: (docId: string) => void;
  onToggleEnabled: (docId: string) => void;
  onUpload: (files: FileList) => void;
  darkMode: boolean;
}

const SourcesManagerSidebar: React.FC<SourcesManagerSidebarProps> = ({
  documents,
  activeDocId,
  onSelectDocument,
  onRename,
  onDelete,
  onToggleEnabled,
  onUpload,
  darkMode,
}) => {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      if (e.dataTransfer.files.length > 0) {
        onUpload(e.dataTransfer.files);
      }
    },
    [onUpload],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
  }, []);

  const startRename = useCallback((doc: UploadedFile) => {
    setRenameValue(doc.name);
    setRenamingId(doc.id);
    setTimeout(() => renameInputRef.current?.focus(), 30);
  }, []);

  const submitRename = useCallback(
    (docId: string, originalName: string) => {
      const trimmed = renameValue.trim();
      if (trimmed && trimmed !== originalName) {
        onRename(docId, trimmed);
      }
      setRenamingId(null);
    },
    [renameValue, onRename],
  );

  const enabledCount = documents.filter((d) => d.enabled !== false).length;

  const textPrimary = darkMode ? 'text-zinc-100' : 'text-zinc-900';
  const textDim = darkMode ? 'text-zinc-500' : 'text-zinc-400';
  const hoverBg = darkMode ? 'hover:bg-zinc-800' : 'hover:bg-zinc-50';

  return (
    <div
      className={`flex flex-col h-full overflow-hidden transition-colors ${
        dragging
          ? darkMode ? 'ring-2 ring-inset ring-[var(--accent-blue,#2a9fd4)]' : 'ring-2 ring-inset ring-[var(--accent-blue,#2a9fd4)]'
          : ''
      }`}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      {/* Document list */}
      <div className="flex-1 overflow-y-auto px-1 py-1">
        {documents.length === 0 ? (
          <div className={`flex flex-col items-center justify-center py-10 ${textDim}`}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mb-2 opacity-40">
              <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" />
            </svg>
            <span className="text-[11px]">No documents</span>
          </div>
        ) : (
          <div className="space-y-0.5">
            {documents.map((doc) => {
              const isEnabled = doc.enabled !== false;
              const isPdf = doc.sourceType === 'native-pdf';
              const isRenaming = renamingId === doc.id;
              const isDeleting = confirmDeleteId === doc.id;
              const isActive = doc.id === activeDocId;

              return (
                <div
                  key={doc.id}
                  onClick={() => !isRenaming && !isDeleting && onSelectDocument(doc.id)}
                  className={`group flex items-center gap-1.5 px-2 py-1.5 rounded-md transition-colors cursor-pointer ${
                    isActive
                      ? darkMode ? 'bg-zinc-700/60' : 'bg-blue-50 border border-blue-200'
                      : `border border-transparent ${hoverBg}`
                  }`}
                >
                  {/* Enable/disable toggle */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!(isEnabled && enabledCount <= 1)) onToggleEnabled(doc.id);
                    }}
                    className={`shrink-0 w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors ${
                      isEnabled && enabledCount <= 1
                        ? 'bg-[var(--accent-blue,#2a9fd4)] border-[var(--accent-blue,#2a9fd4)] opacity-50 cursor-not-allowed'
                        : isEnabled
                          ? 'bg-[var(--accent-blue,#2a9fd4)] border-[var(--accent-blue,#2a9fd4)]'
                          : darkMode
                            ? 'border-zinc-600 hover:border-zinc-500'
                            : 'border-zinc-300 hover:border-zinc-400'
                    }`}
                    title={isEnabled && enabledCount <= 1 ? 'At least one document must be active' : isEnabled ? 'Disable' : 'Enable'}
                  >
                    {isEnabled && (
                      <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </button>

                  {/* Type badge */}
                  <span className={`shrink-0 text-[8px] font-bold uppercase tracking-wider px-1 py-0.5 rounded ${
                    isPdf
                      ? darkMode ? 'bg-red-900/40 text-red-400' : 'bg-red-100 text-red-600'
                      : darkMode ? 'bg-blue-900/40 text-blue-400' : 'bg-blue-100 text-blue-600'
                  }`}>
                    {isPdf ? 'PDF' : 'MD'}
                  </span>

                  {/* Name or rename input */}
                  {isRenaming ? (
                    <input
                      ref={renameInputRef}
                      type="text"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') submitRename(doc.id, doc.name);
                        if (e.key === 'Escape') setRenamingId(null);
                      }}
                      onBlur={() => submitRename(doc.id, doc.name)}
                      className={`flex-1 min-w-0 bg-transparent outline-none border-b text-[11px] ${
                        darkMode ? 'text-zinc-100 border-zinc-600' : 'text-zinc-900 border-zinc-300'
                      }`}
                    />
                  ) : (
                    <span
                      className={`flex-1 min-w-0 truncate text-[11px] ${
                        isEnabled ? textPrimary : textDim
                      } ${!isEnabled ? 'line-through opacity-60' : ''}`}
                      title={doc.name}
                    >
                      {doc.name}
                    </span>
                  )}

                  {/* Status badge for non-ready docs */}
                  {doc.status !== 'ready' && (
                    <span className={`shrink-0 text-[8px] px-1 py-0.5 rounded ${
                      doc.status === 'error'
                        ? darkMode ? 'bg-red-900/40 text-red-400' : 'bg-red-100 text-red-500'
                        : darkMode ? 'bg-zinc-800 text-zinc-500' : 'bg-zinc-100 text-zinc-400'
                    }`}>
                      {doc.status === 'uploading' ? '...' : doc.status === 'processing' ? '...' : '!'}
                    </span>
                  )}

                  {/* Action buttons — visible on hover */}
                  {!isRenaming && !isDeleting && (
                    <div className="shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => { e.stopPropagation(); startRename(doc); }}
                        className={`p-0.5 rounded transition-colors ${textDim} ${hoverBg}`}
                        title="Rename"
                      >
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                        </svg>
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(doc.id); }}
                        className={`p-0.5 rounded transition-colors ${darkMode ? 'text-zinc-500 hover:text-red-400' : 'text-zinc-400 hover:text-red-500'} ${hoverBg}`}
                        title="Delete"
                      >
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                      </button>
                    </div>
                  )}

                  {/* Inline delete confirmation */}
                  {isDeleting && (
                    <div className="shrink-0 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      <span className={`text-[9px] ${darkMode ? 'text-red-400' : 'text-red-500'}`}>Delete?</span>
                      <button
                        onClick={() => { onDelete(doc.id); setConfirmDeleteId(null); }}
                        className="px-1 py-0.5 rounded text-[9px] font-semibold bg-red-500 text-white hover:bg-red-600 transition-colors"
                      >
                        Yes
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(null)}
                        className={`px-1 py-0.5 rounded text-[9px] transition-colors ${darkMode ? 'text-zinc-400 hover:bg-zinc-800' : 'text-zinc-500 hover:bg-zinc-100'}`}
                      >
                        No
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Upload zone — flows directly under documents */}
        <div className="px-1 pt-2 pb-1">
          <div
            onClick={() => fileInputRef.current?.click()}
            className={`flex flex-col items-center justify-center gap-1 py-[40px] rounded-lg border-2 border-dashed cursor-pointer transition-colors ${
              dragging
                ? darkMode
                  ? 'border-[var(--accent-blue,#2a9fd4)] bg-[var(--accent-blue,#2a9fd4)]/10'
                  : 'border-[var(--accent-blue,#2a9fd4)] bg-blue-50'
                : darkMode
                  ? 'border-zinc-700 hover:border-zinc-500'
                  : 'border-zinc-300 hover:border-zinc-400'
            }`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={dragging ? 'text-[var(--accent-blue,#2a9fd4)]' : textDim}>
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <span className={`text-[10px] ${dragging ? 'text-[var(--accent-blue,#2a9fd4)]' : textDim}`}>
              {dragging ? 'Drop files here' : 'Drop or click to upload'}
            </span>
            <span className={`text-[9px] ${textDim} opacity-60`}>.md, .txt, .pdf</span>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".md,.txt,.pdf"
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                onUpload(e.target.files);
                e.target.value = '';
              }
            }}
          />
          {documents.length > 0 && (
            <div className="text-center mt-1.5">
              <span className={`text-[10px] ${textDim}`}>
                {documents.length} source{documents.length !== 1 ? 's' : ''}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default React.memo(SourcesManagerSidebar);
