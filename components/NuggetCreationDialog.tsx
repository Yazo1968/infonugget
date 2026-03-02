import React, { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';

interface NuggetCreationDialogProps {
  onSave: (name: string, files: File[]) => void;
  onCancel: () => void;
  darkMode: boolean;
}

export default function NuggetCreationDialog({
  onSave,
  onCancel,
  darkMode,
}: NuggetCreationDialogProps) {
  const [name, setName] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => nameInputRef.current?.focus(), 50);
  }, []);

  const addFiles = useCallback((newFiles: FileList | File[]) => {
    const arr = Array.from(newFiles);
    setFiles((prev) => [...prev, ...arr]);
  }, []);

  const removeFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
    },
    [addFiles],
  );

  const handleSave = useCallback(() => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSave(trimmed, files);
  }, [name, files, onSave]);

  const bg = darkMode ? 'bg-zinc-900' : 'bg-white';
  const border = darkMode ? 'border-zinc-700' : 'border-zinc-200';
  const textPrimary = darkMode ? 'text-zinc-100' : 'text-zinc-900';
  const textDim = darkMode ? 'text-zinc-500' : 'text-zinc-400';
  const hoverBg = darkMode ? 'hover:bg-zinc-800' : 'hover:bg-zinc-50';

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50"
      onClick={onCancel}
      onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}
    >
      <div
        className={`w-full max-w-md ${bg} rounded-xl shadow-2xl border ${border} flex flex-col`}
        style={{ maxHeight: 'min(520px, 80vh)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`px-5 py-3.5 border-b ${border}`}>
          <h2 className={`text-[13px] font-semibold ${textPrimary}`}>Create New Nugget</h2>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Name field */}
          <div>
            <label className={`block text-[11px] font-medium mb-1.5 ${textDim}`}>Nugget Name</label>
            <input
              ref={nameInputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) handleSave(); }}
              placeholder="Enter nugget name…"
              className={`w-full h-[34px] px-3 rounded-lg text-[12px] bg-transparent outline-none border transition-colors ${
                darkMode
                  ? 'text-zinc-100 placeholder-zinc-600 border-zinc-600 focus:border-zinc-400'
                  : 'text-zinc-900 placeholder-zinc-400 border-zinc-300 focus:border-zinc-500'
              }`}
            />
          </div>

          {/* Drop zone */}
          <div>
            <label className={`block text-[11px] font-medium mb-1.5 ${textDim}`}>Documents (optional)</label>
            <div
              onClick={() => fileInputRef.current?.click()}
              onDrop={handleDrop}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={(e) => { e.preventDefault(); setDragging(false); }}
              className={`flex flex-col items-center justify-center gap-1.5 py-4 rounded-lg border-2 border-dashed cursor-pointer transition-colors ${
                dragging
                  ? darkMode
                    ? 'border-[var(--accent-blue,#2a9fd4)] bg-[var(--accent-blue,#2a9fd4)]/10'
                    : 'border-[var(--accent-blue,#2a9fd4)] bg-blue-50'
                  : darkMode
                    ? 'border-zinc-700 hover:border-zinc-500'
                    : 'border-zinc-300 hover:border-zinc-400'
              }`}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={dragging ? 'text-[var(--accent-blue,#2a9fd4)]' : textDim}>
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              <span className={`text-[11px] ${dragging ? 'text-[var(--accent-blue,#2a9fd4)]' : textDim}`}>
                {dragging ? 'Drop files here' : 'Drop files here or click to upload'}
              </span>
              <span className={`text-[10px] ${textDim} opacity-60`}>.md, .txt, .pdf</span>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".md,.txt,.pdf"
              className="hidden"
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) {
                  addFiles(e.target.files);
                  e.target.value = '';
                }
              }}
            />
          </div>

          {/* Staged file list */}
          {files.length > 0 && (
            <div className="space-y-1">
              {files.map((f, i) => (
                <div
                  key={`${f.name}-${i}`}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-[11px] ${
                    darkMode ? 'bg-zinc-800 text-zinc-300' : 'bg-zinc-50 text-zinc-700'
                  }`}
                >
                  <span className={`shrink-0 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                    f.name.toLowerCase().endsWith('.pdf')
                      ? darkMode ? 'bg-red-900/40 text-red-400' : 'bg-red-100 text-red-600'
                      : darkMode ? 'bg-blue-900/40 text-blue-400' : 'bg-blue-100 text-blue-600'
                  }`}>
                    {f.name.toLowerCase().endsWith('.pdf') ? 'PDF' : 'MD'}
                  </span>
                  <span className="flex-1 min-w-0 truncate">{f.name}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); removeFile(i); }}
                    className={`shrink-0 p-0.5 rounded transition-colors ${textDim} ${hoverBg}`}
                    title="Remove"
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className={`px-5 py-3 border-t ${border} flex items-center justify-end gap-2`}>
          <button
            onClick={onCancel}
            className={`px-4 py-1.5 rounded-md text-[11px] font-medium transition-colors ${
              darkMode
                ? 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
                : 'text-zinc-500 hover:text-zinc-700 hover:bg-zinc-100'
            }`}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim()}
            className={`px-4 py-1.5 rounded-md text-[11px] font-semibold transition-colors ${
              name.trim()
                ? 'bg-[var(--accent-blue,#2a9fd4)] text-white hover:opacity-90'
                : darkMode
                  ? 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
                  : 'bg-zinc-100 text-zinc-400 cursor-not-allowed'
            }`}
          >
            Save
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
