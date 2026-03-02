import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { CardFolder } from '../types';
import { isNameTaken } from '../utils/naming';

interface FolderPickerDialogProps {
  folders: CardFolder[];
  onSelect: (folderId: string) => void;
  onCreateAndSelect: (folderName: string) => void;
  onCancel: () => void;
}

export default function FolderPickerDialog({
  folders,
  onSelect,
  onCreateAndSelect,
  onCancel,
}: FolderPickerDialogProps) {
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [showCreateInput, setShowCreateInput] = useState(folders.length === 0);
  const [newFolderName, setNewFolderName] = useState('');
  const createInputRef = useRef<HTMLInputElement>(null);

  // Auto-focus the create input when shown
  useEffect(() => {
    if (showCreateInput) {
      setTimeout(() => createInputRef.current?.focus(), 50);
    }
  }, [showCreateInput]);

  const folderNames = folders.map((f) => f.name);
  const nameConflict = isNameTaken(newFolderName.trim(), folderNames);
  const canCreate = !!newFolderName.trim() && !nameConflict;

  const handleConfirm = () => {
    if (showCreateInput && canCreate) {
      onCreateAndSelect(newFolderName.trim());
    } else if (selectedFolderId) {
      onSelect(selectedFolderId);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onCancel();
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 dark:bg-black/60 animate-in fade-in duration-300"
      onClick={onCancel}
      onKeyDown={handleKeyDown}
    >
      <div
        className="w-full max-w-sm bg-white dark:bg-zinc-900 rounded-[40px] p-10 shadow-2xl dark:shadow-black/30 border border-zinc-100 dark:border-zinc-700 animate-in zoom-in-95 duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-6 text-center">
          {/* Icon */}
          <div className="w-16 h-16 flex items-center justify-center mx-auto">
            <svg
              width="36"
              height="36"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-black dark:text-zinc-200"
            >
              <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
            </svg>
          </div>

          {/* Title & description */}
          <div className="space-y-2">
            <h3 className="text-[15px] font-black tracking-tight text-zinc-800 dark:text-zinc-200">
              Select Folder
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 font-light leading-relaxed">
              Choose a folder for the new card, or create a new one.
            </p>
          </div>

          {/* Folder list */}
          {folders.length > 0 && (
            <div className="max-h-48 overflow-y-auto rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800">
              {folders.map((folder) => (
                <button
                  key={folder.id}
                  onClick={() => {
                    setSelectedFolderId(folder.id);
                    setShowCreateInput(false);
                    setNewFolderName('');
                  }}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-left text-xs transition-colors ${
                    selectedFolderId === folder.id && !showCreateInput
                      ? 'bg-black/5 dark:bg-white/10 text-zinc-900 dark:text-zinc-100 font-semibold'
                      : 'text-zinc-700 dark:text-zinc-300 hover:bg-black/[0.03] dark:hover:bg-white/5'
                  }`}
                >
                  {/* Folder icon */}
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="shrink-0 text-zinc-400 dark:text-zinc-500"
                  >
                    <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
                  </svg>
                  <span className="truncate">{folder.name}</span>
                  <span className="ml-auto text-[10px] text-zinc-400 dark:text-zinc-500 tabular-nums">
                    {folder.cards.length}
                  </span>
                  {selectedFolderId === folder.id && !showCreateInput && (
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="shrink-0 text-black dark:text-white"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* Create new folder section */}
          {!showCreateInput ? (
            <button
              onClick={() => {
                setShowCreateInput(true);
                setSelectedFolderId(null);
              }}
              className="w-full flex items-center justify-center gap-2 py-3 text-[10px] font-bold uppercase tracking-widest text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Create New Folder
            </button>
          ) : (
            <div className="text-left space-y-1.5">
              <label
                htmlFor="picker-new-folder-name"
                className="text-[9px] font-black uppercase tracking-[0.15em] text-zinc-500 dark:text-zinc-400"
              >
                New Folder Name
              </label>
              <input
                id="picker-new-folder-name"
                ref={createInputRef}
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && canCreate) handleConfirm();
                  if (e.key === 'Escape') {
                    if (folders.length > 0) {
                      setShowCreateInput(false);
                      setNewFolderName('');
                    } else {
                      onCancel();
                    }
                  }
                }}
                placeholder="Enter folder name"
                className={`w-full px-4 py-3 rounded-2xl border bg-zinc-50 dark:bg-zinc-800 text-xs text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-2 transition-colors placeholder:text-zinc-500 ${
                  nameConflict
                    ? 'border-red-300 focus:border-red-400 focus:ring-red-300/50'
                    : 'border-zinc-200 dark:border-zinc-700 focus:border-black focus:ring-zinc-400/50 dark:focus:ring-zinc-500/50'
                }`}
              />
              {nameConflict && (
                <p className="text-[10px] text-red-500 mt-1">A folder with this name already exists</p>
              )}
              {folders.length > 0 && (
                <button
                  onClick={() => {
                    setShowCreateInput(false);
                    setNewFolderName('');
                  }}
                  className="text-[10px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors mt-1"
                >
                  Back to folder list
                </button>
              )}
            </div>
          )}

          {/* Action buttons */}
          <div className="flex flex-col space-y-3 pt-4">
            <button
              onClick={handleConfirm}
              disabled={showCreateInput ? !canCreate : !selectedFolderId}
              className="w-full py-4 rounded-full bg-black text-white text-[10px] font-black uppercase tracking-widest hover:scale-[1.02] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {showCreateInput ? 'Create & Select' : 'Select Folder'}
            </button>
            <button
              onClick={onCancel}
              className="w-full py-2 text-zinc-600 dark:text-zinc-400 text-[10px] font-bold uppercase tracking-widest hover:text-zinc-800 dark:hover:text-zinc-200 transition-all"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
