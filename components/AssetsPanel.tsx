import React, { useRef, useState, useEffect, useMemo } from 'react';
import { marked } from 'marked';
import { sanitizeHtml } from '../utils/sanitize';
import { Card, StylingOptions, Palette, DetailLevel, ImageVersion, ReferenceImage } from '../types';
import { VISUAL_STYLES, STYLE_FONTS, STYLE_IDENTITY_FIELDS, BUILTIN_STYLE_NAMES } from '../utils/ai';
import AnnotationWorkbench, { type AnnotationToolbarState } from './workbench/AnnotationWorkbench';
import AnnotationToolbar from './workbench/AnnotationToolbar';
import ErrorBoundary from './ErrorBoundary';
import { ReferenceMismatchDialog, ManifestModal } from './Dialogs';
import { useThemeContext } from '../context/ThemeContext';
import { useSelectionContext } from '../context/SelectionContext';
import { useNuggetContext } from '../context/NuggetContext';
import PanelRequirements from './PanelRequirements';
import ChiselLoader from './ChiselLoader';

interface AssetsPanelProps {
  committedSettings: StylingOptions;
  menuDraftOptions: StylingOptions;
  setMenuDraftOptions: React.Dispatch<React.SetStateAction<StylingOptions>>;
  activeLogicTab: DetailLevel;
  setActiveLogicTab: (level: DetailLevel) => void;
  genStatus: string;
  onGenerateCard: (card: Card) => void;
  onGenerateAll: () => void;
  selectedCount: number;
  onZoomImage: (url: string) => void;
  onImageModified?: (cardId: string, newImageUrl: string, history: ImageVersion[]) => void;
  contentDirty?: boolean;
  currentContent?: string;
  referenceImage?: ReferenceImage | null;
  onStampReference?: () => void;
  useReferenceImage?: boolean;
  onToggleUseReference?: () => void;
  onReferenceImageModified?: (newImageUrl: string) => void;
  onDeleteReference?: () => void;
  mismatchDialog?: { resolve: (decision: 'disable' | 'skip' | 'cancel') => void } | null;
  onDismissMismatch?: () => void;
  manifestCards?: Card[] | null;
  onExecuteBatch?: () => void;
  onCloseManifest?: () => void;
  onSetActiveImage?: (imageId: string) => void;
  onDeleteAlbumImage?: (imageId: string) => void;
  albumActionPending?: string | null;
  onUsage?: (entry: { provider: 'gemini'; model: string; inputTokens: number; outputTokens: number }) => void;
  onOpenStyleStudio?: () => void;
}

