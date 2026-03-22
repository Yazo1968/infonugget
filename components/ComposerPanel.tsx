import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useThemeContext } from '../context/ThemeContext';
import { usePanelOverlay } from '../hooks/usePanelOverlay';
import type { CardItem, Card, CardFolder, DetailLevel, AlbumImage, UploadedFile, BrandingSettings, HeaderFooterSettings, LogoPosition } from '../types';
import { isCardFolder } from '../types';
import { exportImagesToZip, type ExportImageItem } from '../utils/exportImages';
import { exportImagesToPdf } from '../utils/exportImagesPdf';
import { exportFolderToDocx } from '../utils/exportDocx';

interface ComposerPanelProps {
  isOpen: boolean;
  tabBarRef?: React.RefObject<HTMLElement | null>;
  cards: CardItem[];
  projectName: string;
  nuggetName: string;
  documents: UploadedFile[];
  branding?: BrandingSettings;
  onUpdateBranding?: (branding: BrandingSettings) => void;
  headerFooter?: HeaderFooterSettings;
  onUpdateHeaderFooter?: (settings: HeaderFooterSettings) => void;
}

// ── Album helpers (shared logic from ExportImagesModal) ──

function getCardAlbums(card: Card): { level: DetailLevel; images: AlbumImage[] }[] {
  if (!card.albumMap) return [];
  const entries: { level: DetailLevel; images: AlbumImage[] }[] = [];
  for (const [level, images] of Object.entries(card.albumMap)) {
    if (images && images.length > 0) {
      entries.push({ level: level as DetailLevel, images: [...images].sort((a, b) => a.sortOrder - b.sortOrder) });
    }
  }
  return entries;
}

function getAllImageIds(cards: Card[]): Set<string> {
  const ids = new Set<string>();
  for (const card of cards) {
    if (!card.albumMap) continue;
    for (const images of Object.values(card.albumMap)) {
      if (images) images.forEach((img) => ids.add(img.id));
    }
  }
  return ids;
}

function getDefaultSelection(cards: Card[]): Set<string> {
  const ids = new Set<string>();
  for (const card of cards) {
    if (!card.albumMap) continue;
    for (const images of Object.values(card.albumMap)) {
      if (images) {
        const active = images.find((img) => img.isActive);
        if (active) ids.add(active.id);
      }
    }
  }
  return ids;
}

// ── Logo compositing ──

/** Composites a logo onto an image using Canvas API. Returns a data URL. */
async function compositeLogoOnImage(
  imageUrl: string,
  logoUrl: string,
  position: LogoPosition,
  sizePercent: number,
  opacity: number,
  customOverride?: import('../types').LogoOverride,
): Promise<string> {
  const [img, logo] = await Promise.all([loadImage(imageUrl), loadImage(logoUrl)]);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d')!;

  // Draw base image
  ctx.drawImage(img, 0, 0);

  let x: number, y: number, logoW: number, logoH: number;

  if (customOverride) {
    // Use custom position/size from user drag
    logoW = (canvas.width * customOverride.sizePercent) / 100;
    logoH = (logo.naturalHeight / logo.naturalWidth) * logoW;
    x = (canvas.width * customOverride.xPercent) / 100;
    y = (canvas.height * customOverride.yPercent) / 100;
  } else {
    // Use grid position
    logoW = (canvas.width * sizePercent) / 100;
    logoH = (logo.naturalHeight / logo.naturalWidth) * logoW;
    const padding = canvas.width * 0.02;
    ({ x, y } = getLogoXY(position, canvas.width, canvas.height, logoW, logoH, padding));
  }

  // Draw logo with opacity
  ctx.globalAlpha = opacity / 100;
  ctx.drawImage(logo, x, y, logoW, logoH);
  ctx.globalAlpha = 1;

  return canvas.toDataURL('image/png');
}

