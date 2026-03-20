import React, { useRef, useState, useEffect } from 'react';
import { StylingOptions, Palette } from '../types';
import { VISUAL_STYLES, STYLE_FONTS, STYLE_IDENTITY_FIELDS, BUILTIN_STYLE_NAMES } from '../utils/ai';

export interface StyleToolbarProps {
  menuDraftOptions: StylingOptions;
  setMenuDraftOptions: React.Dispatch<React.SetStateAction<StylingOptions>>;
  onOpenStyleStudio?: () => void;
}

const StyleToolbar: React.FC<StyleToolbarProps> = ({
  menuDraftOptions,
  setMenuDraftOptions,
  onOpenStyleStudio,
}) => {
  const toolbarRef = useRef<HTMLDivElement>(null);

  const [openMenu, setOpenMenu] = useState<'style' | 'ratio' | 'resolution' | 'palette-background' | 'palette-primary' | 'palette-secondary' | 'palette-accent' | 'palette-text' | null>(null);

  const paletteKeys: Array<keyof Palette> = ['background', 'primary', 'secondary', 'accent', 'text'];

  const updatePalette = (key: keyof Palette, value: string) => {
    setMenuDraftOptions((prev) => ({
      ...prev,
      palette: { ...prev.palette, [key]: value },
    }));
  };
  const [menuMode, setMenuMode] = useState<'hover' | 'locked'>('hover');
  const [showUserDefinedSub, setShowUserDefinedSub] = useState(false);
  const [userDefinedLocked, setUserDefinedLocked] = useState(false);

  // Reset sub-menu when style menu closes
  useEffect(() => {
    if (openMenu !== 'style') {
      setShowUserDefinedSub(false);
      setUserDefinedLocked(false);
    }
  }, [openMenu]);

  // Close menu on click outside (only when locked)
  useEffect(() => {
    if (!openMenu || menuMode !== 'locked') return;
    const handler = (e: MouseEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
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

  return (
    <div
      ref={toolbarRef}
      className="flex items-center gap-1 px-1.5 h-9"
    >
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
                    {/* User Defined parent item with sub-menu */}
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
    </div>
  );
};

export default React.memo(StyleToolbar);
