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
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => nameInputRef.current?.focus(), 50);
  }, []);

  const handleSave = useCallback(() => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSave(trimmed, []);
  }, [name, onSave]);

  const bg = darkMode ? 'bg-zinc-900' : 'bg-white';
  const border = darkMode ? 'border-zinc-700' : 'border-zinc-200';
  const textPrimary = darkMode ? 'text-zinc-100' : 'text-zinc-900';
  const textDim = darkMode ? 'text-zinc-500' : 'text-zinc-400';

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50"
      onClick={onCancel}
      onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}
    >
      <div
        className={`w-full max-w-sm ${bg} rounded-xl shadow-2xl border ${border} flex flex-col`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`px-5 py-3.5 border-b ${border}`}>
          <h2 className={`text-[13px] font-semibold ${textPrimary}`}>Create New Nugget</h2>
        </div>

        {/* Body */}
        <div className="px-5 py-4">
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
            Create
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