function getLogoXY(
  pos: LogoPosition, cw: number, ch: number, lw: number, lh: number, pad: number,
): { x: number; y: number } {
  const xMap: Record<string, number> = { left: pad, center: (cw - lw) / 2, right: cw - lw - pad };
  const yMap: Record<string, number> = { top: pad, middle: (ch - lh) / 2, bottom: ch - lh - pad };
  const [vPos, hPos] = pos.split('-') as [string, string];
  return { x: xMap[hPos] ?? pad, y: yMap[vPos] ?? pad };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** Hook to generate a composited image URL. */
function useCompositedImage(
  imageUrl: string | null,
  branding: BrandingSettings | undefined,
  enabled: boolean,
  imageId?: string,
): string | null {
  const [result, setResult] = useState<string | null>(null);
  const override = imageId ? branding?.customOverrides?.[imageId] : undefined;

  useEffect(() => {
    if (!enabled || !imageUrl || !branding?.logoUrl) {
      setResult(null);
      return;
    }
    let cancelled = false;
    compositeLogoOnImage(imageUrl, branding.logoUrl, branding.position, branding.sizePercent, branding.opacity, override)
      .then((url) => { if (!cancelled) setResult(url); })
      .catch(() => { if (!cancelled) setResult(null); });
    return () => { cancelled = true; };
  }, [imageUrl, branding?.logoUrl, branding?.position, branding?.sizePercent, branding?.opacity, override, enabled]);

  return result;
}

// ── Branding Settings UI ──

const POSITION_GRID: LogoPosition[] = [
  'top-left', 'top-center', 'top-right',
  'middle-left', 'middle-center', 'middle-right',
  'bottom-left', 'bottom-center', 'bottom-right',
];

/** Custom styled slider for branding controls. */
function BrandSlider({
  label,
  value,
  min,
  max,
  suffix,
  step,
  onChange,
  darkMode: dm,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  suffix: string;
  step?: number;
  onChange: (v: number) => void;
  darkMode: boolean;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  const snap = (raw: number) => {
    if (step) return Math.round(raw / step) * step;
    return Math.round(raw);
  };
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className={`text-[9px] font-semibold uppercase tracking-wider ${dm ? 'text-zinc-500' : 'text-zinc-400'}`}>
          {label}
        </label>
        <span className={`text-[10px] font-mono font-medium ${dm ? 'text-zinc-400' : 'text-zinc-500'}`}>
          {step ? value.toFixed(1) : value}{suffix}
        </span>
      </div>
      <div
        className={`relative h-2 rounded-full cursor-pointer ${dm ? 'bg-zinc-700' : 'bg-zinc-200'}`}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
          onChange(snap(min + x * (max - min)));
        }}
      >
        {/* Filled track */}
        <div
          className="absolute top-0 left-0 h-full rounded-full bg-accent-blue transition-all"
          style={{ width: `${pct}%` }}
        />
        {/* Thumb */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-white border-2 border-accent-blue shadow-sm transition-all"
          style={{ left: `calc(${pct}% - 7px)` }}
          onMouseDown={(e) => {
            e.preventDefault();
            const track = e.currentTarget.parentElement!;
            const move = (ev: MouseEvent) => {
              const rect = track.getBoundingClientRect();
              const x = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
              onChange(snap(min + x * (max - min)));
            };
            const up = () => {
              document.removeEventListener('mousemove', move);
              document.removeEventListener('mouseup', up);
            };
            document.addEventListener('mousemove', move);
            document.addEventListener('mouseup', up);
          }}
        />
      </div>
    </div>
  );
}

