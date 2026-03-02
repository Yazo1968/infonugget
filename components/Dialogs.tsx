import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Card, DocChangeEvent } from '../types';
import { useFocusTrap } from '../hooks/useFocusTrap';

// ── Manifest Batch Confirmation Modal ──
interface ManifestModalProps {
  manifestCards: Card[];
  onExecute: () => void;
  onClose: () => void;
}

export const ManifestModal: React.FC<ManifestModalProps> = ({ manifestCards, onExecute, onClose }) => {
  const focusTrapRef = useFocusTrap<HTMLDivElement>({ onEscape: onClose });
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center animate-in fade-in duration-200 bg-black/20 dark:bg-black/40">
      <div
        ref={focusTrapRef}
        role="dialog"
        aria-modal="true"
        aria-label="Confirm image generation"
        className="w-full max-w-xs bg-white dark:bg-zinc-900 rounded-3xl p-7 border border-zinc-200 dark:border-zinc-600 animate-in zoom-in-95 duration-300"
        style={{ boxShadow: '0 12px 48px rgba(0,0,0,0.25), 0 4px 16px rgba(0,0,0,0.15)' }}
      >
        <div className="space-y-4 text-center">
          <svg
            width="36"
            height="36"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="mx-auto text-zinc-800 dark:text-zinc-200"
          >
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
          </svg>
          <div className="space-y-2">
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 font-light leading-relaxed">
              Render <span className="font-bold text-zinc-800 dark:text-zinc-200">{manifestCards.length}</span> card{' '}
              {manifestCards.length === 1 ? 'image' : 'images'} using the current template settings?
            </p>
          </div>
          <div className="flex flex-col space-y-2 pt-2">
            <button
              onClick={onExecute}
              className="w-full py-3 rounded-full bg-accent-blue text-white text-[9px] font-black uppercase tracking-widest shadow-lg dark:shadow-black/30 shadow-[rgba(42,159,212,0.2)] hover:scale-[1.02] transition-all"
            >
              Generate
            </button>
            <button
              onClick={onClose}
              className="w-full py-3 rounded-full bg-zinc-50 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 text-[9px] font-black uppercase tracking-widest hover:bg-zinc-100 dark:hover:bg-zinc-700 hover:text-zinc-800 dark:hover:text-zinc-200 transition-all"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Unsaved Changes Dialog ──
interface UnsavedChangesDialogProps {
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
  title?: string;
  description?: string;
  saveLabel?: string;
  discardLabel?: string;
  /** When provided, shows a name input field. onSave receives the name via onSaveWithName instead. */
  nameInput?: {
    defaultName: string;
    existingNames: string[];
    onSaveWithName: (name: string) => void;
  };
}

export const UnsavedChangesDialog: React.FC<UnsavedChangesDialogProps> = ({
  onSave,
  onDiscard,
  onCancel,
  title,
  description,
  saveLabel,
  discardLabel,
  nameInput,
}) => {
  const [cardName, setCardName] = useState(nameInput?.defaultName || '');
  const [nameError, setNameError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const focusTrapRef = useFocusTrap<HTMLDivElement>({ onEscape: onCancel });

  useEffect(() => {
    if (nameInput) {
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 100);
    }
  }, [nameInput]);

  const handleSave = () => {
    if (nameInput) {
      const trimmed = cardName.trim();
      if (!trimmed) {
        setNameError('Name cannot be empty');
        return;
      }
      if (nameInput.existingNames.some((n) => n.toLowerCase() === trimmed.toLowerCase())) {
        setNameError('A card with this name already exists');
        return;
      }
      setNameError('');
      nameInput.onSaveWithName(trimmed);
    } else {
      onSave();
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 dark:bg-black/60 animate-in fade-in duration-300">
      <div
        ref={focusTrapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="unsaved-changes-title"
        className="w-full max-w-sm bg-white dark:bg-zinc-900 rounded-[40px] p-10 shadow-2xl dark:shadow-black/30 border border-zinc-200 dark:border-zinc-600 animate-in zoom-in-95 duration-300"
      >
        <div className="space-y-6 text-center">
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
              className="text-zinc-800 dark:text-zinc-200"
            >
              <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </div>
          <div className="space-y-2">
            <h3
              id="unsaved-changes-title"
              className="text-[15px] font-black tracking-tight text-zinc-800 dark:text-zinc-200"
            >
              {title || 'Unsaved changes'}
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 font-light leading-relaxed">
              {description || 'You have unsaved edits. Save or discard them to continue.'}
            </p>
          </div>
          {nameInput && (
            <div className="text-left space-y-1.5">
              <label
                htmlFor="unsaved-card-name"
                className="text-[9px] font-black uppercase tracking-[0.15em] text-zinc-500 dark:text-zinc-400"
              >
                Card Name
              </label>
              <input
                id="unsaved-card-name"
                ref={inputRef}
                type="text"
                value={cardName}
                onChange={(e) => {
                  setCardName(e.target.value);
                  setNameError('');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSave();
                }}
                placeholder="Enter a name for this card"
                className={`w-full px-4 py-3 rounded-2xl border ${nameError ? 'border-red-300' : 'border-zinc-200 dark:border-zinc-600'} bg-zinc-50 dark:bg-zinc-800 text-xs text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-zinc-400/50 dark:focus:ring-zinc-500/50 focus:border-black transition-colors placeholder:text-zinc-500 dark:placeholder:text-zinc-400`}
                aria-invalid={!!nameError || undefined}
                aria-describedby={nameError ? 'unsaved-card-name-error' : undefined}
              />
              {nameError && (
                <p id="unsaved-card-name-error" className="text-[10px] text-red-500 font-medium">
                  {nameError}
                </p>
              )}
            </div>
          )}
          <div className="flex flex-col space-y-3 pt-4">
            <button
              onClick={handleSave}
              className="w-full py-4 rounded-full bg-black text-white text-[10px] font-black uppercase tracking-widest hover:scale-[1.02] transition-all"
            >
              {saveLabel || 'Save Changes'}
            </button>
            <button
              onClick={onDiscard}
              className="w-full py-4 rounded-full bg-zinc-50 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 text-[10px] font-black uppercase tracking-widest hover:bg-zinc-100 dark:hover:bg-zinc-700 hover:text-zinc-800 dark:hover:text-zinc-200 transition-all"
            >
              {discardLabel || 'Discard Changes'}
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
};

// ── Reference Image Mismatch Dialog ──
interface ReferenceMismatchDialogProps {
  onDisableReference: () => void;
  onSkipOnce: () => void;
  onCancel: () => void;
}

// ── Document Change Notice Dialog ──
interface DocumentChangeNoticeProps {
  changes: DocChangeEvent[];
  onContinue: () => void;
  onStartFresh: () => void;
  onCancel: () => void;
}

export const DocumentChangeNotice: React.FC<DocumentChangeNoticeProps> = ({
  changes,
  onContinue,
  onStartFresh,
  onCancel,
}) => {
  const focusTrapRef = useFocusTrap<HTMLDivElement>({ onEscape: onCancel });
  // Group events by document (using docId), tracking latest name per doc
  const docMap = new Map<string, { name: string; events: string[] }>();
  const docOrder: string[] = [];
  for (const e of changes) {
    let entry = docMap.get(e.docId);
    if (!entry) {
      entry = { name: e.docName, events: [] };
      docMap.set(e.docId, entry);
      docOrder.push(e.docId);
    }
    switch (e.type) {
      case 'added':
        entry.events.push('Added');
        break;
      case 'removed':
        entry.events.push('Removed');
        break;
      case 'renamed':
        entry.events.push(`Renamed from "${e.oldName}"`);
        entry.name = e.docName;
        break;
      case 'enabled':
        entry.events.push('Enabled');
        break;
      case 'disabled':
        entry.events.push('Disabled');
        break;
      case 'updated':
        entry.events.push('Content updated');
        break;
      default:
        entry.events.push('Changed');
        break;
    }
  }
  const grouped = docOrder.map((id) => docMap.get(id)!);

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 animate-in fade-in duration-300"
      onClick={onCancel}
    >
      <div
        ref={focusTrapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="doc-change-title"
        className="w-full max-w-md mx-4 bg-white dark:bg-zinc-900 rounded-xl shadow-2xl border border-zinc-200 dark:border-zinc-700 flex flex-col animate-in zoom-in-95 duration-300"
        style={{ maxHeight: 'min(520px, 80vh)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-700 flex items-center gap-2.5">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="shrink-0 text-zinc-400 dark:text-zinc-500"
          >
            <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
            <polyline points="14 2 14 8 20 8" />
            <path d="M12 18v-6" />
            <path d="M9 15l3-3 3 3" />
          </svg>
          <h3
            id="doc-change-title"
            className="text-[13px] font-semibold text-zinc-900 dark:text-zinc-100"
          >
            Sources changed
          </h3>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
            {grouped.length === 1 ? '1 document was' : `${grouped.length} documents were`} changed since the last
            message:
          </p>
          <div
            className="text-[11px] text-zinc-600 dark:text-zinc-400 space-y-2"
            style={{ scrollbarWidth: 'none' }}
          >
            {grouped.map((g, i) => (
              <div key={i}>
                <p className="font-semibold text-zinc-900 dark:text-zinc-100 truncate" title={g.name}>
                  {g.name}
                </p>
                <ul className="space-y-0.5 ml-2 mt-0.5">
                  {g.events.map((ev, j) => (
                    <li key={j} className="flex items-start gap-1.5">
                      <span className="text-zinc-400 dark:text-zinc-500 mt-px shrink-0">•</span>
                      <span>{ev}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-zinc-200 dark:border-zinc-700 flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-1.5 rounded-md text-[11px] font-medium transition-colors text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            onClick={onStartFresh}
            className="px-4 py-1.5 rounded-md text-[11px] font-medium transition-colors text-zinc-600 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700"
          >
            Start Fresh
          </button>
          <button
            onClick={onContinue}
            className="px-4 py-1.5 rounded-md text-[11px] font-semibold transition-colors bg-[var(--accent-blue,#2a9fd4)] text-white hover:opacity-90"
          >
            Continue Chat
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export const ReferenceMismatchDialog: React.FC<ReferenceMismatchDialogProps> = ({
  onDisableReference,
  onSkipOnce,
  onCancel,
}) => {
  const focusTrapRef = useFocusTrap<HTMLDivElement>({ onEscape: onCancel });
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center animate-in fade-in duration-200 bg-black/20 dark:bg-black/40">
      <div
        ref={focusTrapRef}
        role="dialog"
        aria-modal="true"
        aria-label="Reference image mismatch"
        className="w-full max-w-xs bg-white dark:bg-zinc-900 rounded-3xl p-7 border border-zinc-200 dark:border-zinc-600 animate-in zoom-in-95 duration-300"
        style={{ boxShadow: '0 12px 48px rgba(0,0,0,0.25), 0 4px 16px rgba(0,0,0,0.15)' }}
      >
        <div className="space-y-4 text-center">
          <svg
            width="36"
            height="36"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="mx-auto text-zinc-800 dark:text-zinc-200"
          >
            <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <div className="space-y-2 mt-4">
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 font-light leading-relaxed">
              Your image generation style settings do not match the reference image styling.
            </p>
          </div>
          <div className="flex flex-col space-y-2 pt-2">
            <button
              onClick={onSkipOnce}
              className="w-full py-3 rounded-full bg-accent-blue text-white text-[9px] font-black uppercase tracking-widest shadow-lg dark:shadow-black/30 shadow-[rgba(42,159,212,0.2)] hover:scale-[1.02] transition-all"
            >
              Skip Reference This Time
            </button>
            <button
              onClick={onDisableReference}
              className="w-full py-3 rounded-full bg-zinc-50 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 text-[9px] font-black uppercase tracking-widest hover:bg-zinc-100 dark:hover:bg-zinc-700 hover:text-zinc-800 dark:hover:text-zinc-200 transition-all"
            >
              Turn Off Reference
            </button>
            <button
              onClick={onCancel}
              className="w-full py-3 rounded-full bg-zinc-50 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 text-[9px] font-black uppercase tracking-widest hover:bg-zinc-100 dark:hover:bg-zinc-700 hover:text-zinc-800 dark:hover:text-zinc-200 transition-all"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
