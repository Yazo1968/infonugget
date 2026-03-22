import React, { useState, useRef, useEffect } from 'react';
import { AnnotationTool, Palette } from '../../types';

interface AnnotationToolbarProps {
  activeTool: AnnotationTool;
  onToolChange: (tool: AnnotationTool) => void;
  annotationCount: number;
  onDiscardMarks: () => void;
  onModify?: () => void;
  isModifying?: boolean;
  activeColor?: string;
  onColorChange?: (color: string) => void;
  palette?: Palette;
  disabled?: boolean;
  hasSelection?: boolean;
  onDeleteSelected?: () => void;
  inline?: boolean;
  zoomScale?: number;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onZoomReset?: () => void;
  onRequestFullscreen?: () => void;
  globalInstruction?: string;
  onGlobalInstructionChange?: (text: string) => void;
}

const tools: { id: AnnotationTool; label: string; icon: React.ReactNode; enabled: boolean }[] = [
  {
    id: 'select',
    label: 'Select',
    enabled: true,
    icon: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z" />
      </svg>
    ),
  },
  {
    id: 'pin',
    label: 'Pin',
    enabled: true,
    icon: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 17v5" />
        <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
      </svg>
    ),
  },
  {
    id: 'arrow',
    label: 'Arrow',
    enabled: true,
    icon: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M7 17V7h10" />
        <path d="M17 17 7 7" />
      </svg>
    ),
  },
  {
    id: 'rectangle',
    label: 'Rectangle',
    enabled: true,
    icon: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M5 3a2 2 0 0 0-2 2" />
        <path d="M19 3a2 2 0 0 1 2 2" />
        <path d="M21 19a2 2 0 0 1-2 2" />
        <path d="M5 21a2 2 0 0 1-2-2" />
        <path d="M9 3h1" />
        <path d="M9 21h1" />
        <path d="M14 3h1" />
        <path d="M14 21h1" />
        <path d="M3 9v1" />
        <path d="M21 9v1" />
        <path d="M3 14v1" />
        <path d="M21 14v1" />
      </svg>
    ),
  },
  {
    id: 'sketch',
    label: 'Sketch',
    enabled: true,
    icon: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M7 3.5c5-2 7 2.5 3 4C1.5 10 2 15 5 16c5 2 9-10 14-7s.5 13.5-4 12c-5-2.5.5-11 6-2" />
      </svg>
    ),
  },
];

