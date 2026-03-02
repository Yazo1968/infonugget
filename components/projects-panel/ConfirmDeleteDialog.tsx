import React from 'react';
import { createPortal } from 'react-dom';

interface ConfirmDeleteDialogProps {
  itemType: 'project' | 'nugget' | 'document';
  itemName: string;
  cascadeCount?: number;
  onConfirm: () => void;
  onCancel: () => void;
}

const ConfirmDeleteDialog: React.FC<ConfirmDeleteDialogProps> = ({
  itemType,
  itemName,
  cascadeCount,
  onConfirm,
  onCancel,
}) => {
  const label = itemType === 'project' ? 'Project' : itemType === 'nugget' ? 'Nugget' : 'Document';

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 dark:bg-black/60"
      onClick={onCancel}
    >
      <div
        className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl dark:shadow-black/30 mx-4 overflow-hidden"
        style={{ minWidth: 260, maxWidth: 'calc(100vw - 32px)', width: 'fit-content' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 pt-6 pb-3 text-center">
          <div className="w-9 h-9 rounded-full bg-zinc-100 dark:bg-zinc-800/50 flex items-center justify-center mx-auto mb-3">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              className="text-zinc-500 dark:text-zinc-400"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 6h18" />
              <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
              <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
            </svg>
          </div>
          <h3 className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 tracking-tight mb-1">
            Delete {label}
          </h3>
          <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400 whitespace-nowrap">{itemName}</p>
          {itemType === 'project' && cascadeCount && cascadeCount > 0 && (
            <p className="text-[12px] text-amber-600 mt-2">
              This will also delete {cascadeCount} nugget{cascadeCount > 1 ? 's' : ''}.
            </p>
          )}
          <p className="text-[12px] text-zinc-500 dark:text-zinc-400 mt-2">This cannot be undone.</p>
        </div>
        <div className="px-6 pb-5 pt-1 flex items-center justify-center gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 bg-zinc-900 text-white text-xs font-medium rounded-lg hover:bg-zinc-800 transition-colors"
          >
            Delete
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default ConfirmDeleteDialog;
