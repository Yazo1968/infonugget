import React from 'react';
import { createPortal } from 'react-dom';

interface ProjectKebabMenuProps {
  menuPos: { x: number; y: number };
  onClose: () => void;
  onRename: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

const iconProps = {
  width: 12,
  height: 12,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  className: 'text-zinc-500 dark:text-zinc-400',
};

const btnClass =
  'w-full flex items-center gap-2.5 px-3 py-1.5 text-[11px] text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors';

const ProjectKebabMenu: React.FC<ProjectKebabMenuProps> = ({
  menuPos,
  onClose,
  onRename,
  onDuplicate,
  onDelete,
}) => {
  return createPortal(
    <div
      className="fixed inset-0 z-[129]"
      onClick={onClose}
    >
    <div
      className="fixed z-[130] w-36 bg-white dark:bg-zinc-900 rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-600 py-1"
      style={{ top: menuPos.y, left: menuPos.x }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Rename Project */}
      <button
        className={btnClass}
        onClick={() => { onRename(); onClose(); }}
      >
        <svg {...iconProps}>
          <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
          <path d="m15 5 4 4" />
        </svg>
        Rename Project
      </button>

      {/* Duplicate Project */}
      <button
        className={btnClass}
        onClick={() => { onDuplicate(); onClose(); }}
      >
        <svg {...iconProps}>
          <rect width={14} height={14} x={8} y={8} rx={2} ry={2} />
          <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
        </svg>
        Duplicate Project
      </button>

      {/* Separator */}
      <div className="border-t border-zinc-100 dark:border-zinc-600" />

      {/* Remove Project */}
      <button
        className={`${btnClass} !text-red-600 hover:!bg-red-50`}
        onClick={() => { onDelete(); onClose(); }}
      >
        <svg {...iconProps}>
          <path d="M3 6h18" />
          <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
          <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
        </svg>
        Remove Project
      </button>
    </div>
    </div>,
    document.body
  );
};

export default ProjectKebabMenu;