const AnnotationToolbar: React.FC<AnnotationToolbarProps> = ({
  activeTool,
  onToolChange,
  annotationCount,
  onDiscardMarks,
  onModify,
  isModifying,
  activeColor,
  onColorChange,
  palette,
  disabled,
  hasSelection,
  onDeleteSelected,
  inline,
  zoomScale: _zoomScale,
  onZoomIn: _onZoomIn,
  onZoomOut: _onZoomOut,
  onZoomReset: _onZoomReset,
  onRequestFullscreen: _onRequestFullscreen,
  globalInstruction,
  onGlobalInstructionChange,
}) => {
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showTextPanel, setShowTextPanel] = useState(false);
  const [showDeleteMenu, setShowDeleteMenu] = useState(false);
  const deleteMenuRef = useRef<HTMLDivElement>(null);
  const colorPickerRef = useRef<HTMLDivElement>(null);
  const colorInputRef = useRef<HTMLInputElement>(null);
  const textPanelRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const hasGlobalText = !!(globalInstruction && globalInstruction.trim());
  const canModify = annotationCount > 0 || hasGlobalText;

  // Close color picker on click outside
  useEffect(() => {
    if (!showColorPicker) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (colorPickerRef.current && !colorPickerRef.current.contains(e.target as Node)) {
        setShowColorPicker(false);
      }
    };
    const timer = setTimeout(() => {
      window.addEventListener('mousedown', handleClickOutside);
    }, 50);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showColorPicker]);

  // Close text panel on click outside
  useEffect(() => {
    if (!showTextPanel) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (textPanelRef.current && !textPanelRef.current.contains(e.target as Node)) {
        setShowTextPanel(false);
      }
    };
    const timer = setTimeout(() => {
      window.addEventListener('mousedown', handleClickOutside);
    }, 50);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showTextPanel]);

  // Close delete menu on click outside
  useEffect(() => {
    if (!showDeleteMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (deleteMenuRef.current && !deleteMenuRef.current.contains(e.target as Node)) {
        setShowDeleteMenu(false);
      }
    };
    const timer = setTimeout(() => {
      window.addEventListener('mousedown', handleClickOutside);
    }, 50);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showDeleteMenu]);

  // Auto-focus textarea when panel opens
  useEffect(() => {
    if (showTextPanel) {
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [showTextPanel]);

  // Build palette colors array
  const paletteColors: string[] = [];
  if (palette) {
    const vals = [palette.primary, palette.secondary, palette.accent, palette.text, palette.background];
    for (const c of vals) {
      if (c && !paletteColors.includes(c)) paletteColors.push(c);
    }
  }
  // Always include some defaults if palette is sparse
  const defaultColors = ['#E63946', '#457B9D', '#2A9D8F', '#E9C46A', '#264653'];
  for (const c of defaultColors) {
    if (!paletteColors.includes(c) && paletteColors.length < 5) {
      paletteColors.push(c);
    }
  }

  return (
    <div
      className={`${inline ? '' : 'absolute bottom-6 left-1/2 -translate-x-1/2 z-[115] '} px-1.5 h-9 flex items-center space-x-1 animate-in fade-in slide-in-from-bottom-2 duration-300`}
    >
      {/* Tool Buttons */}
      {tools.map((tool) => (
        <button
          key={tool.id}
          onClick={() => tool.enabled && !disabled && onToolChange(tool.id)}
          disabled={!tool.enabled || disabled}
          title={tool.label}
          aria-label={tool.label}
          className={`
            w-7 h-7 rounded-full flex items-center justify-center transition-all
            ${
              activeTool === tool.id
                ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200'
                : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 hover:text-zinc-800 dark:hover:text-zinc-200 disabled:opacity-40 disabled:pointer-events-none'
            }
          `}
        >
          {tool.icon}
        </button>
      ))}

      {/* Text Instruction Button */}
      {onGlobalInstructionChange && (
        <div className="relative" ref={textPanelRef}>
          <button
            onClick={() => setShowTextPanel(!showTextPanel)}
            title="Text Instruction"
            aria-label="Text Instruction"
            className={`
              w-7 h-7 rounded-full flex items-center justify-center transition-all relative
              ${
                showTextPanel
                  ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200'
                  : hasGlobalText
                    ? 'text-zinc-600 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800/50'
                    : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 hover:text-zinc-800 dark:hover:text-zinc-200'
              }
            `}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22z" />
            </svg>
            {/* Dot indicator when instruction text exists */}
            {hasGlobalText && !showTextPanel && (
              <div className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-zinc-900 dark:bg-zinc-100 border-2 border-white dark:border-zinc-900" />
            )}
          </button>

          {/* Text instruction popover */}
          {showTextPanel && (
            <div
              className={`absolute left-1/2 -translate-x-1/2 w-[360px] bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-700 shadow-lg dark:shadow-black/30 overflow-hidden animate-in fade-in zoom-in-95 duration-200 ${inline ? 'top-full mt-3' : 'bottom-full mb-3'}`}
            >
              <div className="px-4 py-2.5 flex items-center justify-between">
                <span className="text-[11px] font-medium uppercase tracking-[0.15em] text-zinc-500 dark:text-zinc-400">
                  Global Instruction
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => {
                      onGlobalInstructionChange('');
                      setShowTextPanel(false);
                    }}
                    className="w-6 h-6 rounded-full flex items-center justify-center text-zinc-400 dark:text-zinc-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
                    title="Clear & close"
                    aria-label="Clear and close"
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M3 6h18" />
                      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                    </svg>
                  </button>
                  <button
                    onClick={() => setShowTextPanel(false)}
                    className="w-6 h-6 rounded-full flex items-center justify-center text-zinc-400 dark:text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
                    title="Save & close"
                    aria-label="Save and close"
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </button>
                </div>
              </div>
              <div className="px-4 pb-3">
                <textarea
                  ref={textareaRef}
                  value={globalInstruction || ''}
                  onChange={(e) => onGlobalInstructionChange(e.target.value)}
                  placeholder="Describe changes to apply globally..."
                  aria-label="Global instruction for annotations"
                  rows={6}
                  className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2.5 text-[13px] leading-relaxed text-zinc-700 dark:text-zinc-300 resize-none focus:outline-none focus:ring-2 focus:ring-zinc-400/50 dark:focus:ring-zinc-500/50 focus:border-zinc-400 dark:focus:border-zinc-500 transition-colors placeholder:text-zinc-400 dark:placeholder:text-zinc-500"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      setShowTextPanel(false);
                    }
                    if (e.key === 'Escape') {
                      setShowTextPanel(false);
                    }
                    e.stopPropagation();
                  }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Delete annotations — dropdown */}
      <div className="relative" ref={deleteMenuRef}>
        <button
          onClick={() => setShowDeleteMenu(!showDeleteMenu)}
          disabled={(annotationCount === 0 && !hasSelection)}
          title="Delete annotations"
          aria-label="Delete annotations"
          className={`w-7 h-7 rounded-full flex items-center justify-center transition-all ${showDeleteMenu ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200' : 'text-zinc-600 dark:text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950'} disabled:opacity-40 disabled:pointer-events-none`}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 6h18" />
            <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
            <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
          </svg>
        </button>
        {showDeleteMenu && (
          <div
            className={`absolute left-1/2 -translate-x-1/2 bg-white dark:bg-zinc-900 rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-700 py-1 min-w-[180px] z-[140] animate-in fade-in zoom-in-95 duration-150 ${inline ? 'top-full mt-2' : 'bottom-full mb-2'}`}
          >
            <button
              onClick={() => {
                onDeleteSelected?.();
                setShowDeleteMenu(false);
              }}
              disabled={!hasSelection}
              className="w-full text-left px-3 py-1.5 text-[11px] text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors flex items-center gap-2 disabled:opacity-40 disabled:pointer-events-none"
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
                className="text-zinc-500 dark:text-zinc-400"
              >
                <path d="M3 6h18" />
                <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
              </svg>
              Delete Selected
            </button>
            <button
              onClick={() => {
                onDiscardMarks();
                setShowDeleteMenu(false);
              }}
              disabled={annotationCount === 0}
              className="w-full text-left px-3 py-1.5 text-[11px] text-red-600 hover:bg-red-50 transition-colors flex items-center gap-2 disabled:opacity-40 disabled:pointer-events-none"
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
                <path d="M3 6h18" />
                <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
              </svg>
              Delete All Annotations
            </button>
          </div>
        )}
      </div>

      {/* Separator */}
      <div className="w-px h-3.5 bg-zinc-200 dark:bg-zinc-700 mx-0.5" />

      {/* Color Picker */}
      {onColorChange && (
        <div className="relative" ref={colorPickerRef}>
          <button
            onClick={() => setShowColorPicker(!showColorPicker)}
            title="Annotation Color"
            aria-label="Annotation color"
            className="w-7 h-7 rounded-full flex items-center justify-center transition-all hover:scale-110"
          >
            <div
              className="w-4 h-4 rounded-full border-2 border-white shadow-md transition-transform"
              style={{ backgroundColor: activeColor || '#E63946' }}
            />
          </button>

          {/* Color picker popover */}
          {showColorPicker && (
            <div
              className={`absolute left-1/2 -translate-x-1/2 bg-white dark:bg-zinc-900 rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-700 p-3 animate-in fade-in zoom-in-95 duration-200 ${inline ? 'top-full mt-3' : 'bottom-full mb-3'}`}
            >
              <div className="text-[11px] font-medium uppercase tracking-[0.2em] text-black mb-2 px-1">Color</div>
              <div className="flex items-center space-x-2">
                {paletteColors.map((color) => (
                  <button
                    key={color}
                    onClick={() => {
                      onColorChange(color);
                      setShowColorPicker(false);
                    }}
                    className="relative w-7 h-7 rounded-full transition-all hover:scale-110"
                    style={{ backgroundColor: color }}
                    title={color}
                    aria-label={`Select color ${color}`}
                  >
                    {activeColor === color && (
                      <div className="absolute inset-0 rounded-full border-[2.5px] border-[#2a9fd4] shadow-[0_0_0_2px_rgba(0,0,0,0.1)]" />
                    )}
                  </button>
                ))}

                {/* Custom color button */}
                <button
                  onClick={() => colorInputRef.current?.click()}
                  className="w-7 h-7 rounded-full border-2 border-dashed border-zinc-200 dark:border-zinc-700 flex items-center justify-center text-zinc-500 dark:text-zinc-400 hover:border-zinc-400 dark:hover:border-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                  title="Custom color"
                  aria-label="Custom color"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                </button>
                <input
                  ref={colorInputRef}
                  type="color"
                  value={activeColor || '#E63946'}
                  onChange={(e) => {
                    onColorChange(e.target.value);
                    setShowColorPicker(false);
                  }}
                  className="sr-only"
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Separator */}
      <div className="w-px h-3.5 bg-zinc-200 dark:bg-zinc-700 mx-0.5" />

      {/* Apply Changes */}
      <button
        onClick={onModify}
        disabled={!canModify || isModifying}
        title="Apply Changes"
        aria-label="Apply Changes"
        className={`w-7 h-7 rounded-full flex items-center justify-center transition-all ${isModifying ? 'animate-spin text-zinc-600 dark:text-zinc-400' : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 hover:text-zinc-800 dark:hover:text-zinc-200'} disabled:opacity-40 disabled:pointer-events-none`}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="-rotate-90"
        >
          <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
          <path d="M21 3v5h-5" />
        </svg>
      </button>
    </div>
  );
};

export default AnnotationToolbar;