const AssetsPanel: React.FC<AssetsPanelProps> = ({
  committedSettings,
  menuDraftOptions,
  setMenuDraftOptions,
  activeLogicTab,
  setActiveLogicTab: _setActiveLogicTab,
  genStatus: _genStatus,
  onGenerateCard,
  onGenerateAll,
  selectedCount,
  onZoomImage,
  onImageModified,
  contentDirty,
  currentContent,
  referenceImage,
  onStampReference,
  useReferenceImage,
  onToggleUseReference,
  onReferenceImageModified,
  onDeleteReference,
  mismatchDialog,
  onDismissMismatch,
  manifestCards,
  onExecuteBatch,
  onCloseManifest,
  onSetActiveImage,
  onDeleteAlbumImage,
  albumActionPending,
  onUsage,
  onOpenStyleStudio,
}) => {
  const { darkMode } = useThemeContext();
  const { activeCard } = useSelectionContext();
  const { selectedNugget } = useNuggetContext();
  // Use the card's own detail level — the toolbar LOD selector was removed
  const cardLevel: DetailLevel = activeCard?.detailLevel || activeLogicTab;
  const _colorRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [showPrompt, setShowPrompt] = useState(false);
  const [showReference, setShowReference] = useState(false);
  const [openMenu, setOpenMenu] = useState<
    | 'style'
    | 'ratio'
    | 'resolution'
    | 'reference'
    | 'generate'
    | 'palette-background'
    | 'palette-primary'
    | 'palette-secondary'
    | 'palette-accent'
    | 'palette-text'
    | null
  >(null);
  const [menuMode, setMenuMode] = useState<'hover' | 'locked'>('hover');
  const [toolbarState, setToolbarState] = useState<AnnotationToolbarState | null>(null);
  const [cardLabMode, setCardLabMode] = useState<'generate' | 'inpaint'>('generate');
  const [showUserDefinedSub, setShowUserDefinedSub] = useState(false);
  const [userDefinedLocked, setUserDefinedLocked] = useState(false);
  const [confirmDeleteImageId, setConfirmDeleteImageId] = useState<string | null>(null);

  // Reset sub-menu when style menu closes
  useEffect(() => {
    if (openMenu !== 'style') {
      setShowUserDefinedSub(false);
      setUserDefinedLocked(false);
    }
  }, [openMenu]);

  const handleDownloadReference = () => {
    if (!referenceImage) return;
    const link = document.createElement('a');
    link.href = referenceImage.url;
    link.download = `reference-${referenceImage.settings.style}-${referenceImage.settings.aspectRatio}.png`;
    link.click();
  };

  const handleStyleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newStyle = e.target.value;
    const fields = STYLE_IDENTITY_FIELDS[newStyle];
    setMenuDraftOptions((prev) => ({
      ...prev,
      style: newStyle,
      palette: VISUAL_STYLES[newStyle] || prev.palette,
      fonts: STYLE_FONTS[newStyle] || prev.fonts,
      technique: fields?.technique || '',
      composition: fields?.composition || '',
      mood: fields?.mood || '',
    }));
  };

  const updatePalette = (key: keyof Palette, value: string) => {
    setMenuDraftOptions((prev) => ({
      ...prev,
      palette: { ...prev.palette, [key]: value },
    }));
  };

  const hasImage = !!activeCard?.activeImageMap?.[cardLevel];

  // Clear toolbar state and revert to generate mode when no image
  useEffect(() => {
    if (!hasImage) {
      setToolbarState(null);
      setCardLabMode('generate');
    }
  }, [hasImage]);
  const isGenerating = !!activeCard?.isGeneratingMap?.[cardLevel];
  const album = activeCard?.albumMap?.[cardLevel] || [];
  const showAlbumStrip = album.length >= 1 && !showReference && !showPrompt && !isGenerating;

  // Show the actual prompt sent to Gemini — only available after image generation
  const effectivePrompt = useMemo(() => {
    if (!activeCard) return null;
    return activeCard.lastPromptMap?.[cardLevel] || null;
  }, [activeCard, cardLevel]);

  const paletteKeys: Array<keyof Palette> = ['background', 'primary', 'secondary', 'accent', 'text'];

  const imageContainerRef = useRef<HTMLDivElement>(null);

  // ── Rotating fun status messages ──
  const funMessages = [
    'Drilling into the data veins...',
    'Panning for nuggets of insight...',
    'Excavating key findings...',
    'Mapping the geological layers...',
    'Sifting through the bedrock...',
    'Polishing the raw ore...',
    'Striking a rich vein of content...',
    'Tunneling deeper into the source...',
    'Assaying the mineral deposits...',
    'Reinforcing the mine shaft...',
    'Loading the ore cart...',
    'Prospecting for visual clarity...',
    'Smelting ideas into form...',
    'Chiseling the rough edges...',
    'Surveying the terrain...',
    'Hauling nuggets to the surface...',
    'Checking the canary...',
    'Almost hit the motherlode...',
    'Forging the final nugget...',
    'Blasting through the last layer...',
  ];

  const styleToolbarRef = useRef<HTMLDivElement>(null);

  // Close menu on click outside (only when locked)
  useEffect(() => {
    if (!openMenu || menuMode !== 'locked') return;
    const handler = (e: MouseEvent) => {
      if (styleToolbarRef.current && !styleToolbarRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [openMenu, menuMode]);

  // Helpers for hover/locked menu pattern
  const toggleMenuLocked = (key: typeof openMenu) => {
    if (openMenu === key && menuMode === 'locked') {
      setOpenMenu(null);
    } else {
      setMenuMode('locked');
      setOpenMenu(key);
    }
  };
  const hoverMenuEnter = (key: typeof openMenu) => {
    if (openMenu && menuMode === 'locked') return;
    setMenuMode('hover');
    setOpenMenu(key);
  };
  const hoverMenuLeave = () => {
    if (menuMode === 'locked') return;
    setOpenMenu(null);
  };

  const [funMsgIndex, setFunMsgIndex] = useState(0);
  const [funMsgFade, setFunMsgFade] = useState(true);

  useEffect(() => {
    if (!isGenerating) {
      setFunMsgIndex(0);
      setFunMsgFade(true);
      return;
    }
    const interval = setInterval(() => {
      setFunMsgFade(false); // fade out
      setTimeout(() => {
        setFunMsgIndex((prev) => (prev + 1) % funMessages.length);
        setFunMsgFade(true); // fade in
      }, 300);
    }, 2800);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- funMessages is a constant array; its .length never changes
  }, [isGenerating]);

  return (
    <section
      className="flex-1 min-w-0 flex flex-col relative z-[103] overflow-hidden group border border-zinc-200 dark:border-zinc-700 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_4px_12px_rgba(0,0,0,0.04)]"
      style={{ background: darkMode ? '#18181b' : '#ffffff' }}
    >
      {/* Clean canvas — no texture */}

      {/* ─── Design Toolbar ─── */}
      <div className="relative z-30">
        {/* ─── Title row + Mode toggle ─── */}
        <div className="shrink-0 h-[36px] flex items-center gap-2 border-b border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-900">
            <div className="h-full w-[36px] shrink-0 flex items-center justify-center" style={{ backgroundColor: darkMode ? 'rgb(30,60,100)' : 'rgb(200,225,250)' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-zinc-500 dark:text-zinc-400">
              <rect width="16" height="16" x="3" y="3" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="m21 15-5-5L5 21" />
            </svg>
            </div>
          <span className="text-[13px] font-bold uppercase tracking-wider text-zinc-800 dark:text-zinc-200">
            Card Image
          </span>
          <div className="flex items-center gap-2 ml-auto pr-3">
            <span className="text-[11px] font-medium text-[#2a9fd4]">Mode</span>
            <select
              value={cardLabMode}
              onChange={(e) => {
                const val = e.target.value as 'generate' | 'inpaint';
                if (val === 'inpaint' && !hasImage) return;
                setCardLabMode(val);
              }}
              className="text-[11px] font-medium px-2 py-0.5 rounded-md border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 cursor-pointer outline-none"
            >
              <option value="generate">Generate</option>
              <option value="inpaint" disabled={!hasImage}>Edit</option>
            </select>
          </div>
        </div>
        {/* ─── Toolbar row ─── */}
        {cardLabMode === 'generate' ? (
          <div
            ref={styleToolbarRef}
            className="px-5 h-[40px] flex items-center justify-center gap-2 border-b border-zinc-200 dark:border-zinc-700"
          >
            {/* Style controls toolbar */}
            <div className="flex items-center gap-1 px-1.5 h-9">
              {/* Style Studio button */}
              <button
                onClick={() => onOpenStyleStudio?.()}
                title="Style Studio"
                aria-label="Style Studio"
                className="w-7 h-7 rounded-full flex items-center justify-center transition-all duration-200 active:scale-95 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 hover:text-zinc-800 dark:hover:text-zinc-200"
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z" />
                  <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
                  <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
                  <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
                  <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
                </svg>
              </button>

              <div className="w-px h-3.5 bg-zinc-200 dark:bg-zinc-700 mx-0.5" />

              {/* Style selector */}
              <div className="relative" onMouseEnter={() => hoverMenuEnter('style')} onMouseLeave={hoverMenuLeave}>
                <button
                  onClick={() => toggleMenuLocked('style')}
                  title={`Style: ${menuDraftOptions.style}`}
                  className={`h-7 px-2 rounded-full flex items-center justify-center text-[11px] font-medium uppercase transition-all duration-200 active:scale-95 whitespace-nowrap ${openMenu === 'style' ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200' : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 hover:text-zinc-800 dark:hover:text-zinc-200'}`}
                >
                  {menuDraftOptions.style}
                </button>
                {openMenu === 'style' && (
                  <div className="absolute left-1/2 -translate-x-1/2 top-full pt-2 z-50">
                    <div className="rounded-lg shadow-lg py-2 px-1 border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 animate-in fade-in slide-in-from-top-2 duration-150">
                      {(() => {
                        const allNames = Object.keys(VISUAL_STYLES);
                        const builtIn = allNames.filter((n) => BUILTIN_STYLE_NAMES.has(n));
                        const custom = allNames.filter((n) => !BUILTIN_STYLE_NAMES.has(n));
                        return (
                          <>
                            {/* User Defined parent item with sub-menu — always first */}
                            <div
                              className="relative"
                              onMouseEnter={() => setShowUserDefinedSub(true)}
                              onMouseLeave={() => {
                                if (!userDefinedLocked) setShowUserDefinedSub(false);
                              }}
                            >
                              <button
                                onClick={() => {
                                  setUserDefinedLocked((prev) => !prev);
                                  setShowUserDefinedSub(true);
                                }}
                                className={`block w-full text-left px-3 py-1.5 text-[11px] font-medium uppercase rounded-lg whitespace-nowrap transition-colors flex items-center justify-between gap-3 ${custom.some((n) => menuDraftOptions.style === n) ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200' : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 hover:text-zinc-800 dark:hover:text-zinc-200'}`}
                              >
                                User Defined
                                <svg
                                  width="8"
                                  height="8"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2.5"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                >
                                  <polyline points="9 18 15 12 9 6" />
                                </svg>
                              </button>
                              {showUserDefinedSub && (
                                <div className="absolute left-full top-0 pl-1 z-50">
                                  <div className="rounded-lg shadow-lg py-2 px-1 border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 max-h-[280px] overflow-y-auto animate-in fade-in duration-100">
                                    {custom.map((styleName) => (
                                      <button
                                        key={styleName}
                                        onClick={() => {
                                          handleStyleChange({
                                            target: { value: styleName },
                                          } as React.ChangeEvent<HTMLSelectElement>);
                                          setOpenMenu(null);
                                          setShowUserDefinedSub(false);
                                          setUserDefinedLocked(false);
                                        }}
                                        className={`block w-full text-left px-3 py-1.5 text-[11px] font-medium uppercase rounded-lg whitespace-nowrap transition-colors ${menuDraftOptions.style === styleName ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200' : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 hover:text-zinc-800 dark:hover:text-zinc-200'}`}
                                      >
                                        {styleName}
                                      </button>
                                    ))}
                                    {custom.length > 0 && (
                                      <div className="my-1 mx-2 border-t border-zinc-200 dark:border-zinc-700" />
                                    )}
                                    <button
                                      onClick={() => {
                                        onOpenStyleStudio?.();
                                        setOpenMenu(null);
                                        setShowUserDefinedSub(false);
                                        setUserDefinedLocked(false);
                                      }}
                                      className="block w-full text-left px-3 py-1.5 text-[11px] font-medium uppercase rounded-lg whitespace-nowrap transition-colors text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 hover:text-zinc-800 dark:hover:text-zinc-200 flex items-center gap-1.5"
                                    >
                                      <svg
                                        width="10"
                                        height="10"
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
                                      Create New Style
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                            <div className="my-1 mx-2 border-t border-zinc-200 dark:border-zinc-700" />
                            <div className="max-h-[240px] overflow-y-auto">
                              {builtIn.map((styleName) => (
                                <button
                                  key={styleName}
                                  onClick={() => {
                                    handleStyleChange({
                                      target: { value: styleName },
                                    } as React.ChangeEvent<HTMLSelectElement>);
                                    setOpenMenu(null);
                                  }}
                                  className={`block w-full text-left px-3 py-1.5 text-[11px] font-medium uppercase rounded-lg whitespace-nowrap transition-colors ${menuDraftOptions.style === styleName ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200' : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 hover:text-zinc-800 dark:hover:text-zinc-200'}`}
                                >
                                  {styleName}
                                </button>
                              ))}
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  </div>
                )}
              </div>

              <span className="text-zinc-500 dark:text-zinc-400 text-[11px]">|</span>

              {/* Aspect ratio selector */}
              <div className="relative" onMouseEnter={() => hoverMenuEnter('ratio')} onMouseLeave={hoverMenuLeave}>
                <button
                  onClick={() => toggleMenuLocked('ratio')}
                  title={`Ratio: ${menuDraftOptions.aspectRatio}`}
                  className={`h-7 px-2 rounded-full flex items-center justify-center text-[11px] font-medium uppercase transition-all duration-200 active:scale-95 whitespace-nowrap ${openMenu === 'ratio' ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200' : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 hover:text-zinc-800 dark:hover:text-zinc-200'}`}
                >
                  {menuDraftOptions.aspectRatio}
                </button>
                {openMenu === 'ratio' && (
                  <div className="absolute left-1/2 -translate-x-1/2 top-full pt-2 z-50">
                    <div className="rounded-lg shadow-lg py-2 px-1 border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 animate-in fade-in slide-in-from-top-2 duration-150">
                      {(['16:9', '4:3', '1:1', '9:16', '3:2', '2:3', '3:4', '4:5', '5:4', '21:9'] as const).map(
                        (ratio) => (
                          <button
                            key={ratio}
                            onClick={() => {
                              setMenuDraftOptions((prev) => ({ ...prev, aspectRatio: ratio }));
                              setOpenMenu(null);
                            }}
                            className={`block w-full text-left px-3 py-1.5 text-[11px] font-medium uppercase rounded-lg whitespace-nowrap transition-colors ${menuDraftOptions.aspectRatio === ratio ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200' : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 hover:text-zinc-800 dark:hover:text-zinc-200'}`}
                          >
                            {ratio}
                          </button>
                        ),
                      )}
                    </div>
                  </div>
                )}
              </div>

              <span className="text-zinc-500 dark:text-zinc-400 text-[11px]">|</span>

              {/* Resolution selector */}
              <div className="relative" onMouseEnter={() => hoverMenuEnter('resolution')} onMouseLeave={hoverMenuLeave}>
                <button
                  onClick={() => toggleMenuLocked('resolution')}
                  title={`Resolution: ${menuDraftOptions.resolution}`}
                  className={`h-7 px-2 rounded-full flex items-center justify-center text-[11px] font-medium uppercase transition-all duration-200 active:scale-95 whitespace-nowrap ${openMenu === 'resolution' ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200' : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 hover:text-zinc-800 dark:hover:text-zinc-200'}`}
                >
                  {menuDraftOptions.resolution}
                </button>
                {openMenu === 'resolution' && (
                  <div className="absolute left-1/2 -translate-x-1/2 top-full pt-2 z-50">
                    <div className="rounded-lg shadow-lg py-2 px-1 border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 animate-in fade-in slide-in-from-top-2 duration-150">
                      {(['1K', '2K', '4K'] as const).map((res) => (
                        <button
                          key={res}
                          onClick={() => {
                            setMenuDraftOptions((prev) => ({
                              ...prev,
                              resolution: res as StylingOptions['resolution'],
                            }));
                            setOpenMenu(null);
                          }}
                          className={`block w-full text-left px-3 py-1.5 text-[11px] font-medium uppercase rounded-lg whitespace-nowrap transition-colors ${menuDraftOptions.resolution === res ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200' : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 hover:text-zinc-800 dark:hover:text-zinc-200'}`}
                        >
                          {res}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="w-px h-3.5 bg-zinc-200 dark:bg-zinc-700 mx-0.5" />

              {/* Reference image menu */}
              <div className="relative" onMouseEnter={() => hoverMenuEnter('reference')} onMouseLeave={hoverMenuLeave}>
                <button
                  onClick={() => toggleMenuLocked('reference')}
                  title="Reference image"
                  aria-label="Reference image"
                  className={`w-7 h-7 rounded-full flex items-center justify-center transition-all duration-200 active:scale-95 ${openMenu === 'reference' ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200' : referenceImage && useReferenceImage ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200' : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 hover:text-zinc-800 dark:hover:text-zinc-200'}`}
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
                    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                </button>
                {openMenu === 'reference' && (
                  <div className="absolute left-1/2 -translate-x-1/2 top-full pt-2 z-50">
                    <div className="rounded-lg shadow-lg py-2 px-1 border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 animate-in fade-in slide-in-from-top-2 duration-150 min-w-[170px]">
                      {referenceImage && (
                        <>
                          {/* Use Reference toggle */}
                          <button
                            onClick={() => {
                              onToggleUseReference?.();
                            }}
                            className="flex items-center justify-between w-full px-3 py-1.5 rounded-lg transition-colors text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 hover:text-zinc-800 dark:hover:text-zinc-200"
                          >
                            <span className="text-[11px] font-medium uppercase">Use Ref.</span>
                            <div
                              className={`relative w-6 h-3.5 rounded-full transition-colors duration-200 ${useReferenceImage ? 'bg-zinc-900 dark:bg-zinc-100' : 'bg-zinc-300 dark:bg-zinc-600'}`}
                            >
                              <div
                                className={`absolute top-[2px] w-2.5 h-2.5 rounded-full bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-600 transition-all duration-200 ${useReferenceImage ? 'left-[12px]' : 'left-[2px]'}`}
                              />
                            </div>
                          </button>
                          {/* View Reference toggle */}
                          <button
                            onClick={() => {
                              setShowReference((prev) => !prev);
                            }}
                            className="flex items-center justify-between w-full px-3 py-1.5 rounded-lg transition-colors text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 hover:text-zinc-800 dark:hover:text-zinc-200"
                          >
                            <span className="text-[11px] font-medium uppercase">View Ref.</span>
                            <div
                              className={`relative w-6 h-3.5 rounded-full transition-colors duration-200 ${showReference ? 'bg-zinc-900 dark:bg-zinc-100' : 'bg-zinc-300 dark:bg-zinc-600'}`}
                            >
                              <div
                                className={`absolute top-[2px] w-2.5 h-2.5 rounded-full bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-600 transition-all duration-200 ${showReference ? 'left-[12px]' : 'left-[2px]'}`}
                              />
                            </div>
                          </button>
                          <div className="h-px bg-zinc-200/60 dark:bg-zinc-700/60 mx-2 my-1" />
                        </>
                      )}
                      <button
                        onClick={() => {
                          onStampReference?.();
                          setOpenMenu(null);
                        }}
                        disabled={!hasImage}
                        className={`block w-full text-left px-3 py-1.5 text-[11px] font-medium uppercase rounded-lg whitespace-nowrap transition-colors ${referenceImage && hasImage && activeCard?.activeImageMap?.[cardLevel] === referenceImage.url ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200' : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 hover:text-zinc-800 dark:hover:text-zinc-200'} disabled:opacity-40 disabled:pointer-events-none`}
                      >
                        Set Current as Ref.
                      </button>
                      {referenceImage && (
                        <>
                          <button
                            onClick={() => {
                              handleDownloadReference();
                              setOpenMenu(null);
                            }}
                            className="block w-full text-left px-3 py-1.5 text-[11px] font-medium uppercase rounded-lg whitespace-nowrap text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors"
                          >
                            Download Ref.
                          </button>
                          <button
                            onClick={() => {
                              onDeleteReference?.();
                              setShowReference(false);
                              setOpenMenu(null);
                            }}
                            className="block w-full text-left px-3 py-1.5 text-[11px] font-medium uppercase rounded-lg whitespace-nowrap text-red-500 hover:bg-red-50 transition-colors"
                          >
                            Delete Ref.
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="w-px h-3.5 bg-zinc-200 dark:bg-zinc-700 mx-0.5" />

              {/* Palette dots */}
              {paletteKeys.map((key) => {
                const menuKey = `palette-${key}` as typeof openMenu;
                return (
                  <div
                    key={key}
                    className="relative flex items-center justify-center"
                    onMouseEnter={() => hoverMenuEnter(menuKey)}
                    onMouseLeave={hoverMenuLeave}
                  >
                    <button
                      onClick={() => toggleMenuLocked(menuKey)}
                      className={`w-[18px] h-[18px] rounded-full transition-all duration-200 cursor-pointer ring-[1.5px] hover:scale-125 hover:shadow-lg dark:hover:shadow-black/30 active:scale-95 ${openMenu === menuKey ? 'ring-black/50 dark:ring-white/60 scale-125' : 'ring-black/20 dark:ring-white/40 hover:ring-black/30 dark:hover:ring-white/50'}`}
                      style={{ backgroundColor: menuDraftOptions.palette[key] }}
                      title={key.charAt(0).toUpperCase() + key.slice(1)}
                      aria-label={key.charAt(0).toUpperCase() + key.slice(1) + ' palette color'}
                    />
                    {openMenu === menuKey && (
                      <div className="absolute left-1/2 -translate-x-1/2 top-full pt-2 z-50">
                        <div className="rounded-lg shadow-lg py-2 px-2 border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 animate-in fade-in slide-in-from-top-2 duration-150 flex items-center gap-2">
                          <input
                            type="color"
                            value={menuDraftOptions.palette[key]}
                            onChange={(e) => updatePalette(key, e.target.value)}
                            className="w-7 h-7 rounded-lg cursor-pointer border-0 p-0 bg-transparent"
                          />
                          <input
                            type="text"
                            value={menuDraftOptions.palette[key]}
                            onChange={(e) => {
                              const v = e.target.value;
                              if (/^#[0-9A-Fa-f]{0,6}$/.test(v)) updatePalette(key, v);
                            }}
                            className="w-[68px] text-[11px] font-mono font-medium text-zinc-600 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-800 rounded-lg px-2 py-1.5 border border-zinc-200 dark:border-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-400/50 dark:focus:ring-zinc-500/50 focus:border-zinc-400 dark:focus:border-zinc-500 uppercase"
                            spellCheck={false}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              <div className="w-px h-3.5 bg-zinc-200 dark:bg-zinc-700 mx-0.5" />

              {/* Generate menu */}
              <div className="relative" onMouseEnter={() => hoverMenuEnter('generate')} onMouseLeave={hoverMenuLeave}>
                <button
                  onClick={() => toggleMenuLocked('generate')}
                  disabled={isGenerating}
                  title="Generate"
                  aria-label="Generate"
                  className={`w-7 h-7 rounded-full flex items-center justify-center transition-all duration-200 active:scale-95 ${openMenu === 'generate' ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200' : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 hover:text-zinc-800 dark:hover:text-zinc-200'} disabled:opacity-40 disabled:pointer-events-none`}
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
                    <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
                  </svg>
                </button>
                {openMenu === 'generate' && (
                  <div className="absolute left-1/2 -translate-x-1/2 top-full pt-2 z-50">
                    <div className="rounded-lg shadow-lg py-2 px-1 border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 animate-in fade-in slide-in-from-top-2 duration-150 min-w-[160px]">
                      <button
                        onClick={() => {
                          activeCard && onGenerateCard(activeCard);
                          setOpenMenu(null);
                        }}
                        disabled={!activeCard}
                        className="flex items-center gap-2 w-full text-left px-3 py-1.5 text-[11px] font-medium uppercase rounded-lg whitespace-nowrap text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors disabled:opacity-40 disabled:pointer-events-none"
                      >
                        Generate Card
                      </button>
                      <button
                        onClick={() => {
                          onGenerateAll();
                          setOpenMenu(null);
                        }}
                        disabled={selectedCount === 0}
                        className="flex items-center gap-2 w-full text-left px-3 py-1.5 text-[11px] font-medium uppercase rounded-lg whitespace-nowrap text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors disabled:opacity-40 disabled:pointer-events-none"
                      >
                        Generate Selected
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="w-px h-3.5 bg-zinc-200 dark:bg-zinc-700 mx-0.5" />

              {/* Toggle image / prompt view */}
              <button
                onClick={() => setShowPrompt((prev) => !prev)}
                title={showPrompt ? 'Show generated image' : 'Show generation prompt'}
                aria-label={showPrompt ? 'Show generated image' : 'Show generation prompt'}
                className={`w-7 h-7 rounded-full flex items-center justify-center active:scale-95 transition-all duration-200 ${showPrompt ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200' : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 hover:text-zinc-800 dark:hover:text-zinc-200'}`}
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
                  <polyline points="16 18 22 12 16 6" />
                  <polyline points="8 6 2 12 8 18" />
                </svg>
              </button>

              <div className="w-px h-3.5 bg-zinc-200 dark:bg-zinc-700 mx-0.5" />


            </div>
          </div>
        ) : (
          <div className="px-5 h-[40px] flex items-center justify-center shrink-0 border-b border-zinc-100 dark:border-zinc-700">
            <div className="flex justify-center">
              {hasImage && toolbarState && (
                <AnnotationToolbar
                  activeTool={toolbarState.activeTool}
                  onToolChange={toolbarState.onToolChange}
                  annotationCount={toolbarState.annotationCount}
                  onDiscardMarks={toolbarState.onDiscardMarks}
                  onModify={toolbarState.onModify}
                  isModifying={toolbarState.isModifying}
                  activeColor={toolbarState.activeColor}
                  onColorChange={toolbarState.onColorChange}
                  palette={toolbarState.palette}
                  contentDirty={toolbarState.contentDirty}
                  hasSelection={toolbarState.hasSelection}
                  onDeleteSelected={toolbarState.onDeleteSelected}
                  inline
                  globalInstruction={toolbarState.globalInstruction}
                  onGlobalInstructionChange={toolbarState.onGlobalInstructionChange}
                />
              )}
            </div>
          </div>
        )}
      </div>

      <div
        className="group/zoom flex-1 flex flex-col items-center justify-center px-4 text-center animate-in fade-in duration-1000 relative border-b border-zinc-100 dark:border-zinc-700"
        style={{
          background: darkMode
            ? 'linear-gradient(180deg, #1e1e22 0%, #1a1a1e 40%, #202024 100%)'
            : 'linear-gradient(180deg, #f0f4f8 0%, #e8edf2 40%, #f5f7fa 100%)',
        }}
      >
        {showReference && referenceImage ? (
          <div className="w-full h-full animate-in fade-in duration-300 relative">
            <ErrorBoundary name="Annotation Workbench">
              <AnnotationWorkbench
                imageUrl={referenceImage.url}
                cardId={null}
                cardText={null}
                palette={referenceImage.settings.palette}
                style={referenceImage.settings.style}
                aspectRatio={referenceImage.settings.aspectRatio}
                resolution={referenceImage.settings.resolution}
                mode="inline"
                onImageModified={
                  onReferenceImageModified
                    ? (_id: string, newUrl: string) => onReferenceImageModified(newUrl)
                    : undefined
                }
                onRequestFullscreen={() => onZoomImage(referenceImage.url)}
                onToolbarStateChange={setToolbarState}
                onUsage={onUsage}
                overlay={
                  <div
                    className="absolute top-0 right-0 overflow-hidden w-32 h-32 pointer-events-none z-10"
                    style={{ borderRadius: '0 20px 0 0' }}
                  >
                    <div
                      className="absolute top-[18px] right-[-36px] w-[180px] text-center rotate-45 text-white text-[11px] font-bold uppercase tracking-[0.2em] py-1 shadow-sm"
                      style={{ backgroundColor: 'rgba(42, 159, 212, 0.85)' }}
                    >
                      ref. Image
                    </div>
                  </div>
                }
              />
            </ErrorBoundary>
          </div>
        ) : showPrompt ? (
          <div className="absolute inset-0 overflow-y-auto text-left px-6 py-4 animate-in fade-in duration-300">
            {effectivePrompt ? (
              <article
                className="document-prose chat-prose pb-20 max-w-none"
                dangerouslySetInnerHTML={{
                  __html: sanitizeHtml(
                    marked.parse(effectivePrompt, { async: false }) as string,
                  ),
                }}
              />
            ) : (
              <div className="flex items-center justify-center h-full">
                <p className="text-[12px] text-zinc-400 dark:text-zinc-500 italic">
                  No generation prompt yet — generate an image to see the actual prompt sent to the AI.
                </p>
              </div>
            )}
          </div>
        ) : isGenerating ? (
          <div className="flex flex-col items-center space-y-4 animate-in fade-in duration-500">
            <ChiselLoader darkMode={darkMode} />
            <p
              className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 italic transition-all duration-300 ease-in-out"
              style={{ opacity: funMsgFade ? 1 : 0, transform: funMsgFade ? 'translateY(0)' : 'translateY(4px)' }}
            >
              {funMessages[funMsgIndex]}
            </p>
          </div>
        ) : hasImage ? (
          <div ref={imageContainerRef} className="w-full h-full animate-in fade-in duration-300 relative">
            <ErrorBoundary name="Annotation Workbench">
              <AnnotationWorkbench
                imageUrl={activeCard!.activeImageMap![cardLevel]!}
                cardId={activeCard!.id}
                cardText={activeCard!.text}
                palette={committedSettings.palette}
                style={committedSettings.style}
                aspectRatio={committedSettings.aspectRatio}
                resolution={committedSettings.resolution}
                imageHistory={activeCard!.albumMap?.[cardLevel]?.map((img) => ({
                  imageUrl: img.imageUrl,
                  timestamp: img.createdAt,
                  label: img.label,
                }))}
                mode="inline"
                onImageModified={onImageModified}
                onRequestFullscreen={() => onZoomImage(activeCard!.activeImageMap![cardLevel] || '')}
                contentDirty={contentDirty}
                currentContent={currentContent}
                onToolbarStateChange={setToolbarState}
                onUsage={onUsage}
              />
            </ErrorBoundary>
          </div>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center">
            <PanelRequirements level="assets" hasImage={hasImage} />
          </div>
        )}

        {/* Floating zoom controls — bottom-left, visible on hover */}
        {(hasImage || (showReference && referenceImage)) && toolbarState && (
          <div className="absolute bottom-3 left-3 z-20 flex items-center gap-0.5 px-1.5 py-1 rounded-lg bg-white/70 dark:bg-zinc-900/70 backdrop-blur-sm opacity-0 group-hover/zoom:opacity-100 transition-opacity duration-200">
            <button
              onClick={toolbarState.onZoomOut}
              title="Zoom Out"
              aria-label="Zoom Out"
              className="w-6 h-6 rounded-full flex items-center justify-center transition-all text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-white/80 dark:hover:bg-zinc-800/80"
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
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
            <span className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400 min-w-[28px] text-center select-none">
              {Math.round(toolbarState.zoomScale * 100)}%
            </span>
            <button
              onClick={toolbarState.onZoomIn}
              title="Zoom In"
              aria-label="Zoom In"
              className="w-6 h-6 rounded-full flex items-center justify-center transition-all text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-white/80 dark:hover:bg-zinc-800/80"
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
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
            <button
              onClick={toolbarState.onZoomReset}
              title="Reset Zoom"
              aria-label="Reset Zoom"
              className="w-6 h-6 rounded-full flex items-center justify-center transition-all text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-white/80 dark:hover:bg-zinc-800/80"
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
                <path d="M3 7V5a2 2 0 0 1 2-2h2" />
                <path d="M17 3h2a2 2 0 0 1 2 2v2" />
                <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
                <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
                <rect width="10" height="8" x="7" y="8" rx="1" />
              </svg>
            </button>
            {toolbarState.onRequestFullscreen && (
              <button
                onClick={toolbarState.onRequestFullscreen}
                title="Open Fullscreen"
                aria-label="Open Fullscreen"
                className="w-6 h-6 rounded-full flex items-center justify-center transition-all text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-white/80 dark:hover:bg-zinc-800/80"
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
                  <polyline points="15 3 21 3 21 9" />
                  <polyline points="9 21 3 21 3 15" />
                  <line x1="21" y1="3" x2="14" y2="10" />
                  <line x1="3" y1="21" x2="10" y2="14" />
                </svg>
              </button>
            )}
          </div>
        )}
      </div>

      {/* ─── Album strip ─── */}
      {showAlbumStrip && (
        <div className="shrink-0 px-3 py-2 border-t border-zinc-200/60 dark:border-zinc-700/60">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-zinc-500 dark:text-zinc-400">
              Album
            </span>
            <span className="text-[9px] text-zinc-400 dark:text-zinc-500">
              {album.findIndex((img) => img.isActive) + 1} of {album.length}
            </span>
          </div>
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            {album
              .slice()
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map((img) => (
                <div
                  key={img.id}
                  onClick={() => !albumActionPending && !img.isActive && confirmDeleteImageId !== img.id && onSetActiveImage?.(img.id)}
                  role="button"
                  tabIndex={albumActionPending ? -1 : 0}
                  title={img.label}
                  className={`group/thumb relative shrink-0 w-20 h-20 rounded-lg overflow-hidden border-2 transition-all duration-150 ${
                    img.isActive
                      ? 'border-[#2a9fd4] shadow-[0_0_0_2px_rgba(42,159,212,0.25)] scale-105'
                      : 'border-zinc-200 dark:border-zinc-600 hover:border-zinc-400 dark:hover:border-zinc-400 hover:scale-[1.03]'
                  } ${albumActionPending ? 'opacity-60 cursor-wait' : img.isActive ? 'cursor-default' : 'cursor-pointer'}`}
                >
                  <img
                    src={img.imageUrl}
                    alt={img.label}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                  {albumActionPending === img.id && (
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    </div>
                  )}
                  {!albumActionPending && confirmDeleteImageId !== img.id && (
                    <div className="absolute top-0.5 right-0.5 flex flex-col gap-0.5 opacity-0 group-hover/thumb:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          const image = new Image();
                          image.crossOrigin = 'anonymous';
                          image.onload = () => {
                            const canvas = document.createElement('canvas');
                            canvas.width = image.naturalWidth;
                            canvas.height = image.naturalHeight;
                            const ctx = canvas.getContext('2d');
                            ctx?.drawImage(image, 0, 0);
                            canvas.toBlob((blob) => {
                              if (!blob) return;
                              const blobUrl = URL.createObjectURL(blob);
                              const link = document.createElement('a');
                              link.href = blobUrl;
                              const cardName = (activeCard?.text || 'image').replace(/[^a-zA-Z0-9 _-]/g, '').trim().replace(/\s+/g, '_');
                              link.download = `${cardName}.png`;
                              document.body.appendChild(link);
                              link.click();
                              document.body.removeChild(link);
                              URL.revokeObjectURL(blobUrl);
                            }, 'image/png');
                          };
                          image.src = img.imageUrl;
                        }}
                        className="w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-[#2a9fd4] transition-colors"
                        title={`Download ${img.label}`}
                        aria-label={`Download ${img.label}`}
                      >
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                          <polyline points="7 10 12 15 17 10" />
                          <line x1="12" y1="15" x2="12" y2="3" />
                        </svg>
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDeleteImageId(img.id);
                        }}
                        className="w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-red-600 transition-colors"
                        title={`Delete ${img.label}`}
                        aria-label={`Delete ${img.label}`}
                      >
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                        </svg>
                      </button>
                    </div>
                  )}
                  {confirmDeleteImageId === img.id && (
                    <div
                      className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center gap-1.5 rounded-lg"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span className="text-[10px] font-semibold text-white leading-none">Delete?</span>
                      <div className="flex gap-1.5">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmDeleteImageId(null);
                            onDeleteAlbumImage?.(img.id);
                          }}
                          className="px-2 py-1 text-[10px] font-bold rounded bg-red-600 text-white hover:bg-red-500 transition-colors"
                        >
                          Yes
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmDeleteImageId(null);
                          }}
                          className="px-2 py-1 text-[10px] font-bold rounded bg-zinc-600 text-white hover:bg-zinc-500 transition-colors"
                        >
                          No
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
          </div>
        </div>
      )}

      {/* ─── Card Properties footer ─── */}
      {(showReference && referenceImage) || hasImage ? (
        <div className="shrink-0 px-3 py-1.5 flex items-center justify-center">
          {showReference && referenceImage ? (
            <div className="flex items-center gap-1">
              <span className="text-[9px] font-medium uppercase text-zinc-500 dark:text-zinc-400 tracking-[0.1em]">
                Card Properties
              </span>
              <span className="text-[9px] text-zinc-500 dark:text-zinc-400">·</span>
              <span className="text-[9px] font-medium uppercase" style={{ color: '#2a9fd4' }}>
                ref
              </span>
              <span className="text-[9px] text-zinc-500 dark:text-zinc-400">·</span>
              <span className="text-[9px] font-medium uppercase text-zinc-500 dark:text-zinc-400">
                {referenceImage.settings.style}
              </span>
              <span className="text-[9px] text-zinc-500 dark:text-zinc-400">·</span>
              <span className="text-[9px] font-medium uppercase text-zinc-500 dark:text-zinc-400">
                {referenceImage.settings.aspectRatio}
              </span>
              <span className="text-[9px] text-zinc-500 dark:text-zinc-400">·</span>
              <span className="text-[9px] font-medium uppercase text-zinc-500 dark:text-zinc-400">
                {referenceImage.settings.resolution}
              </span>
              <div className="flex -space-x-0.5 ml-0.5">
                {Object.values(referenceImage.settings.palette).map((color, i) => (
                  <div
                    key={i}
                    className="w-2 h-2 rounded-full ring-[1.5px] ring-black/20 dark:ring-white/40"
                    style={{ backgroundColor: color, zIndex: 5 - i }}
                  />
                ))}
              </div>
            </div>
          ) : (
            hasImage && (
              <div className="flex items-center gap-1">
                <span className="text-[9px] font-medium uppercase text-zinc-500 dark:text-zinc-400 tracking-[0.1em]">
                  Card Properties
                </span>
                <span className="text-[9px] text-zinc-500 dark:text-zinc-400">·</span>
                <span className="text-[9px] font-medium uppercase text-zinc-500 dark:text-zinc-400">
                  {menuDraftOptions.style}
                </span>
                <span className="text-[9px] text-zinc-500 dark:text-zinc-400">·</span>
                <span className="text-[9px] font-medium uppercase text-zinc-500 dark:text-zinc-400">
                  {menuDraftOptions.aspectRatio}
                </span>
                <span className="text-[9px] text-zinc-500 dark:text-zinc-400">·</span>
                <span className="text-[9px] font-medium uppercase text-zinc-500 dark:text-zinc-400">
                  {menuDraftOptions.resolution}
                </span>
                <div className="flex -space-x-0.5 ml-0.5">
                  {Object.values(menuDraftOptions.palette).map((color, i) => (
                    <div
                      key={i}
                      className="w-2 h-2 rounded-full ring-[1.5px] ring-black/20 dark:ring-white/40"
                      style={{ backgroundColor: color, zIndex: 5 - i }}
                    />
                  ))}
                </div>
              </div>
            )
          )}
        </div>
      ) : null}

      {/* Mismatch dialog — positioned within cardlab */}
      {mismatchDialog && (
        <ReferenceMismatchDialog
          onDisableReference={() => {
            mismatchDialog.resolve('disable');
            onDismissMismatch?.();
          }}
          onSkipOnce={() => {
            mismatchDialog.resolve('skip');
            onDismissMismatch?.();
          }}
          onCancel={() => {
            mismatchDialog.resolve('cancel');
            onDismissMismatch?.();
          }}
        />
      )}

      {/* Manifest batch confirmation — positioned within cardlab */}
      {manifestCards && onExecuteBatch && onCloseManifest && (
        <ManifestModal manifestCards={manifestCards} onExecute={onExecuteBatch} onClose={onCloseManifest} />
      )}
    </section>
  );
};

export default React.memo(AssetsPanel);
