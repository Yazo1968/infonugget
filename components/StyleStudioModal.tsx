import React, { useState, useRef, useEffect, useMemo, useCallback, type ChangeEvent } from 'react';
import { createPortal } from 'react-dom';
import { CustomStyle, Palette, FontPair } from '../types';
import { BUILTIN_STYLE_NAMES, generateStyleWithAI } from '../utils/ai';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { useStyleContext } from '../context/StyleContext';
import { useAbortController } from '../hooks/useAbortController';

interface StyleStudioModalProps {
  onClose: () => void;
}

const DEFAULT_PALETTE: Palette = {
  background: '#FFFFFF',
  primary: '#3B82F6',
  secondary: '#6B7280',
  accent: '#F59E0B',
  text: '#1F2937',
};

const DEFAULT_FONTS: FontPair = {
  primary: 'Inter',
  secondary: 'Open Sans',
};

const PALETTE_KEYS: (keyof Palette)[] = ['background', 'primary', 'secondary', 'accent', 'text'];

function generateId(): string {
  return `cs_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function getUniqueNewName(styles: CustomStyle[]): string {
  const base = 'New Style';
  const existing = new Set(styles.map((s) => s.name.toLowerCase()));
  if (!existing.has(base.toLowerCase())) return base;
  let i = 2;
  while (existing.has(`${base} ${i}`.toLowerCase())) i++;
  return `${base} ${i}`;
}

function getUniqueName(desired: string, styles: CustomStyle[]): string {
  const existing = new Set(styles.map((s) => s.name.toLowerCase()));
  if (!existing.has(desired.toLowerCase()) && !BUILTIN_STYLE_NAMES.has(desired)) return desired;
  let i = 2;
  while (existing.has(`${desired} ${i}`.toLowerCase()) || BUILTIN_STYLE_NAMES.has(`${desired} ${i}`)) i++;
  return `${desired} ${i}`;
}

/** Deep-compare two style arrays to detect any difference */
function stylesEqual(a: CustomStyle[], b: CustomStyle[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const sa = a[i],
      sb = b[i];
    if (sa.id !== sb.id || sa.name !== sb.name || sa.identity !== sb.identity) return false;
    if (sa.technique !== sb.technique || sa.composition !== sb.composition || sa.mood !== sb.mood) return false;
    if (sa.fonts.primary !== sb.fonts.primary || sa.fonts.secondary !== sb.fonts.secondary) return false;
    for (const k of PALETTE_KEYS) {
      if (sa.palette[k] !== sb.palette[k]) return false;
    }
  }
  return true;
}

const StyleStudioModal: React.FC<StyleStudioModalProps> = ({ onClose }) => {
  const { customStyles, replaceCustomStyles } = useStyleContext();
  const focusTrapRef = useFocusTrap<HTMLDivElement>({ onEscape: onClose });
  // ── Local draft of the entire styles array ──
  const [draft, setDraft] = useState<CustomStyle[]>(() =>
    customStyles.map((s) => ({ ...s, palette: { ...s.palette }, fonts: { ...s.fonts } })),
  );

  const [selectedId, setSelectedId] = useState<string | null>(draft.length > 0 ? draft[0].id : null);

  // Editor form state (for the selected style)
  const [editName, setEditName] = useState('');
  const [editPalette, setEditPalette] = useState<Palette>({ ...DEFAULT_PALETTE });
  const [editFonts, setEditFonts] = useState<FontPair>({ ...DEFAULT_FONTS });
  const [editTechnique, setEditTechnique] = useState('');
  const [editComposition, setEditComposition] = useState('');
  const [editMood, setEditMood] = useState('');
  const [kebabMenuId, setKebabMenuId] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Inline name editing state
  const [editingNameId, setEditingNameId] = useState<string | null>(null);
  const [editingNameValue, setEditingNameValue] = useState('');
  const [nameError, setNameError] = useState('');
  const nameEditRef = useRef<HTMLInputElement>(null);

  // Textarea auto-resize refs
  const techniqueRef = useRef<HTMLTextAreaElement>(null);
  const compositionRef = useRef<HTMLTextAreaElement>(null);
  const moodRef = useRef<HTMLTextAreaElement>(null);

  const autoResize = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  // New-style dropdown menu
  const [showNewMenu, setShowNewMenu] = useState(false);
  const newMenuRef = useRef<HTMLDivElement>(null);

  // Close confirmation dialog
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);

  // AI generation dialog state
  const [showAIDialog, setShowAIDialog] = useState(false);
  const [aiName, setAiName] = useState('');
  const [aiDescription, setAiDescription] = useState('');
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiError, setAiError] = useState('');
  const { create: createAbort, abort: abortAI, isAbortError } = useAbortController();
  const aiNameInputRef = useRef<HTMLInputElement>(null);

  // ── Selected style from draft ──
  const selectedStyle = useMemo(() => draft.find((s) => s.id === selectedId) ?? null, [draft, selectedId]);

  // ── Flush editor fields into draft whenever they change ──
  // This keeps draft always up-to-date with the editor
  const flushEditorToDraft = useCallback(() => {
    if (!selectedId) return;
    setDraft((prev) =>
      prev.map((s) =>
        s.id === selectedId
          ? {
              ...s,
              name: editName.trim() || s.name,
              palette: { ...editPalette },
              fonts: { ...editFonts },
              identity: [editTechnique, editComposition, editMood].filter((s) => s.trim()).join(' '),
              technique: editTechnique.trim(),
              composition: editComposition.trim(),
              mood: editMood.trim(),
              lastModifiedAt: Date.now(),
            }
          : s,
      ),
    );
  }, [selectedId, editName, editPalette, editFonts, editTechnique, editComposition, editMood]);

  // Load selected style into editor fields
  useEffect(() => {
    if (selectedStyle) {
      setEditName(selectedStyle.name);
      setEditPalette({ ...selectedStyle.palette });
      setEditFonts({ ...selectedStyle.fonts });
      setEditTechnique(selectedStyle.technique || '');
      setEditComposition(selectedStyle.composition || '');
      setEditMood(selectedStyle.mood || '');
      setShowDeleteConfirm(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- selectedStyle is derived from selectedId; including it would reset edits on every keystroke
  }, [selectedId]);

  // Auto-resize textareas when content changes (selection switch or edits)
  useEffect(() => {
    requestAnimationFrame(() => {
      autoResize(techniqueRef.current);
      autoResize(compositionRef.current);
      autoResize(moodRef.current);
    });
  }, [selectedId, editTechnique, editComposition, editMood]);

  // ── Global change detection: compare draft vs original ──
  const hasChanges = useMemo(() => {
    // Build a version of draft with current editor fields merged in
    const merged = draft.map((s) => {
      if (s.id !== selectedId) return s;
      return {
        ...s,
        name: editName.trim() || s.name,
        palette: { ...editPalette },
        fonts: { ...editFonts },
        identity: [editTechnique, editComposition, editMood].filter((s) => s.trim()).join(' '),
        technique: editTechnique.trim(),
        composition: editComposition.trim(),
        mood: editMood.trim(),
      };
    });
    return !stylesEqual(merged, customStyles);
  }, [draft, customStyles, selectedId, editName, editPalette, editFonts, editTechnique, editComposition, editMood]);

  // Focus inline name input when editing begins
  useEffect(() => {
    if (editingNameId) {
      setTimeout(() => nameEditRef.current?.focus(), 30);
    }
  }, [editingNameId]);

  // Close kebab menu on click outside
  const kebabAreaRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!kebabMenuId) return;
    const handler = (e: MouseEvent) => {
      if (kebabAreaRef.current && !kebabAreaRef.current.contains(e.target as Node)) {
        setKebabMenuId(null);
        setShowDeleteConfirm(false);
      }
    };
    document.addEventListener('mousedown', handler, true);
    return () => document.removeEventListener('mousedown', handler, true);
  }, [kebabMenuId]);

  // Close new-style menu on click outside
  useEffect(() => {
    if (!showNewMenu) return;
    const handler = (e: MouseEvent) => {
      if (newMenuRef.current && !newMenuRef.current.contains(e.target as Node)) {
        setShowNewMenu(false);
      }
    };
    document.addEventListener('mousedown', handler, true);
    return () => document.removeEventListener('mousedown', handler, true);
  }, [showNewMenu]);

  // Focus AI name input when dialog opens
  useEffect(() => {
    if (showAIDialog) {
      setTimeout(() => aiNameInputRef.current?.focus(), 50);
    }
  }, [showAIDialog]);

  // Cleanup abort controller on unmount
  useEffect(() => {
    return () => {
      abortAI();
    };
  }, [abortAI]);

  // ── Flush editor before switching selection ──
  const selectStyle = (id: string) => {
    if (id === selectedId) return;
    flushEditorToDraft();
    setSelectedId(id);
    setKebabMenuId(null);
    setShowDeleteConfirm(false);
  };

  // ── Actions ──

  const handleNew = () => {
    setShowNewMenu(false);
    flushEditorToDraft();
    const now = Date.now();
    const newStyle: CustomStyle = {
      id: generateId(),
      name: getUniqueNewName(draft),
      palette: { ...DEFAULT_PALETTE },
      fonts: { ...DEFAULT_FONTS },
      identity: '',
      technique: '',
      composition: '',
      mood: '',
      createdAt: now,
      lastModifiedAt: now,
    };
    setDraft((prev) => [...prev, newStyle]);
    setSelectedId(newStyle.id);
    setEditingNameId(newStyle.id);
    setEditingNameValue(newStyle.name);
    setNameError('');
  };

  const openAIDialog = () => {
    setShowNewMenu(false);
    setShowAIDialog(true);
    setAiName('');
    setAiDescription('');
    setAiError('');
  };

  const handleAIGenerate = useCallback(async () => {
    const trimmedName = aiName.trim();
    if (!trimmedName) return;

    setAiGenerating(true);
    setAiError('');
    const controller = createAbort();

    try {
      const result = await generateStyleWithAI(trimmedName, aiDescription, controller.signal);
      const now = Date.now();
      const newStyle: CustomStyle = {
        id: generateId(),
        name: getUniqueName(trimmedName, draft),
        palette: result.palette,
        fonts: result.fonts,
        identity: result.identity,
        technique: result.technique || '',
        composition: result.composition || '',
        mood: result.mood || '',
        createdAt: now,
        lastModifiedAt: now,
      };
      flushEditorToDraft();
      setDraft((prev) => [...prev, newStyle]);
      setSelectedId(newStyle.id);
      setShowAIDialog(false);
    } catch (err: unknown) {
      if (isAbortError(err)) return;
      setAiError(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setAiGenerating(false);
    }
  }, [aiName, aiDescription, draft, flushEditorToDraft]);

  const handleCancelAI = () => {
    abortAI();
    setShowAIDialog(false);
    setAiName('');
    setAiDescription('');
    setAiError('');
    setAiGenerating(false);
  };

  const validateName = (name: string, forId: string): string => {
    const trimmed = name.trim();
    if (!trimmed) return 'Name cannot be empty';
    if (BUILTIN_STYLE_NAMES.has(trimmed)) return 'This name is reserved for a built-in style';
    const conflict = draft.find((s) => s.name.toLowerCase() === trimmed.toLowerCase() && s.id !== forId);
    if (conflict) return 'A custom style with this name already exists';
    return '';
  };

  const commitNameEdit = () => {
    if (!editingNameId) return;
    const error = validateName(editingNameValue, editingNameId);
    if (error) {
      setNameError(error);
      return;
    }
    if (editingNameId === selectedId) {
      setEditName(editingNameValue.trim());
    } else {
      // Editing a non-selected style name — update draft directly
      setDraft((prev) =>
        prev.map((s) =>
          s.id === editingNameId ? { ...s, name: editingNameValue.trim(), lastModifiedAt: Date.now() } : s,
        ),
      );
    }
    setEditingNameId(null);
    setEditingNameValue('');
    setNameError('');
  };

  const cancelNameEdit = () => {
    setEditingNameId(null);
    setEditingNameValue('');
    setNameError('');
  };

  const startNameEdit = (style: CustomStyle) => {
    setEditingNameId(style.id);
    setEditingNameValue(style.id === selectedId ? editName : style.name);
    setNameError('');
  };

  const handleDelete = () => {
    if (!selectedId) return;
    const remaining = draft.filter((s) => s.id !== selectedId);
    setDraft(remaining);
    setShowDeleteConfirm(false);
    setKebabMenuId(null);
    setSelectedId(remaining.length > 0 ? remaining[0].id : null);
  };

  const handleClose = () => {
    if (hasChanges) {
      setShowCloseConfirm(true);
    } else {
      onClose();
    }
  };

  const handleSaveAndClose = () => {
    // Validate current editor name if a style is selected
    if (selectedId) {
      const error = validateName(editName, selectedId);
      if (error) {
        setNameError(error);
        setShowCloseConfirm(false);
        return;
      }
    }
    // Build final array with editor fields merged in
    const final = draft.map((s) => {
      if (s.id !== selectedId) return s;
      return {
        ...s,
        name: editName.trim(),
        palette: { ...editPalette },
        fonts: { ...editFonts },
        identity: [editTechnique, editComposition, editMood].filter((s) => s.trim()).join(' '),
        technique: editTechnique.trim(),
        composition: editComposition.trim(),
        mood: editMood.trim(),
        lastModifiedAt: Date.now(),
      };
    });
    replaceCustomStyles(final);
    onClose();
  };

  const handleDiscardAndClose = () => {
    onClose();
  };

  const updatePaletteColor = (key: keyof Palette, value: string) => {
    setEditPalette((prev) => ({ ...prev, [key]: value }));
  };

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 dark:bg-black/60 animate-in fade-in duration-300">
      <div
        ref={focusTrapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="style-studio-title"
        className="w-full max-w-2xl bg-white dark:bg-zinc-900 rounded-[40px] shadow-2xl dark:shadow-black/30 border border-zinc-100 dark:border-zinc-700 animate-in zoom-in-95 duration-300 flex flex-col"
        style={{ maxHeight: 'calc(100vh - 80px)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-10 pt-8 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-zinc-800 dark:text-zinc-200"
              >
                <path d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z" />
                <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
                <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
                <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
                <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
              </svg>
            </div>
            <div>
              <h2
                id="style-studio-title"
                className="text-[15px] font-black tracking-tight text-zinc-800 dark:text-zinc-200"
              >
                Style Studio
              </h2>
              <p className="text-[10px] text-zinc-400 dark:text-zinc-400 font-light">
                Create custom visual styles for card generation
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors text-zinc-400 dark:text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 min-h-0 px-10 pb-8 gap-6">
          {/* Left sidebar: style list */}
          <div className="w-44 shrink-0 flex flex-col gap-2">
            {/* + New Style button with dropdown */}
            <div className="relative" ref={newMenuRef}>
              <button
                onClick={() => setShowNewMenu((prev) => !prev)}
                className="text-left px-1.5 py-1 text-[11px] text-accent-blue font-medium border border-transparent hover:border-blue-300 transition-all"
                aria-expanded={showNewMenu}
              >
                + New Style
              </button>
              {showNewMenu && (
                <div className="absolute left-0 top-full mt-1 z-50 rounded-lg py-1 px-1 border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg dark:shadow-black/30 animate-in fade-in slide-in-from-top-2 duration-150 min-w-[160px]">
                  <button
                    onClick={handleNew}
                    className="flex items-center gap-2 w-full text-left px-3 py-1.5 text-[11px] font-medium rounded-lg whitespace-nowrap text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
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
                      <path d="M13 21h8" />
                      <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
                    </svg>
                    Create Manually
                  </button>
                  <button
                    onClick={openAIDialog}
                    className="flex items-center gap-2 w-full text-left px-3 py-1.5 text-[11px] font-medium rounded-lg whitespace-nowrap text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
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
                      <path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z" />
                    </svg>
                    Generate with AI
                  </button>
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto pr-1" style={{ maxHeight: '520px' }}>
              {draft.map((style) => {
                const isSelected = selectedId === style.id;
                const isKebabOpen = kebabMenuId === style.id;
                const isEditingName = editingNameId === style.id;
                return (
                  <div key={style.id} className="relative" ref={isKebabOpen ? kebabAreaRef : undefined}>
                    <div
                      onClick={() => selectStyle(style.id)}
                      className={`group relative flex items-center gap-1.5 px-1.5 py-1 cursor-pointer select-none transition-all duration-150 ${
                        isSelected ? 'sidebar-node-active' : 'border border-transparent hover:border-blue-300'
                      }`}
                    >
                      {/* Mini palette preview */}
                      <div className="flex gap-0.5 shrink-0">
                        {PALETTE_KEYS.slice(0, 3).map((k) => (
                          <div
                            key={k}
                            className="w-2.5 h-2.5 rounded-full ring-[1.5px] ring-black/20 dark:ring-white/40"
                            style={{ backgroundColor: isSelected ? editPalette[k] : style.palette[k] }}
                          />
                        ))}
                      </div>
                      {/* Inline name: editable or static */}
                      {isEditingName ? (
                        <input
                          ref={nameEditRef}
                          type="text"
                          value={editingNameValue}
                          onChange={(e) => {
                            setEditingNameValue(e.target.value);
                            setNameError('');
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              commitNameEdit();
                            }
                            if (e.key === 'Escape') {
                              e.preventDefault();
                              cancelNameEdit();
                            }
                          }}
                          onBlur={commitNameEdit}
                          onClick={(e) => e.stopPropagation()}
                          className={`flex-1 min-w-0 text-[11px] text-zinc-700 dark:text-zinc-300 bg-transparent border-b ${nameError ? 'border-red-400' : 'border-zinc-400'} outline-none px-0 py-0`}
                          spellCheck={false}
                          aria-invalid={!!nameError || undefined}
                          aria-describedby={nameError ? 'style-name-error' : undefined}
                        />
                      ) : (
                        <span
                          className="text-[11px] text-zinc-700 dark:text-zinc-300 truncate flex-1 min-w-0"
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            startNameEdit(style);
                          }}
                        >
                          {isSelected ? editName : style.name}
                        </span>
                      )}
                      {/* Kebab */}
                      {!isEditingName && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setKebabMenuId(isKebabOpen ? null : style.id);
                            setShowDeleteConfirm(false);
                          }}
                          className={`shrink-0 w-5 h-5 flex items-center justify-center rounded transition-opacity text-zinc-400 dark:text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 ${
                            isKebabOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                          }`}
                          aria-expanded={isKebabOpen}
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                            <circle cx="12" cy="5" r="2" />
                            <circle cx="12" cy="12" r="2" />
                            <circle cx="12" cy="19" r="2" />
                          </svg>
                        </button>
                      )}
                    </div>
                    {/* Name validation error tooltip */}
                    {isEditingName && nameError && (
                      <p id="style-name-error" className="text-[9px] text-red-500 font-medium px-1.5 mt-0.5">
                        {nameError}
                      </p>
                    )}
                    {isKebabOpen && (
                      <div className="absolute right-0 top-full mt-1 z-50 rounded-lg py-1 px-1 border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg dark:shadow-black/30 animate-in fade-in slide-in-from-top-2 duration-150 min-w-[120px]">
                        {showDeleteConfirm ? (
                          <div className="px-2 py-1.5 space-y-1.5">
                            <p className="text-[10px] text-zinc-500 dark:text-zinc-400 font-medium">
                              Delete this style?
                            </p>
                            <div className="flex gap-1.5">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDelete();
                                }}
                                className="flex-1 py-1.5 rounded-lg bg-red-500 text-white text-[9px] font-black uppercase tracking-widest hover:bg-red-600 transition-all"
                              >
                                Delete
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setShowDeleteConfirm(false);
                                  setKebabMenuId(null);
                                }}
                                className="flex-1 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800/50 text-zinc-600 dark:text-zinc-400 text-[9px] font-black uppercase tracking-widest hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-all"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setKebabMenuId(null);
                                startNameEdit(style);
                              }}
                              className="flex items-center gap-2 w-full text-left px-3 py-1.5 text-[11px] font-medium rounded-lg whitespace-nowrap text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
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
                                <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                              </svg>
                              Rename
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedId(style.id);
                                setShowDeleteConfirm(true);
                              }}
                              className="flex items-center gap-2 w-full text-left px-3 py-1.5 text-[11px] font-medium rounded-lg whitespace-nowrap text-red-500 hover:bg-red-50 transition-colors"
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
                              Delete
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {draft.length === 0 && (
                <p className="text-[10px] text-zinc-400 dark:text-zinc-400 text-center py-6 font-light">
                  No custom styles yet
                </p>
              )}
            </div>
          </div>

          {/* Right panel: editor */}
          <div className="flex-1 min-w-0 overflow-y-auto" style={{ maxHeight: '520px' }}>
            {selectedId ? (
              <div className="space-y-5">
                {/* Palette */}
                <div className="space-y-1.5">
                  <label
                    id="color-palette-label"
                    className="text-[9px] font-black uppercase tracking-[0.15em] text-zinc-500 dark:text-zinc-400"
                  >
                    Color Palette
                  </label>
                  <div className="grid grid-cols-5 gap-2">
                    {PALETTE_KEYS.map((key) => (
                      <div key={key} className="space-y-1">
                        <div className="flex items-center gap-1.5">
                          <input
                            type="color"
                            value={editPalette[key]}
                            onChange={(e) => updatePaletteColor(key, e.target.value)}
                            className="w-7 h-7 rounded-lg cursor-pointer border-0 p-0 bg-transparent"
                            aria-label={`${key.charAt(0).toUpperCase() + key.slice(1)} color picker`}
                          />
                          <input
                            type="text"
                            value={editPalette[key]}
                            onChange={(e) => {
                              const v = e.target.value;
                              if (/^#[0-9A-Fa-f]{0,6}$/.test(v)) updatePaletteColor(key, v);
                            }}
                            className="w-full text-[10px] font-mono font-medium text-zinc-600 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-800 rounded-lg px-1.5 py-1 border border-zinc-200 dark:border-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-400/50 dark:focus:ring-zinc-500/50 focus:border-zinc-400 uppercase"
                            spellCheck={false}
                            aria-label={`${key.charAt(0).toUpperCase() + key.slice(1)} hex value`}
                          />
                        </div>
                        <p className="text-[8px] text-zinc-400 dark:text-zinc-400 uppercase tracking-wider text-center">
                          {key}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Fonts */}
                <div className="space-y-1.5">
                  <label
                    htmlFor="primary-font"
                    className="text-[9px] font-black uppercase tracking-[0.15em] text-zinc-500 dark:text-zinc-400"
                  >
                    Fonts
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <input
                        id="primary-font"
                        type="text"
                        value={editFonts.primary}
                        onChange={(e) => setEditFonts((prev) => ({ ...prev, primary: e.target.value }))}
                        placeholder="Title font"
                        className="w-full px-3 py-2 rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-xs text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-zinc-400/50 dark:focus:ring-zinc-500/50 focus:border-black transition-colors placeholder:text-zinc-400"
                      />
                      <p className="text-[8px] text-zinc-400 dark:text-zinc-400 uppercase tracking-wider text-center">
                        Title
                      </p>
                    </div>
                    <div className="space-y-1">
                      <input
                        id="secondary-font"
                        type="text"
                        value={editFonts.secondary}
                        onChange={(e) => setEditFonts((prev) => ({ ...prev, secondary: e.target.value }))}
                        placeholder="Body font"
                        aria-label="Secondary font"
                        className="w-full px-3 py-2 rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-xs text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-zinc-400/50 dark:focus:ring-zinc-500/50 focus:border-black transition-colors placeholder:text-zinc-400"
                      />
                      <p className="text-[8px] text-zinc-400 dark:text-zinc-400 uppercase tracking-wider text-center">
                        Body
                      </p>
                    </div>
                  </div>
                </div>

                {/* Technique */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label
                      htmlFor="style-technique"
                      className="text-[9px] font-black uppercase tracking-[0.15em] text-zinc-500 dark:text-zinc-400"
                    >
                      Technique
                    </label>
                    <span className={`text-[9px] font-medium ${editTechnique.length > 135 ? 'text-amber-500' : 'text-zinc-300 dark:text-zinc-500'}`}>
                      {editTechnique.length}/150
                    </span>
                  </div>
                  <textarea
                    ref={techniqueRef}
                    id="style-technique"
                    value={editTechnique}
                    onChange={(e: ChangeEvent<HTMLTextAreaElement>) => { if (e.target.value.length <= 150) { setEditTechnique(e.target.value); autoResize(e.target); } }}
                    placeholder="e.g. Solid color fills, no gradients or shadows. Crisp geometric shapes and simple flat icons."
                    rows={1}
                    maxLength={150}
                    className="w-full px-4 py-2.5 rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-xs text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-zinc-400/50 dark:focus:ring-zinc-500/50 focus:border-black transition-colors placeholder:text-zinc-400 resize-none leading-relaxed overflow-hidden"
                  />
                </div>

                {/* Composition */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label
                      htmlFor="style-composition"
                      className="text-[9px] font-black uppercase tracking-[0.15em] text-zinc-500 dark:text-zinc-400"
                    >
                      Composition
                    </label>
                    <span className={`text-[9px] font-medium ${editComposition.length > 90 ? 'text-amber-500' : 'text-zinc-300 dark:text-zinc-500'}`}>
                      {editComposition.length}/100
                    </span>
                  </div>
                  <textarea
                    ref={compositionRef}
                    id="style-composition"
                    value={editComposition}
                    onChange={(e: ChangeEvent<HTMLTextAreaElement>) => { if (e.target.value.length <= 100) { setEditComposition(e.target.value); autoResize(e.target); } }}
                    placeholder="e.g. Strict grid layout with generous whitespace and clear visual hierarchy."
                    rows={1}
                    maxLength={100}
                    className="w-full px-4 py-2.5 rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-xs text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-zinc-400/50 dark:focus:ring-zinc-500/50 focus:border-black transition-colors placeholder:text-zinc-400 resize-none leading-relaxed overflow-hidden"
                  />
                </div>

                {/* Mood */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label
                      htmlFor="style-mood"
                      className="text-[9px] font-black uppercase tracking-[0.15em] text-zinc-500 dark:text-zinc-400"
                    >
                      Mood
                    </label>
                    <span className={`text-[9px] font-medium ${editMood.length > 50 ? 'text-amber-500' : 'text-zinc-300 dark:text-zinc-500'}`}>
                      {editMood.length}/60
                    </span>
                  </div>
                  <textarea
                    ref={moodRef}
                    id="style-mood"
                    value={editMood}
                    onChange={(e: ChangeEvent<HTMLTextAreaElement>) => { if (e.target.value.length <= 60) { setEditMood(e.target.value); autoResize(e.target); } }}
                    placeholder="e.g. Clean, modern, and approachable."
                    rows={1}
                    maxLength={60}
                    className="w-full px-4 py-2.5 rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-xs text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-zinc-400/50 dark:focus:ring-zinc-500/50 focus:border-black transition-colors placeholder:text-zinc-400 resize-none leading-relaxed overflow-hidden"
                  />
                </div>

                {/* Preview strip */}
                <div className="flex items-center gap-2 px-1">
                  <span className="text-[8px] text-zinc-400 dark:text-zinc-400 uppercase tracking-wider shrink-0">
                    Preview
                  </span>
                  <div className="flex gap-1.5">
                    {PALETTE_KEYS.map((key) => (
                      <div
                        key={key}
                        className="w-8 h-8 rounded-xl ring-[1.5px] ring-black/20 dark:ring-white/40 transition-colors"
                        style={{ backgroundColor: editPalette[key] }}
                        title={`${key}: ${editPalette[key]}`}
                      />
                    ))}
                  </div>
                  <div className="ml-3 text-[10px] text-zinc-500 dark:text-zinc-400">
                    <span style={{ fontFamily: editFonts.primary }}>{editFonts.primary}</span>
                    <span className="text-zinc-300 dark:text-zinc-500 mx-1">/</span>
                    <span style={{ fontFamily: editFonts.secondary }}>{editFonts.secondary}</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center py-16">
                <svg
                  width="40"
                  height="40"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-zinc-200 dark:text-zinc-700 mb-4"
                >
                  <path d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z" />
                  <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
                  <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
                  <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
                  <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
                </svg>
                <p className="text-xs text-zinc-400 dark:text-zinc-400 font-light">
                  Click <strong className="font-bold">+ New Style</strong> to create your first custom style
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* AI Generation Dialog — overlays the Style Studio */}
      {showAIDialog && (
        <div
          className="fixed inset-0 z-[130] flex items-center justify-center bg-black/30 dark:bg-black/50 animate-in fade-in duration-200"
          onClick={(e) => {
            if (e.target === e.currentTarget && !aiGenerating) handleCancelAI();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="ai-style-gen-title"
            className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-[32px] shadow-2xl dark:shadow-black/30 border border-zinc-100 dark:border-zinc-700 animate-in zoom-in-95 duration-200 p-8"
          >
            <div className="flex items-center gap-3 mb-6">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-zinc-800 dark:text-zinc-200 shrink-0"
              >
                <path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83" />
              </svg>
              <h3
                id="ai-style-gen-title"
                className="text-[14px] font-black tracking-tight text-zinc-800 dark:text-zinc-200"
              >
                Generate Style with AI
              </h3>
            </div>

            <div className="space-y-4">
              {/* Name */}
              <div className="space-y-1.5">
                <label
                  htmlFor="ai-style-name"
                  className="text-[9px] font-black uppercase tracking-[0.15em] text-zinc-500 dark:text-zinc-400"
                >
                  Style Name
                </label>
                <input
                  id="ai-style-name"
                  ref={aiNameInputRef}
                  type="text"
                  value={aiName}
                  onChange={(e) => setAiName(e.target.value)}
                  placeholder="e.g. Art Deco"
                  disabled={aiGenerating}
                  className="w-full px-4 py-2.5 rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-xs text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-zinc-400/50 dark:focus:ring-zinc-500/50 focus:border-black transition-colors placeholder:text-zinc-400 disabled:opacity-50"
                  aria-invalid={!!aiError || undefined}
                  aria-describedby={aiError ? 'ai-style-error' : undefined}
                />
              </div>

              {/* Description */}
              <div className="space-y-1.5">
                <label
                  htmlFor="ai-style-description"
                  className="text-[9px] font-black uppercase tracking-[0.15em] text-zinc-500 dark:text-zinc-400"
                >
                  Description
                </label>
                <textarea
                  id="ai-style-description"
                  value={aiDescription}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v.length <= 400) setAiDescription(v);
                  }}
                  placeholder="Describe anything about the style you want — colors, fonts, mood, era, aesthetic... or leave blank and let the AI decide based on the name."
                  rows={4}
                  maxLength={400}
                  disabled={aiGenerating}
                  className="w-full px-4 py-3 rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-xs text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-zinc-400/50 dark:focus:ring-zinc-500/50 focus:border-black transition-colors placeholder:text-zinc-400 resize-none leading-relaxed disabled:opacity-50"
                />
                <div className="flex items-center justify-between">
                  <p className="text-[9px] text-zinc-400 dark:text-zinc-400 font-light">
                    The AI will use whatever you provide and fill in the rest.
                  </p>
                  <p
                    className={`text-[9px] font-medium ${aiDescription.length > 380 ? 'text-amber-500' : 'text-zinc-300 dark:text-zinc-500'}`}
                  >
                    {aiDescription.length}/400
                  </p>
                </div>
              </div>

              {/* Error */}
              {aiError && (
                <p id="ai-style-error" className="text-[10px] text-red-500 font-medium">
                  {aiError}
                </p>
              )}

              {/* Actions */}
              <div className="flex items-center gap-2 pt-2">
                <button
                  onClick={handleAIGenerate}
                  disabled={!aiName.trim() || aiGenerating}
                  className="flex-1 py-3 rounded-full bg-black text-white text-[9px] font-black uppercase tracking-widest hover:bg-zinc-800 transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {aiGenerating ? 'Generating...' : 'Generate'}
                </button>
                <button
                  onClick={handleCancelAI}
                  disabled={aiGenerating}
                  className="py-3 px-6 rounded-full bg-zinc-50 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 text-[9px] font-black uppercase tracking-widest hover:bg-zinc-100 dark:hover:bg-zinc-700 hover:text-zinc-800 dark:hover:text-zinc-200 transition-all active:scale-95 disabled:opacity-40"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Unsaved changes confirmation dialog */}
      {showCloseConfirm && (
        <div
          className="fixed inset-0 z-[130] flex items-center justify-center bg-black/30 dark:bg-black/50 animate-in fade-in duration-200"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowCloseConfirm(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="style-unsaved-title"
            className="w-full max-w-xs bg-white dark:bg-zinc-900 rounded-[24px] shadow-2xl dark:shadow-black/30 border border-zinc-100 dark:border-zinc-700 animate-in zoom-in-95 duration-200 p-6"
          >
            <h3
              id="style-unsaved-title"
              className="text-[13px] font-black tracking-tight text-zinc-800 dark:text-zinc-200 mb-1"
            >
              Unsaved Changes
            </h3>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 font-light mb-5">
              You have unsaved changes to your styles. What would you like to do?
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={handleSaveAndClose}
                className="w-full py-2.5 rounded-full bg-black text-white text-[9px] font-black uppercase tracking-widest hover:bg-zinc-800 transition-all active:scale-95"
              >
                Save
              </button>
              <button
                onClick={handleDiscardAndClose}
                className="w-full py-2.5 rounded-full bg-zinc-100 dark:bg-zinc-800/50 text-zinc-600 dark:text-zinc-400 text-[9px] font-black uppercase tracking-widest hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-all active:scale-95"
              >
                Discard
              </button>
              <button
                onClick={() => setShowCloseConfirm(false)}
                className="w-full py-2.5 rounded-full text-zinc-400 dark:text-zinc-400 text-[9px] font-black uppercase tracking-widest hover:text-zinc-600 dark:hover:text-zinc-300 transition-all active:scale-95"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
};

export default StyleStudioModal;
