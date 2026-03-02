import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Project } from '../../types';

interface NuggetKebabMenuProps {
  menuPos: { x: number; y: number };
  sourceProject: Project | null;
  otherProjects: Project[];
  onClose: () => void;
  onRename: () => void;
  onCopyToProject: (targetProjectId: string) => void;
  onMoveToProject: (sourceProjectId: string, targetProjectId: string) => void;
  onEditSubject: () => void;
  onDelete: () => void;
  onNoProjects: () => void;
}

const NuggetKebabMenu: React.FC<NuggetKebabMenuProps> = ({
  menuPos,
  sourceProject,
  otherProjects,
  onClose,
  onRename,
  onCopyToProject,
  onMoveToProject,
  onEditSubject,
  onDelete,
  onNoProjects,
}) => {
  const [showSubmenu, setShowSubmenu] = useState(false);

  const btnClass =
    'w-full flex items-center gap-2.5 px-3 py-1.5 text-[11px] text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors';

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

  return createPortal(
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-[129]" onClick={onClose} />

      {/* Main menu */}
      <div
        className="fixed z-[130] w-36 bg-white dark:bg-zinc-900 rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-600 py-1"
        style={{ top: menuPos.y, left: menuPos.x }}
      >
        {/* Rename Nugget */}
        <button
          className={btnClass}
          onClick={() => {
            onRename();
            onClose();
          }}
        >
          <svg {...iconProps}>
            <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
            <path d="m15 5 4 4" />
          </svg>
          Rename Nugget
        </button>

        {/* Move/Copy */}
        <div
          className="relative"
          onMouseEnter={() => setShowSubmenu(true)}
          onMouseLeave={() => setShowSubmenu(false)}
        >
          <button
            className={btnClass}
            onClick={() => {
              if (otherProjects.length === 0 && !sourceProject) {
                onNoProjects();
                onClose();
              }
            }}
          >
            <svg {...iconProps}>
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
            <span className="flex-1 text-left">Move/Copy</span>
            <svg {...iconProps} className="text-zinc-400 dark:text-zinc-500">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>

          {/* Submenu */}
          {showSubmenu && (otherProjects.length > 0 || sourceProject) && (
            <div className="absolute left-full top-0 mt-4 ml-1 w-[220px] z-[140] bg-white dark:bg-zinc-900 rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-600 py-1">
              <div className="px-3 py-1.5 text-[10px] uppercase font-semibold tracking-wider text-zinc-400 dark:text-zinc-500">
                Move/Copy to
              </div>
              <div
                className="max-h-[200px] overflow-y-auto"
                style={{ scrollbarWidth: 'thin' }}
              >
                {/* Source project row (duplicate) */}
                {sourceProject && (
                  <div className="group flex items-center gap-2 px-3 py-1.5 hover:bg-amber-50 dark:hover:bg-amber-950/30 transition-colors">
                    <svg
                      {...iconProps}
                      className="text-amber-500 flex-shrink-0"
                    >
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                    </svg>
                    <span className="flex-1 text-[11px] text-amber-600 dark:text-amber-400 font-medium truncate">
                      {sourceProject.name}
                    </span>
                    <button
                      className="opacity-0 group-hover:opacity-100 transition-opacity text-[10px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400 hover:bg-amber-200 dark:hover:bg-amber-900/60 font-medium"
                      onClick={() => {
                        onCopyToProject(sourceProject.id);
                        onClose();
                      }}
                    >
                      Duplicate
                    </button>
                  </div>
                )}

                {/* Other projects rows */}
                {otherProjects.map((project) => (
                  <div
                    key={project.id}
                    className="group flex items-center gap-2 px-3 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                  >
                    <svg
                      {...iconProps}
                      className="text-zinc-400 dark:text-zinc-500 flex-shrink-0"
                    >
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                    </svg>
                    <span className="flex-1 text-[11px] text-zinc-600 dark:text-zinc-400 truncate">
                      {project.name}
                    </span>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 font-medium"
                        onClick={() => {
                          onCopyToProject(project.id);
                          onClose();
                        }}
                      >
                        Copy
                      </button>
                      {sourceProject && (
                        <button
                          className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 font-medium"
                          onClick={() => {
                            onMoveToProject(sourceProject.id, project.id);
                            onClose();
                          }}
                        >
                          Move
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Subject */}
        <button
          className={btnClass}
          onClick={() => {
            onEditSubject();
            onClose();
          }}
        >
          <svg {...iconProps}>
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
          Subject
        </button>

        {/* Separator */}
        <div className="my-1 border-t border-zinc-200 dark:border-zinc-700" />

        {/* Remove Nugget */}
        <button
          className={`${btnClass} !text-red-500 dark:!text-red-400 hover:!text-red-600 dark:hover:!text-red-300`}
          onClick={() => {
            onDelete();
            onClose();
          }}
        >
          <svg {...iconProps} className="text-red-500 dark:text-red-400">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
          Remove Nugget
        </button>
      </div>
    </>,
    document.body
  );
};

export default NuggetKebabMenu;
