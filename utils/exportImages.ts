/**
 * Export selected card images as a ZIP archive.
 * Fetches image URLs, bundles into a ZIP via JSZip, and triggers download.
 */
import JSZip from 'jszip';
import { saveAs } from 'file-saver';

export interface ExportImageItem {
  cardTitle: string;
  detailLevel: string;
  label: string;
  imageUrl: string;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, '_').trim();
}

/** Derive file extension from URL path or blob MIME type. */
function getExtension(url: string, blob: Blob): string {
  // Try URL path first
  const urlPath = url.split('?')[0];
  const match = urlPath.match(/\.(png|jpg|jpeg|webp|gif|svg)$/i);
  if (match) return match[1].toLowerCase();

  // Fall back to MIME type
  const mimeMap: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/svg+xml': 'svg',
  };
  return mimeMap[blob.type] || 'png';
}

/** Deduplicate a filename within a set, appending _2, _3, etc. */
function dedupeFilename(name: string, used: Set<string>): string {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  const dotIdx = name.lastIndexOf('.');
  const base = dotIdx > 0 ? name.slice(0, dotIdx) : name;
  const ext = dotIdx > 0 ? name.slice(dotIdx) : '';
  let counter = 2;
  while (used.has(`${base}_${counter}${ext}`)) counter++;
  const deduped = `${base}_${counter}${ext}`;
  used.add(deduped);
  return deduped;
}

export async function exportImagesToZip(params: {
  folderName: string;
  images: ExportImageItem[];
  onProgress?: (fetched: number, total: number) => void;
}): Promise<number> {
  const { folderName, images, onProgress } = params;
  if (images.length === 0) return 0;

  const zip = new JSZip();
  const usedNames = new Set<string>();
  let fetched = 0;
  let succeeded = 0;

  const results = await Promise.allSettled(
    images.map(async (item) => {
      const response = await fetch(item.imageUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const ext = getExtension(item.imageUrl, blob);
      const rawName = `${sanitizeFilename(item.cardTitle)}_${item.detailLevel}_${sanitizeFilename(item.label)}.${ext}`;
      const filename = dedupeFilename(rawName, usedNames);
      zip.file(filename, blob);
      fetched++;
      onProgress?.(fetched, images.length);
      return filename;
    }),
  );

  succeeded = results.filter((r) => r.status === 'fulfilled').length;
  if (succeeded === 0) throw new Error('All image downloads failed');

  const blob = await zip.generateAsync({ type: 'blob' });
  saveAs(blob, `${sanitizeFilename(folderName)}_images.zip`);
  return succeeded;
}