function BrandingSection({
  branding,
  onUpdate,
  darkMode: dm,
}: {
  branding: BrandingSettings | undefined;
  onUpdate: (b: BrandingSettings) => void;
  darkMode: boolean;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const [pendingGridPos, setPendingGridPos] = useState<LogoPosition | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const current: BrandingSettings = branding ?? {
    logoUrl: null,
    logoStoragePath: null,
    position: 'bottom-right',
    sizePercent: 15,
    opacity: 80,
  };

  const processFile = useCallback((file: File) => {
    if (!file.type.match(/^image\/(png|svg\+xml|webp)$/)) return;
    const reader = new FileReader();
    reader.onload = () => {
      onUpdate({ ...current, logoUrl: reader.result as string, logoStoragePath: null });
    };
    reader.readAsDataURL(file);
  }, [current, onUpdate]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    e.target.value = '';
  }, [processFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  }, [processFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const removeLogo = useCallback(() => {
    onUpdate({ ...current, logoUrl: null, logoStoragePath: null });
  }, [current, onUpdate]);

  return (
    <div className={`shrink-0 border-b ${dm ? 'border-zinc-800' : 'border-zinc-100'}`}>
      <div className="px-4 py-2">
        <label className={`text-[10px] font-semibold uppercase tracking-wider ${dm ? 'text-zinc-500' : 'text-zinc-400'}`}>
          Branding
          {current.logoUrl && (
            <span className="ml-1.5 text-accent-blue">ON</span>
          )}
        </label>
      </div>
      <div className="px-4 pb-3 space-y-3">
          {/* Logo upload */}
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/svg+xml,image/webp"
              className="hidden"
              onChange={handleFileChange}
            />
            {current.logoUrl ? (
              <div className="flex items-center gap-3">
                <div className={`w-16 h-16 rounded-md border flex items-center justify-center overflow-hidden ${
                  dm ? 'border-zinc-700 bg-zinc-800' : 'border-zinc-200 bg-zinc-50'
                }`}>
                  <img src={current.logoUrl} alt="Logo" className="max-w-full max-h-full object-contain" />
                </div>
                <div className="flex flex-col gap-1">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className={`text-[10px] font-medium px-2 py-1 rounded ${
                      dm ? 'text-zinc-300 bg-zinc-700 hover:bg-zinc-600' : 'text-zinc-600 bg-zinc-100 hover:bg-zinc-200'
                    }`}
                  >
                    Replace
                  </button>
                  <button
                    onClick={removeLogo}
                    className="text-[10px] font-medium px-2 py-1 rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ) : (
              <div
                onClick={() => fileInputRef.current?.click()}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                className={`w-full py-3 rounded-md border-2 border-dashed text-[11px] font-medium text-center cursor-pointer transition-colors ${
                  isDragging
                    ? 'border-accent-blue bg-accent-blue/10 text-accent-blue'
                    : dm
                      ? 'border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-300'
                      : 'border-zinc-200 text-zinc-400 hover:border-zinc-400 hover:text-zinc-600'
                }`}
              >
                {isDragging ? 'Drop logo here' : 'Drop or click to upload logo (PNG, SVG, WebP)'}
              </div>
            )}
          </div>

          {/* Position grid */}
          {current.logoUrl && (() => {
            const hasCustom = current.customOverrides && Object.keys(current.customOverrides).length > 0;
            return (
            <>
              <div>
                <label className={`text-[9px] font-semibold uppercase tracking-wider ${dm ? 'text-zinc-500' : 'text-zinc-400'}`}>
                  Position
                </label>
                {hasCustom && (
                  <div className="mt-1">
                    <span className={`text-[9px] font-medium ${dm ? 'text-amber-400' : 'text-amber-600'}`}>
                      User defined ({Object.keys(current.customOverrides!).length})
                    </span>
                  </div>
                )}
                <div className="grid grid-cols-3 gap-1 mt-1 w-24">
                  {POSITION_GRID.map((pos) => (
                    <button
                      key={pos}
                      onClick={() => {
                        if (hasCustom) {
                          setPendingGridPos(pos);
                        } else {
                          onUpdate({ ...current, position: pos });
                        }
                      }}
                      className={`w-7 h-7 rounded-sm border transition-colors ${
                        !hasCustom && current.position === pos
                          ? 'bg-accent-blue border-accent-blue'
                          : dm
                            ? 'border-zinc-600 bg-zinc-700 hover:bg-zinc-600'
                            : 'border-zinc-200 bg-zinc-50 hover:bg-zinc-100'
                      }`}
                      title={pos}
                    >
                      <div
                        className={`w-2 h-2 rounded-full mx-auto ${
                          !hasCustom && current.position === pos ? 'bg-white' : dm ? 'bg-zinc-500' : 'bg-zinc-300'
                        }`}
                      />
                    </button>
                  ))}
                </div>

                {/* Confirmation dialog — rendered as portal */}
                {pendingGridPos && createPortal(
                  <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 dark:bg-black/60 animate-in fade-in duration-300">
                    <div
                      role="dialog"
                      aria-modal="true"
                      className="w-full max-w-sm bg-white dark:bg-zinc-900 rounded-[40px] p-10 shadow-2xl dark:shadow-black/30 border border-zinc-200 dark:border-zinc-600 animate-in zoom-in-95 duration-300"
                    >
                      <div className="space-y-6 text-center">
                        <div className="w-16 h-16 flex items-center justify-center mx-auto">
                          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-800 dark:text-zinc-200">
                            <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                            <line x1="12" y1="9" x2="12" y2="13" />
                            <line x1="12" y1="17" x2="12.01" y2="17" />
                          </svg>
                        </div>
                        <div className="space-y-2">
                          <h3 className="text-[15px] font-black tracking-tight text-zinc-800 dark:text-zinc-200">
                            Override custom positions?
                          </h3>
                          <p className="text-xs text-zinc-500 dark:text-zinc-400 font-light leading-relaxed">
                            Some images have individual logo position and size. Applying a grid position will replace all custom positioning and sizing with the selected preset.
                          </p>
                        </div>
                        <div className="flex flex-col space-y-3 pt-4">
                          <button
                            onClick={() => {
                              onUpdate({ ...current, position: pendingGridPos, customOverrides: {} });
                              setPendingGridPos(null);
                            }}
                            className="w-full py-4 rounded-full bg-black text-white text-[10px] font-black uppercase tracking-widest hover:scale-[1.02] transition-all"
                          >
                            Apply to All
                          </button>
                          <button
                            onClick={() => setPendingGridPos(null)}
                            className="w-full py-2 text-zinc-600 dark:text-zinc-400 text-[10px] font-bold uppercase tracking-widest hover:text-zinc-800 dark:hover:text-zinc-200 transition-all"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>,
                  document.body,
                )}
              </div>

              {/* Size slider */}
              <BrandSlider
                label="Size"
                value={current.sizePercent}
                min={5}
                max={50}
                suffix="%"
                onChange={(v) => onUpdate({ ...current, sizePercent: v })}
                darkMode={dm}
              />

              {/* Opacity slider */}
              <BrandSlider
                label="Opacity"
                value={current.opacity}
                min={10}
                max={100}
                suffix="%"
                onChange={(v) => onUpdate({ ...current, opacity: v })}
                darkMode={dm}
              />
            </>
            );
          })()}
        </div>
    </div>
  );
}

// ── Bento Block Grid ──

const THUMB_SIZE = 170; // px — fixed thumbnail size
const IMG_GAP = 12;     // px — gap between images inside a card block
const BLOCK_GAP = 28;   // px — horizontal gap between bento blocks

/** Collect all images for a card across all detail levels, flattened. */
function getCardImages(card: Card): AlbumImage[] {
  const albums = getCardAlbums(card);
  return albums.flatMap(({ images }) => images);
}

/** Single thumbnail with optional logo compositing and footer preview. */
function BrandedThumbnail({
  img,
  card,
  isSelected,
  branding,
  headerFooter,
  projectName,
  nuggetName,
  pageNum,
  totalPages,
  onToggle,
  onZoom,
  darkMode: dm,
}: {
  img: AlbumImage;
  card: Card;
  isSelected: boolean;
  branding?: BrandingSettings;
  headerFooter?: HeaderFooterSettings;
  projectName: string;
  nuggetName: string;
  pageNum?: number;
  totalPages?: number;
  onToggle: () => void;
  onZoom: (url: string, title: string, imageId: string) => void;
  darkMode: boolean;
}) {
  const hasBranding = !!(branding?.logoUrl);
  const compositedUrl = useCompositedImage(img.imageUrl, branding, hasBranding, img.id);
  const displayUrl = compositedUrl ?? img.imageUrl;
  const showHF = headerFooter?.enabled;

  return (
    <div
      className={`relative rounded-md overflow-hidden border-2 transition-all shrink-0 cursor-pointer ${
        isSelected
          ? 'border-accent-blue shadow-md ring-1 ring-accent-blue/30'
          : dm
            ? 'border-zinc-600 hover:border-zinc-400'
            : 'border-zinc-200 hover:border-zinc-300'
      }`}
      style={{ width: `${THUMB_SIZE}px`, height: `${THUMB_SIZE}px` }}
      title={`${card.text} — ${img.label}`}
      onClick={() => onZoom(img.imageUrl, `${card.text} — ${img.label}`, img.id)}
    >
      <img src={displayUrl} alt={img.label} className="w-full h-full object-cover" loading="lazy" />
      {showHF && (
        <div className="absolute bottom-0 left-0 right-0 px-1.5 py-0.5 flex items-center justify-between">
          <span className="text-[4px] text-zinc-500 truncate max-w-[40%]">{projectName} — {nuggetName}</span>
          {pageNum != null && totalPages != null && (
            <span className="text-[4px] text-zinc-500">{pageNum} of {totalPages}</span>
          )}
          <span className="text-[4px] text-zinc-500">{new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
        </div>
      )}
      <button
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
        className={`absolute top-1.5 right-1.5 w-5 h-5 rounded flex items-center justify-center text-white transition-colors ${
          isSelected ? 'bg-accent-blue hover:bg-accent-blue/80' : dm ? 'bg-black/50 hover:bg-black/70' : 'bg-black/30 hover:bg-black/50'
        }`}
      >
        {isSelected && (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
      </button>
    </div>
  );
}

/** Zoom overlay with interactive logo drag/resize. */
function ZoomOverlayWithLogo({
  imageUrl,
  imageId,
  branding,
  onUpdateBranding,
  headerFooter,
  projectName,
  nuggetName,
  pageNum,
  totalPages,
  allImageIds,
  onClose,
}: {
  imageUrl: string;
  imageId: string;
  branding?: BrandingSettings;
  onUpdateBranding?: (b: BrandingSettings) => void;
  headerFooter?: HeaderFooterSettings;
  projectName: string;
  nuggetName: string;
  pageNum?: number;
  totalPages?: number;
  allImageIds?: string[];
  onClose: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [imgLoaded, setImgLoaded] = useState(false);

  // Get current override or compute from grid position
  const override = branding?.customOverrides?.[imageId];
  const hasLogo = !!(branding?.logoUrl);

  // Compute logo position in % relative to the image
  const [logoPosState, setLogoPosState] = useState<{ xPct: number; yPct: number; sizePct: number } | null>(null);

  // Initialize position from override or grid
  useEffect(() => {
    if (!hasLogo || !branding) return;
    if (override) {
      setLogoPosState({ xPct: override.xPercent, yPct: override.yPercent, sizePct: override.sizePercent });
    } else {
      // Compute from grid position — need logo aspect ratio for accurate placement
      const logoImg = new Image();
      logoImg.onload = () => {
        const logoAR = logoImg.naturalHeight / logoImg.naturalWidth;
        const sizePct = branding.sizePercent;
        const logoHPct = sizePct * logoAR; // approximate, assumes square-ish image
        const pad = 2;
        const pos = branding.position;
        const [vPos, hPos] = pos.split('-');
        const xPct = hPos === 'left' ? pad : hPos === 'center' ? (100 - sizePct) / 2 : 100 - sizePct - pad;
        const yPct = vPos === 'top' ? pad : vPos === 'middle' ? (100 - logoHPct) / 2 : 100 - logoHPct - pad;
        setLogoPosState({ xPct, yPct, sizePct });
      };
      logoImg.src = branding.logoUrl!;
    }
  }, [hasLogo, branding?.logoUrl, branding?.position, branding?.sizePercent, override]);

  // Save custom override
  const saveOverride = useCallback((xPct: number, yPct: number, sizePct: number) => {
    if (!branding || !onUpdateBranding) return;
    const newOverrides = { ...branding.customOverrides };
    newOverrides[imageId] = { xPercent: xPct, yPercent: yPct, sizePercent: sizePct };
    onUpdateBranding({ ...branding, customOverrides: newOverrides });
  }, [branding, onUpdateBranding, imageId]);

  // Handle logo drag
  const handleLogoDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!imgRef.current || !logoPosState) return;

    const imgRect = imgRef.current.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    const startXPct = logoPosState.xPct;
    const startYPct = logoPosState.yPct;

    const move = (ev: MouseEvent) => {
      const dx = ((ev.clientX - startX) / imgRect.width) * 100;
      const dy = ((ev.clientY - startY) / imgRect.height) * 100;
      const newX = Math.max(0, Math.min(100 - logoPosState.sizePct, startXPct + dx));
      const newY = Math.max(0, Math.min(95, startYPct + dy));
      setLogoPosState((prev) => prev ? { ...prev, xPct: newX, yPct: newY } : prev);
    };
    const up = (ev: MouseEvent) => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      // Save final position
      const dx = ((ev.clientX - startX) / imgRect.width) * 100;
      const dy = ((ev.clientY - startY) / imgRect.height) * 100;
      const newX = Math.max(0, Math.min(100 - logoPosState.sizePct, startXPct + dx));
      const newY = Math.max(0, Math.min(95, startYPct + dy));
      saveOverride(newX, newY, logoPosState.sizePct);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }, [logoPosState, saveOverride]);

  // Handle resize via corner drag
  const handleResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!imgRef.current || !logoPosState) return;

    const imgRect = imgRef.current.getBoundingClientRect();
    const startX = e.clientX;
    const startSizePct = logoPosState.sizePct;

    const move = (ev: MouseEvent) => {
      const dx = ((ev.clientX - startX) / imgRect.width) * 100;
      const newSize = Math.max(3, Math.min(60, startSizePct + dx));
      setLogoPosState((prev) => prev ? { ...prev, sizePct: newSize } : prev);
    };
    const up = (ev: MouseEvent) => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      const dx = ((ev.clientX - startX) / imgRect.width) * 100;
      const newSize = Math.max(3, Math.min(60, startSizePct + dx));
      saveOverride(logoPosState.xPct, logoPosState.yPct, newSize);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }, [logoPosState, saveOverride]);

  // Reset to grid position
  const resetToGrid = useCallback(() => {
    if (!branding || !onUpdateBranding) return;
    const newOverrides = { ...branding.customOverrides };
    delete newOverrides[imageId];
    onUpdateBranding({ ...branding, customOverrides: newOverrides });
    setLogoPosState(null); // will re-init from grid via useEffect
  }, [branding, onUpdateBranding, imageId]);

  // Apply current logo position/size to all images
  const applyToAll = useCallback(() => {
    if (!branding || !onUpdateBranding || !logoPosState || !allImageIds?.length) return;
    const newOverrides = { ...branding.customOverrides };
    for (const id of allImageIds) {
      newOverrides[id] = { xPercent: logoPosState.xPct, yPercent: logoPosState.yPct, sizePercent: logoPosState.sizePct };
    }
    onUpdateBranding({ ...branding, customOverrides: newOverrides });
  }, [branding, onUpdateBranding, logoPosState, allImageIds]);

  return (
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center bg-black/70 cursor-pointer"
      onClick={onClose}
    >
      <div ref={containerRef} className="relative max-w-[90vw] max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
        <img
          ref={imgRef}
          src={imageUrl}
          alt=""
          className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl"
          onLoad={() => setImgLoaded(true)}
        />

        {/* Draggable logo overlay */}
        {hasLogo && imgLoaded && logoPosState && (
          <div
            className="absolute cursor-grab active:cursor-grabbing"
            style={{
              left: `${logoPosState.xPct}%`,
              top: `${logoPosState.yPct}%`,
              width: `${logoPosState.sizePct}%`,
              opacity: (branding?.opacity ?? 100) / 100,
            }}
            onMouseDown={handleLogoDrag}
          >
            <img
              src={branding!.logoUrl!}
              alt="Logo"
              className="w-full h-auto pointer-events-none select-none"
              draggable={false}
            />
            {/* Resize handle — bottom-right corner */}
            <div
              className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-white border-2 border-accent-blue cursor-se-resize shadow-sm"
              onMouseDown={handleResize}
            />
            {/* Outline when hovering */}
            <div className="absolute inset-0 border border-dashed border-white/50 rounded pointer-events-none" />
          </div>
        )}

        {/* Footer overlay — font size as % of image width */}
        {headerFooter?.enabled && imgLoaded && imgRef.current && (() => {
          const renderedW = imgRef.current!.clientWidth;
          const fsPct = headerFooter.fontSize ?? 1.2;
          const fsPx = renderedW * fsPct / 100;
          const padPx = renderedW * 0.02;
          const dateStr = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

          return (
            <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between" style={{ padding: `0 ${padPx}px ${padPx * 0.5}px` }}>
              <span className="text-zinc-500 truncate max-w-[40%]" style={{ fontSize: `${fsPx}px` }}>{projectName} — {nuggetName}</span>
              {pageNum != null && totalPages != null && (
                <span className="text-zinc-500" style={{ fontSize: `${fsPx}px` }}>{pageNum} of {totalPages}</span>
              )}
              <span className="text-zinc-500" style={{ fontSize: `${fsPx}px` }}>{dateStr}</span>
            </div>
          );
        })()}

        {/* Controls */}
        <div className="absolute top-2 right-2 flex items-center gap-1.5 bg-black/50 backdrop-blur-sm rounded-full px-2 py-1">
          {hasLogo && logoPosState && allImageIds && allImageIds.length > 1 && (
            <button
              onClick={applyToAll}
              className="px-2 py-1 rounded-full bg-accent-blue/80 hover:bg-accent-blue text-white text-[10px] font-medium transition-colors"
              title="Apply this logo position to all images"
            >
              Apply to all
            </button>
          )}
          {hasLogo && override && (
            <button
              onClick={resetToGrid}
              className="px-2 py-1 rounded-full bg-black/60 hover:bg-black/80 text-white text-[10px] font-medium transition-colors"
              title="Reset to grid position"
            >
              Reset
            </button>
          )}
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full bg-black/60 hover:bg-black/80 flex items-center justify-center text-white transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Custom indicator */}
        {hasLogo && override && (
          <div className="absolute bottom-2 left-2 px-2 py-1 rounded bg-black/60 text-white text-[10px] font-medium">
            Custom position
          </div>
        )}
      </div>
    </div>
  );
}

