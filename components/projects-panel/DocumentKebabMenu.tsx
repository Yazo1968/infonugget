import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { UploadedFile, SourceOrigin } from '../../types';
import { formatTimestampFull } from '../../utils/formatTime';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatSourceType(doc: UploadedFile): string {
  if (doc.sourceType === 'native-pdf') return 'PDF';
  switch (doc.originalFormat) {
    case 'pdf': return 'PDF';
    case 'md': return 'MD';
    default: return 'MD';
  }
}

function formatOrigin(origin?: SourceOrigin): string {
  if (!origin) return '\u2014';
  if (origin.type === 'uploaded') return 'Uploaded';
  const action = origin.type === 'copied' ? 'Copied' : 'Moved';
  const from = [origin.sourceProjectName, origin.sourceNuggetName].filter(Boolean).join(' / ');
  return from ? `${action} from ${from}` : action;
}

function isConvertedToMd(doc: UploadedFile): boolean {
  if (doc.sourceType === 'native-pdf') return false;
  if (doc.originalFormat === 'md') return false;
  return doc.originalFormat === 'pdf';
}

const InfoRow: React.FC<{ label: string; value: string; valueClass?: string }> = ({ label, value, valueClass }) => (
  <div className="flex items-baseline justify-between gap-2">
    <span className="text-[10px] text-zinc-500 dark:text-zinc-400 shrink-0">{label}</span>
    <span className={`text-[10px] truncate text-right max-w-[180px] ${valueClass ?? 'text-zinc-600 dark:text-zinc-400'}`} title={value}>{value}</span>
  </div>
);

interface DocumentKebabMenuProps {
  doc: UploadedFile;
  menuPos: { x: number; y: number };
  otherNuggets?: { id: string; name: string }[];
  projectNuggets?: { projectId: string; projectName: string; nuggets: { id: string; name: string }[] }[];
  onClose: () => void;
  onOpen: () => void;
  onRename: () => void;
  onCopyMove: (targetNuggetId: string, mode: 'copy' | 'move') => void;
  onDownload: () => void;
  onDelete: () => void;
  onNoNuggets: () => void;
}

