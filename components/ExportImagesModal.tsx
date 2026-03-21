import { useState, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { Card, CardFolder, DetailLevel, AlbumImage } from '../types';
import { exportImagesToZip, type ExportImageItem } from '../utils/exportImages';
import { exportImagesToPdf } from '../utils/exportImagesPdf';

interface ExportImagesModalProps {
  folder: CardFolder;
  darkMode: boolean;
  onClose: () => void;
}

/** Collect all album images from a card, keyed by detail level. */
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

/** Collect all image IDs from all cards in the folder. */
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

/** Get default selection: active image for each card's detail level. */
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

export default function ExportImagesModal({ folder, darkMode, onClose }: ExportImagesModalProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => getDefaultSelection(folder.cards));
  const [isExporting, setIsExporting] = useState<false | 'zip' | 'pdf'>(false);
  const [progress, setProgress] = useState<{ fetched: number; total: number } | null>(null);

  const allIds = useMemo(() => getAllImageIds(folder.cards), [folder.cards]);
  const totalCount = allIds.size;

  const toggleImage = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => setSelectedIds(new Set(allIds)), [allIds]);
  const deselectAll = useCallback(() => setSelectedIds(new Set()), []);

  /** Build export list from selected image IDs. */
  const buildExportList = useCallback((): ExportImageItem[] => {
    const items: ExportImageItem[] = [];
    for (const card of folder.cards) {
      if (!card.albumMap) continue;
      for (const [level, images] of Object.entries(card.albumMap)) {
        if (!images) continue;
        for (const img of images) {
          if (selectedIds.has(img.id)) {
            items.push({
              cardTitle: card.text,
              detailLevel: level,
              label: img.label,
              imageUrl: img.imageUrl,
            });
          }
        }
      }
    }
    return items;
  }, [selectedIds, folder.cards]);

  const handleExport = useCallback(async (format: 'zip' | 'pdf') => {
    if (selectedIds.size === 0) return;
    setIsExporting(format);
    setProgress({ fetched: 0, total: selectedIds.size });

    const items = buildExportList();

    try {
      const exportFn = format === 'zip' ? exportImagesToZip : exportImagesToPdf;
      const count = await exportFn({
        folderName: folder.name,
        images: items,
        onProgress: (fetched, total) => setProgress({ fetched, total }),
      });
      if (count < items.length) {
        console.warn(`Exported ${count} of ${items.length} images (${items.length - count} failed)`);
      }
      onClose();
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setIsExporting(false);
      setProgress(null);
    }
  }, [selectedIds, folder.name, buildExportList, onClose]);

  const dm = darkMode;

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" />

      {/* Modal card */}
      <div
        onClick={(e) => e.stopPropagation()}
        className={`relative z-10 w-full max-w-lg max-h-[80vh] flex flex-col rounded-xl shadow-2xl border ${
          dm ? 'bg-zinc-900 border-zinc-700' : 'bg-white border-zinc-200'
        }`}
      >
        {/* Header */}
        <div className={`flex items-center justify-between px-5 py-3.5 border-b shrink-0 ${
          dm ? 'border-zinc-700' : 'border-zinc-100'
        }`}>
          <div className="min-w-0 flex-1">
            <h2 className={`text-[14px] font-semibold truncate ${dm ? 'text-zinc-100' : 'text-zinc-900'}`}>
              Export Images
            </h2>
            <p className={`text-[11px] mt-0.5 truncate ${dm ? 'text-zinc-500' : 'text-zinc-400'}`}>
              {folder.name}
            </p>
          </div>
          <button
            onClick={onClose}
            className={`shrink-0 w-7 h-7 rounded-md flex items-center justify-center transition-colors ${
              dm ? 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800' : 'text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100'
            }`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Toolbar */}
        <div className={`flex items-center justify-between px-5 py-2.5 border-b shrink-0 ${
          dm ? 'border-zinc-800' : 'border-zinc-50'
        }`}>
          <div className="flex items-center gap-2">
            <button
              onClick={selectAll}
              className={`px-2 py-1 rounded text-[10px] font-semibold uppercase tracking-wider transition-colors ${
                dm ? 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800' : 'text-zinc-500 hover:text-zinc-700 hover:bg-zinc-100'
              }`}
            >
              Select All
            </button>
            <button
              onClick={deselectAll}
              className={`px-2 py-1 rounded text-[10px] font-semibold uppercase tracking-wider transition-colors ${
                dm ? 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800' : 'text-zinc-500 hover:text-zinc-700 hover:bg-zinc-100'
              }`}
            >
              Deselect All
            </button>
          </div>
          <span className={`text-[11px] font-medium ${dm ? 'text-zinc-500' : 'text-zinc-400'}`}>
            {selectedIds.size} of {totalCount} selected
          </span>
        </div>

        {/* Body — scrollable card list */}
        <div className="flex-1 overflow-y-auto px-5 py-3" style={{ scrollbarWidth: 'thin' }}>
          {totalCount === 0 ? (
            <div className="text-center py-10">
              <p className={`text-[13px] ${dm ? 'text-zinc-500' : 'text-zinc-400'}`}>
                No images have been generated for cards in this folder.
              </p>
            </div>
          ) : (
            folder.cards.map((card) => {
              const albums = getCardAlbums(card);
              const hasImages = albums.length > 0;

              return (
                <div key={card.id} className={`mb-4 last:mb-0 ${!hasImages ? 'opacity-50' : ''}`}>
                  {/* Card header */}
                  <div className="flex items-center gap-2 mb-2">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={dm ? 'text-zinc-600' : 'text-zinc-300'}>
                      <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18" />
                    </svg>
                    <span className={`text-[12px] font-semibold truncate ${dm ? 'text-zinc-200' : 'text-zinc-800'}`}>
                      {card.text}
                    </span>
                    {!hasImages && (
                      <span className={`text-[10px] italic ml-auto ${dm ? 'text-zinc-600' : 'text-zinc-400'}`}>
                        No images
                      </span>
                    )}
                  </div>

                  {/* Detail level groups */}
                  {albums.map(({ level, images }) => (
                    <div key={level} className="ml-5 mb-2 last:mb-0">
                      <span className={`text-[10px] font-medium uppercase tracking-wider ${dm ? 'text-zinc-500' : 'text-zinc-400'}`}>
                        {level}
                      </span>
                      <div className="flex flex-wrap gap-2 mt-1.5">
                        {images.map((img) => {
                          const isSelected = selectedIds.has(img.id);
                          return (
                            <button
                              key={img.id}
                              onClick={() => toggleImage(img.id)}
                              className={`relative w-[76px] h-[76px] rounded-lg overflow-hidden border-2 transition-all ${
                                isSelected
                                  ? 'border-accent-blue shadow-md'
                                  : dm
                                    ? 'border-zinc-700 hover:border-zinc-500'
                                    : 'border-zinc-200 hover:border-zinc-300'
                              }`}
                              title={img.label}
                            >
                              <img
                                src={img.imageUrl}
                                alt={img.label}
                                className="w-full h-full object-cover"
                                loading="lazy"
                              />
                              {/* Checkbox overlay */}
                              <div className={`absolute top-1 right-1 w-4 h-4 rounded-sm flex items-center justify-center text-white text-[10px] ${
                                isSelected ? 'bg-accent-blue' : dm ? 'bg-black/40' : 'bg-black/20'
                              }`}>
                                {isSelected && (
                                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="20 6 9 17 4 12" />
                                  </svg>
                                )}
                              </div>
                              {/* Active image indicator */}
                              {img.isActive && (
                                <div className="absolute bottom-1 left-1 w-2 h-2 rounded-full bg-accent-blue ring-1 ring-white/50" />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className={`flex items-center justify-between px-5 py-3 border-t shrink-0 ${
          dm ? 'border-zinc-700' : 'border-zinc-100'
        }`}>
          <button
            onClick={onClose}
            disabled={!!isExporting}
            className={`px-3 py-1.5 rounded-md text-[11px] font-medium transition-colors ${
              dm
                ? 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
                : 'text-zinc-500 hover:text-zinc-700 hover:bg-zinc-100'
            }`}
          >
            Cancel
          </button>
          <div className="flex items-center gap-2">
            {/* Download ZIP button */}
            <button
              onClick={() => handleExport('zip')}
              disabled={selectedIds.size === 0 || !!isExporting}
              className={`px-4 py-1.5 rounded-md text-[11px] font-semibold transition-all disabled:opacity-40 flex items-center gap-2 ${
                dm
                  ? 'bg-zinc-700 text-zinc-200 hover:bg-zinc-600'
                  : 'bg-zinc-200 text-zinc-700 hover:bg-zinc-300'
              }`}
            >
              {isExporting === 'zip' ? (
                <>
                  <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                    <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-75" />
                  </svg>
                  {progress ? `${progress.fetched}/${progress.total}` : 'Exporting...'}
                </>
              ) : (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  ZIP
                </>
              )}
            </button>
            {/* Download PDF button */}
            <button
              onClick={() => handleExport('pdf')}
              disabled={selectedIds.size === 0 || !!isExporting}
              className="px-4 py-1.5 rounded-md bg-accent-blue text-white text-[11px] font-semibold hover:brightness-110 transition-all disabled:opacity-40 flex items-center gap-2"
            >
              {isExporting === 'pdf' ? (
                <>
                  <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                    <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-75" />
                  </svg>
                  {progress ? `${progress.fetched}/${progress.total}` : 'Exporting...'}
                </>
              ) : (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" />
                  </svg>
                  PDF
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