function CardImageGrid({
  cards,
  selectedImageIds,
  toggleImage,
  darkMode: dm,
  branding,
  onUpdateBranding,
  headerFooter,
  projectName,
  nuggetName,
}: {
  cards: Card[];
  selectedImageIds: Set<string>;
  toggleImage: (id: string) => void;
  darkMode: boolean;
  branding?: BrandingSettings;
  onUpdateBranding?: (b: BrandingSettings) => void;
  headerFooter?: HeaderFooterSettings;
  projectName: string;
  nuggetName: string;
}) {
  const [zoomImage, setZoomImage] = useState<{ url: string; title: string; imageId: string } | null>(null);

  const cardBlocks = useMemo(() => {
    return cards
      .map((card) => ({ card, images: getCardImages(card) }))
      .filter(({ images }) => images.length > 0);
  }, [cards]);

  // Compute total selected images for page numbering
  const totalSelectedImages = useMemo(() => {
    let count = 0;
    for (const { images } of cardBlocks) {
      for (const img of images) {
        if (selectedImageIds.has(img.id)) count++;
      }
    }
    return count;
  }, [cardBlocks, selectedImageIds]);

  // Build a map: imageId → page number (1-based, only selected images)
  const pageNumMap = useMemo(() => {
    const map = new Map<string, number>();
    let page = 1;
    for (const { images } of cardBlocks) {
      for (const img of images) {
        if (selectedImageIds.has(img.id)) {
          map.set(img.id, page++);
        }
      }
    }
    return map;
  }, [cardBlocks, selectedImageIds]);

  return (
    <>
      <div className="flex flex-wrap items-start" style={{ columnGap: `${BLOCK_GAP}px`, rowGap: '32px' }}>
        {cardBlocks.map(({ card, images }) => (
          <div key={card.id} className={`flex flex-col border-2 rounded-lg shadow-sm ${dm ? 'border-zinc-500' : 'border-zinc-400'}`}>
            {/* Images row */}
            <div
              className="flex justify-center items-center rounded-t-lg p-3"
              style={{ gap: `${IMG_GAP}px` }}
            >
              {images.map((img) => (
                <BrandedThumbnail
                  key={img.id}
                  img={img}
                  card={card}
                  isSelected={selectedImageIds.has(img.id)}
                  branding={branding}
                  headerFooter={headerFooter}
                  projectName={projectName}
                  nuggetName={nuggetName}
                  pageNum={pageNumMap.get(img.id)}
                  totalPages={totalSelectedImages}
                  onToggle={() => toggleImage(img.id)}
                  onZoom={(url, title, imageId) => setZoomImage({ url, title, imageId })}
                  darkMode={dm}
                />
              ))}
            </div>
          {/* Card title */}
          <div className="px-1.5 py-1 rounded-b-lg text-center">
            <span className={`text-[11px] font-medium leading-tight line-clamp-1 ${
              dm ? 'text-zinc-400' : 'text-zinc-500'
            }`}>
              {card.text}
            </span>
          </div>
        </div>
      ))}
    </div>

    {/* Zoom preview overlay with interactive logo */}
    {zoomImage && (
      <ZoomOverlayWithLogo
        imageUrl={zoomImage.url}
        imageId={zoomImage.imageId}
        branding={branding}
        onUpdateBranding={onUpdateBranding}
        headerFooter={headerFooter}
        projectName={projectName}
        nuggetName={nuggetName}
        pageNum={pageNumMap.get(zoomImage.imageId)}
        totalPages={totalSelectedImages}
        allImageIds={Array.from(selectedImageIds)}
        onClose={() => setZoomImage(null)}
      />
    )}
    </>
  );
}