const DocumentKebabMenu: React.FC<DocumentKebabMenuProps> = ({
  doc,
  menuPos,
  otherNuggets,
  projectNuggets,
  onClose,
  onOpen,
  onRename,
  onCopyMove,
  onDownload,
  onDelete,
  onNoNuggets,
}) => {
  const [showInfoSubmenu, setShowInfoSubmenu] = useState(false);
  const [showCopyMoveSubmenu, setShowCopyMoveSubmenu] = useState(false);

  const btnClass = 'w-full flex items-center gap-2.5 px-3 py-1.5 text-[11px] text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors';
  const iconClass = 'text-zinc-500 dark:text-zinc-400';
  const copyMoveBtnClass = 'px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800/50 hover:bg-zinc-200 dark:hover:bg-zinc-700 hover:text-zinc-800 dark:hover:text-zinc-200 rounded transition-colors';

  const chatEnabled = doc.enabled !== false;
  const chatTimestamp = chatEnabled ? doc.lastEnabledAt : doc.lastDisabledAt;

  const DocumentInfoContent = () => (
    <div className="p-3 space-y-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
        Document Info
      </div>

      {/* Naming */}
      <div className="space-y-1">
        <InfoRow label="Current Name" value={doc.name} />
        {doc.originalName && doc.originalName !== doc.name && (
          <InfoRow label="Original Name" value={doc.originalName} />
        )}
        {doc.lastRenamedAt && (
          <InfoRow label="Renamed" value={formatTimestampFull(doc.lastRenamedAt)} />
        )}
      </div>

      {/* Origin & Type */}
      <div className="space-y-1">
        <InfoRow label="Origin" value={formatOrigin(doc.sourceOrigin)} />
        {doc.sourceOrigin?.timestamp && (
          <InfoRow label="Origin Date" value={formatTimestampFull(doc.sourceOrigin.timestamp)} />
        )}
        <InfoRow label="Source Type" value={formatSourceType(doc)} />
        <InfoRow label="Converted to MD" value={isConvertedToMd(doc) ? 'Yes' : 'No'} />
        {doc.size != null && (
          <InfoRow label="Size" value={formatFileSize(doc.size)} />
        )}
      </div>

      {/* Versions */}
      <div className="space-y-1">
        {doc.version != null && (
          <InfoRow label="Version" value={String(doc.version)} />
        )}
        {doc.lastEditedAt && (
          <InfoRow label="Last Edited" value={formatTimestampFull(doc.lastEditedAt)} />
        )}
      </div>

      {/* Chat */}
      <div className="space-y-1">
        <InfoRow
          label="Status"
          value={chatEnabled ? 'Enabled' : 'Disabled'}
          valueClass={chatEnabled ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}
        />
        {chatTimestamp && (
          <InfoRow label="Changed" value={formatTimestampFull(chatTimestamp)} />
        )}
      </div>
    </div>
  );

  const CopyMoveSubmenu = () => {
    if (projectNuggets && projectNuggets.length > 0) {
      return (
        <div className="py-2 px-2 max-h-64 overflow-y-auto">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 px-1 mb-2">
            Copy/Move to nugget
          </div>
          {projectNuggets.map((proj) => (
            <div key={proj.projectId} className="mb-2">
              <div className="flex items-center gap-1.5 px-1 py-1">
                <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={iconClass}>
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </svg>
                <span className="text-[10px] font-semibold text-zinc-700 dark:text-zinc-300 truncate">{proj.projectName}</span>
              </div>
              {proj.nuggets.map((nug) => (
                <div
                  key={nug.id}
                  className="group flex items-center gap-1.5 px-3 py-1 hover:bg-zinc-50 dark:hover:bg-zinc-800 rounded transition-colors"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 dark:bg-zinc-500 shrink-0" />
                  <span className="text-[10px] text-zinc-600 dark:text-zinc-400 truncate flex-1">{nug.name}</span>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    <button
                      className={copyMoveBtnClass}
                      onClick={() => { onCopyMove(nug.id, 'copy'); onClose(); }}
                    >
                      Copy
                    </button>
                    <button
                      className={copyMoveBtnClass}
                      onClick={() => { onCopyMove(nug.id, 'move'); onClose(); }}
                    >
                      Move
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      );
    }

    return (
      <div className="py-2 px-2 max-h-64 overflow-y-auto">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 px-1 mb-2">
          Copy/Move to nugget
        </div>
        {otherNuggets?.map((nug) => (
          <div
            key={nug.id}
            className="group flex items-center gap-1.5 px-3 py-1 hover:bg-zinc-50 dark:hover:bg-zinc-800 rounded transition-colors"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 dark:bg-zinc-500 shrink-0" />
            <span className="text-[10px] text-zinc-600 dark:text-zinc-400 truncate flex-1">{nug.name}</span>
            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
              <button
                className={copyMoveBtnClass}
                onClick={() => { onCopyMove(nug.id, 'copy'); onClose(); }}
              >
                Copy
              </button>
              <button
                className={copyMoveBtnClass}
                onClick={() => { onCopyMove(nug.id, 'move'); onClose(); }}
              >
                Move
              </button>
            </div>
          </div>
        ))}
      </div>
    );
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[129]"
      onClick={onClose}
    >
      <div
        className="fixed z-[130] w-36 bg-white dark:bg-zinc-900 rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-600 py-1"
        style={{ left: menuPos.x, top: menuPos.y }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Document Info */}
        <div className="relative">
          <button
            className={btnClass}
            onClick={() => setShowInfoSubmenu((v) => !v)}
          >
            <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={iconClass}>
              <circle cx={12} cy={12} r={10} />
              <line x1={12} y1={16} x2={12} y2={12} />
              <line x1={12} y1={8} x2={12.01} y2={8} />
            </svg>
            <span className="flex-1 text-left">Document Info</span>
            <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={iconClass}>
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
          {showInfoSubmenu && (
            <div className="absolute left-full top-0 ml-1 w-64 z-[140] bg-white dark:bg-zinc-900 rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-600">
              <DocumentInfoContent />
            </div>
          )}
        </div>

        {/* Separator */}
        <div className="border-t border-zinc-200 dark:border-zinc-700 my-1" />

        {/* Open */}
        <button
          className={btnClass}
          onClick={() => { onOpen(); onClose(); }}
        >
          <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={iconClass}>
            <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
            <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
          </svg>
          <span className="flex-1 text-left">Open</span>
        </button>

        {/* Rename */}
        <button
          className={btnClass}
          onClick={() => { onRename(); onClose(); }}
        >
          <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={iconClass}>
            <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
          </svg>
          <span className="flex-1 text-left">Rename</span>
        </button>

        {/* Copy/Move */}
        <div
          className="relative"
          onMouseEnter={() => setShowCopyMoveSubmenu(true)}
          onMouseLeave={() => setShowCopyMoveSubmenu(false)}
        >
          <button
            className={btnClass}
            onClick={() => {
              if (!otherNuggets || otherNuggets.length === 0) {
                onNoNuggets();
                onClose();
              }
            }}
          >
            <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={iconClass}>
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
            <span className="flex-1 text-left">Copy/Move</span>
            <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={iconClass}>
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
          {showCopyMoveSubmenu && otherNuggets && otherNuggets.length > 0 && (
            <div className="absolute left-full top-0 -ml-1 w-[220px] z-[140] bg-white dark:bg-zinc-900 rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-600">
              <CopyMoveSubmenu />
            </div>
          )}
        </div>

        {/* Download */}
        <button
          className={btnClass}
          onClick={() => { onDownload(); onClose(); }}
        >
          <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={iconClass}>
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1={12} y1={15} x2={12} y2={3} />
          </svg>
          <span className="flex-1 text-left">Download</span>
        </button>

        {/* Separator */}
        <div className="border-t border-zinc-200 dark:border-zinc-700 my-1" />

        {/* Remove */}
        <button
          className={`${btnClass} !text-red-500 dark:!text-red-400 hover:!text-red-600 dark:hover:!text-red-300`}
          onClick={() => { onDelete(); onClose(); }}
        >
          <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="text-red-500 dark:text-red-400">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
          <span className="flex-1 text-left">Remove</span>
        </button>
      </div>
    </div>,
    document.body
  );
};

export default DocumentKebabMenu;