// ── Main Component ──

export default function ComposerPanel({
  isOpen,
  tabBarRef,
  cards,
  projectName,
  nuggetName,
  documents,
  branding,
  onUpdateBranding,
  headerFooter,
  onUpdateHeaderFooter,
}: ComposerPanelProps) {
  const { darkMode } = useThemeContext();
  const { shouldRender, overlayStyle } = usePanelOverlay({ isOpen, defaultWidth: 520, minWidth: 380, anchorRef: tabBarRef });

  // ── State ──
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [selectedImageIds, setSelectedImageIds] = useState<Set<string>>(new Set());
  const [isExporting, setIsExporting] = useState<false | 'docx' | 'zip' | 'pdf'>(false);
  const [progress, setProgress] = useState<{ fetched: number; total: number } | null>(null);

  const dm = darkMode;
  const borderColor = dm ? 'rgb(63,63,70)' : 'rgb(228,228,231)';

  // ── Derived data ──
  const folders = useMemo(() => cards.filter(isCardFolder), [cards]);

  const selectedFolder = useMemo(
    () => folders.find((f) => f.id === selectedFolderId) ?? null,
    [folders, selectedFolderId],
  );

  const folderCards = useMemo(() => selectedFolder?.cards ?? [], [selectedFolder]);

  const allImageIds = useMemo(() => getAllImageIds(folderCards), [folderCards]);
  const totalImageCount = allImageIds.size;

  // Auto-select first folder if none selected
  React.useEffect(() => {
    if (!selectedFolderId && folders.length > 0) {
      setSelectedFolderId(folders[0].id);
    }
  }, [folders, selectedFolderId]);

  // Reset image selection when folder changes
  React.useEffect(() => {
    if (folderCards.length > 0) {
      setSelectedImageIds(getDefaultSelection(folderCards));
    } else {
      setSelectedImageIds(new Set());
    }
  }, [selectedFolderId, folderCards]);

  // ── Actions ──
  const toggleImage = useCallback((id: string) => {
    setSelectedImageIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAllImages = useCallback(() => setSelectedImageIds(new Set(allImageIds)), [allImageIds]);
  const deselectAllImages = useCallback(() => setSelectedImageIds(new Set()), []);

  /** Build export list from selected image IDs. Includes imageId for branding overrides. */
  const buildExportList = useCallback((): (ExportImageItem & { imageId: string })[] => {
    const items: (ExportImageItem & { imageId: string })[] = [];
    for (const card of folderCards) {
      if (!card.albumMap) continue;
      for (const [level, images] of Object.entries(card.albumMap)) {
        if (!images) continue;
        for (const img of images) {
          if (selectedImageIds.has(img.id)) {
            items.push({ cardTitle: card.text, detailLevel: level, label: img.label, imageUrl: img.imageUrl, imageId: img.id });
          }
        }
      }
    }
    return items;
  }, [selectedImageIds, folderCards]);

  const handleExportImages = useCallback(async (format: 'zip' | 'pdf') => {
    if (selectedImageIds.size === 0 || !selectedFolder) return;
    setIsExporting(format);

    let items = buildExportList();

    // Composite logos if branding is active
    if (branding?.logoUrl) {
      setProgress({ fetched: 0, total: items.length });
      const branded: (ExportImageItem & { imageId: string })[] = [];
      for (let i = 0; i < items.length; i++) {
        try {
          const imgOverride = branding.customOverrides?.[items[i].imageId];
          const compositedUrl = await compositeLogoOnImage(
            items[i].imageUrl,
            branding.logoUrl,
            branding.position,
            branding.sizePercent,
            branding.opacity,
            imgOverride,
          );
          branded.push({ ...items[i], imageUrl: compositedUrl });
        } catch {
          branded.push(items[i]); // fallback to original if compositing fails
        }
        setProgress({ fetched: i + 1, total: items.length });
      }
      items = branded;
    }

    setProgress({ fetched: 0, total: items.length });
    try {
      if (format === 'zip') {
        await exportImagesToZip({
          folderName: selectedFolder.name,
          images: items,
          onProgress: (fetched, total) => setProgress({ fetched, total }),
        });
      } else {
        await exportImagesToPdf({
          folderName: selectedFolder.name,
          images: items,
          onProgress: (fetched, total) => setProgress({ fetched, total }),
          headerFooter: headerFooter?.enabled ? headerFooter : undefined,
          projectName,
          nuggetName,
        });
      }
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setIsExporting(false);
      setProgress(null);
    }
  }, [selectedImageIds, selectedFolder, buildExportList, branding, headerFooter]);

  const handleExportDocx = useCallback(async () => {
    if (!selectedFolder) return;
    setIsExporting('docx');
    try {
      await exportFolderToDocx({
        projectName,
        nuggetName,
        folder: selectedFolder,
        documents,
      });
    } catch (err) {
      console.error('DOCX export failed:', err);
    } finally {
      setIsExporting(false);
    }
  }, [selectedFolder, projectName, nuggetName, documents]);

  // ── Render ──
  if (!shouldRender) return null;

  // Spinner SVG helper
  const spinner = (
    <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
      <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-75" />
    </svg>
  );

  return createPortal(
    <div
      data-panel-overlay
      className="fixed z-[103] flex flex-col bg-white dark:bg-zinc-900 border shadow-[5px_0_6px_rgba(0,0,0,0.35)] overflow-hidden"
      style={{ borderColor, ...overlayStyle }}
    >
      {/* ── Side-by-side Vertical Sections ── */}
      <div className="flex-1 flex overflow-hidden min-h-0">

        {/* ── Left: Settings ── */}
        <div className="shrink-0 flex flex-col overflow-hidden border-r border-zinc-200 dark:border-zinc-700" style={{ width: 280 }}>
          {/* Settings section header */}
          <div className="shrink-0 h-[36px] flex items-center gap-2 border-b border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-900">
            <div
              className="h-full w-[36px] shrink-0 flex items-center justify-center"
              style={{ backgroundColor: dm ? 'rgb(40,62,100)' : 'rgb(200,220,245)' }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-zinc-500 dark:text-zinc-400">
                <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
              </svg>
            </div>
            <span className="text-[13px] font-bold uppercase tracking-wider text-zinc-800 dark:text-zinc-200">Settings</span>
          </div>

          {/* Settings content — scrollable */}
          <div className="flex-1 overflow-y-auto min-h-0" style={{ scrollbarWidth: 'thin' }}>
            {/* Folder selector */}
            <div className={`px-4 py-2.5 border-b ${dm ? 'border-zinc-800' : 'border-zinc-100'}`}>
              <label className={`text-[10px] font-semibold uppercase tracking-wider ${dm ? 'text-zinc-500' : 'text-zinc-400'}`}>
                Folder
              </label>
              <select
                value={selectedFolderId ?? ''}
                onChange={(e) => setSelectedFolderId(e.target.value || null)}
                className={`w-full mt-1 px-2 py-1.5 rounded-md text-[12px] border ${
                  dm
                    ? 'bg-zinc-800 border-zinc-700 text-zinc-200'
                    : 'bg-white border-zinc-200 text-zinc-800'
                } focus:outline-none focus:ring-1 focus:ring-accent-blue`}
              >
                {folders.length === 0 && <option value="">No folders available</option>}
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name} ({f.cards.length} cards)
                  </option>
                ))}
              </select>
            </div>

            {/* Branding section */}
            <BrandingSection
              branding={branding}
              onUpdate={(b) => onUpdateBranding?.(b)}
              darkMode={dm}
            />

            {/* Footer section */}
            <div className="px-4 py-3 space-y-2">
              <div className="flex items-center justify-between">
                <label className={`text-[10px] font-semibold uppercase tracking-wider ${dm ? 'text-zinc-500' : 'text-zinc-400'}`}>
                  Footer
                </label>
                <button
                  onClick={() => {
                    const current = headerFooter ?? { enabled: false };
                    onUpdateHeaderFooter?.({ ...current, enabled: !current.enabled });
                  }}
                  className={`relative w-7 h-4 rounded-full transition-colors ${
                    headerFooter?.enabled ? 'bg-accent-blue' : dm ? 'bg-zinc-600' : 'bg-zinc-300'
                  }`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform ${headerFooter?.enabled ? 'translate-x-3' : ''}`} />
                </button>
              </div>
              <p className={`text-[9px] ${dm ? 'text-zinc-600' : 'text-zinc-400'}`}>{projectName} — {nuggetName} | page | date</p>

              {headerFooter?.enabled && (
                <div className="pt-1">
                  <BrandSlider
                    label="Font size"
                    value={headerFooter.fontSize ?? 1.2}
                    min={0.8}
                    max={2.5}
                    step={0.1}
                    suffix="%"
                    onChange={(v) => onUpdateHeaderFooter?.({ ...headerFooter, fontSize: Number(v.toFixed(1)) })}
                    darkMode={dm}
                  />
                </div>
              )}
            </div>

            {/* Export actions */}
            {selectedFolder && (
              <div className="px-4 py-3 space-y-2">
                <label className={`text-[10px] font-semibold uppercase tracking-wider ${dm ? 'text-zinc-500' : 'text-zinc-400'}`}>
                  Export
                </label>

                {/* Progress */}
                {progress && (
                  <div className={`text-[10px] font-medium text-center ${dm ? 'text-zinc-400' : 'text-zinc-500'}`}>
                    Exporting {progress.fetched} of {progress.total}...
                  </div>
                )}

                <button
                  onClick={handleExportDocx}
                  disabled={!selectedFolder || !!isExporting}
                  className={`w-full px-3 py-2 rounded-md text-[11px] font-semibold transition-all disabled:opacity-40 flex items-center justify-center gap-1.5 ${
                    dm ? 'bg-zinc-700 text-zinc-200 hover:bg-zinc-600' : 'bg-zinc-200 text-zinc-700 hover:bg-zinc-300'
                  }`}
                >
                  {isExporting === 'docx' ? spinner : (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
                    </svg>
                  )}
                  DOCX
                </button>

                <button
                  onClick={() => handleExportImages('zip')}
                  disabled={selectedImageIds.size === 0 || !!isExporting}
                  className={`w-full px-3 py-2 rounded-md text-[11px] font-semibold transition-all disabled:opacity-40 flex items-center justify-center gap-1.5 ${
                    dm ? 'bg-zinc-700 text-zinc-200 hover:bg-zinc-600' : 'bg-zinc-200 text-zinc-700 hover:bg-zinc-300'
                  }`}
                >
                  {isExporting === 'zip' ? spinner : (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                  )}
                  ZIP
                </button>

                <button
                  onClick={() => handleExportImages('pdf')}
                  disabled={selectedImageIds.size === 0 || !!isExporting}
                  className="w-full px-3 py-2 rounded-md bg-accent-blue text-white text-[11px] font-semibold hover:brightness-110 transition-all disabled:opacity-40 flex items-center justify-center gap-1.5"
                >
                  {isExporting === 'pdf' ? spinner : (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" />
                    </svg>
                  )}
                  PDF
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ── Right: Cards ── */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          {/* Cards section header */}
          <div className="shrink-0 h-[36px] flex items-center gap-2 border-b border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-900">
            <div
              className="h-full w-[36px] shrink-0 flex items-center justify-center"
              style={{ backgroundColor: dm ? 'rgb(40,62,100)' : 'rgb(200,220,245)' }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-zinc-500 dark:text-zinc-400">
                <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
              </svg>
            </div>
            <span className="text-[13px] font-bold uppercase tracking-wider text-zinc-800 dark:text-zinc-200">Cards</span>
            {/* Selection toolbar inline */}
            {selectedFolder && totalImageCount > 0 && (
              <div className="flex-1 flex items-center justify-end gap-2 pr-3">
                <button
                  onClick={selectAllImages}
                  className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider transition-colors ${
                    dm ? 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800' : 'text-zinc-500 hover:text-zinc-700 hover:bg-zinc-100'
                  }`}
                >
                  Select All
                </button>
                <button
                  onClick={deselectAllImages}
                  className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider transition-colors ${
                    dm ? 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800' : 'text-zinc-500 hover:text-zinc-700 hover:bg-zinc-100'
                  }`}
                >
                  Deselect All
                </button>
                <span className={`text-[10px] font-medium ${dm ? 'text-zinc-500' : 'text-zinc-400'}`}>
                  {selectedImageIds.size}/{totalImageCount}
                </span>
              </div>
            )}
          </div>

          {/* Cards content — scrollable */}
          <div className="flex-1 overflow-y-auto min-h-0 px-4 py-3" style={{ scrollbarWidth: 'thin' }}>
            {!selectedFolder ? (
              <div className="text-center py-10">
                <p className={`text-[13px] ${dm ? 'text-zinc-500' : 'text-zinc-400'}`}>
                  Select a folder to compose exports.
                </p>
              </div>
            ) : folderCards.length === 0 ? (
              <div className="text-center py-10">
                <p className={`text-[13px] ${dm ? 'text-zinc-500' : 'text-zinc-400'}`}>
                  This folder has no cards.
                </p>
              </div>
            ) : (
              <CardImageGrid
                cards={folderCards}
                selectedImageIds={selectedImageIds}
                toggleImage={toggleImage}
                darkMode={dm}
                branding={branding}
                onUpdateBranding={onUpdateBranding}
                headerFooter={headerFooter}
                projectName={projectName}
                nuggetName={nuggetName}
              />
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
