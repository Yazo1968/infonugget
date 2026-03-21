/**
 * Export selected card images as a PDF document.
 * Each image is placed on its own page, sized to match its native aspect ratio.
 */
import { jsPDF } from 'jspdf';
import type { ExportImageItem } from './exportImages';

/** Fetch an image URL and return it as a base64 data URL with its dimensions. */
async function fetchImageAsBase64(url: string): Promise<{ dataUrl: string; width: number; height: number }> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const blob = await response.blob();

  // Get MIME type
  const mime = blob.type || 'image/jpeg';

  // Convert to base64
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);
  const dataUrl = `data:${mime};base64,${base64}`;

  // Get image dimensions
  const { width, height } = await new Promise<{ width: number; height: number }>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('Failed to decode image'));
    img.src = dataUrl;
  });

  return { dataUrl, width, height };
}

/** Get jsPDF-compatible format string from MIME type. */
function getFormat(dataUrl: string): string {
  if (dataUrl.includes('image/png')) return 'PNG';
  if (dataUrl.includes('image/webp')) return 'WEBP';
  return 'JPEG';
}

function sanitizeFilename(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, '_').trim();
}

export async function exportImagesToPdf(params: {
  folderName: string;
  images: ExportImageItem[];
  onProgress?: (fetched: number, total: number) => void;
}): Promise<number> {
  const { folderName, images, onProgress } = params;
  if (images.length === 0) return 0;

  let doc: jsPDF | null = null;
  let fetched = 0;
  let succeeded = 0;

  for (let i = 0; i < images.length; i++) {
    const item = images[i];
    try {
      const { dataUrl, width, height } = await fetchImageAsBase64(item.imageUrl);
      const format = getFormat(dataUrl);

      // Convert pixel dimensions to mm (at 96 DPI: 1px = 0.264583mm)
      const pxToMm = 0.264583;
      const imgWidthMm = width * pxToMm;
      const imgHeightMm = height * pxToMm;

      // Determine page orientation based on image aspect ratio
      const orientation = width >= height ? 'landscape' : 'portrait';

      if (!doc) {
        // First page — create PDF with page size matching image
        doc = new jsPDF({
          orientation,
          unit: 'mm',
          format: [imgWidthMm, imgHeightMm],
        });
      } else {
        // Subsequent pages — add with matching dimensions
        doc.addPage([imgWidthMm, imgHeightMm], orientation);
      }

      // Place image full-bleed on the page
      doc.addImage(dataUrl, format, 0, 0, imgWidthMm, imgHeightMm);

      succeeded++;
    } catch (err) {
      console.warn(`Failed to fetch image for "${item.cardTitle}":`, err);
    }

    fetched++;
    onProgress?.(fetched, images.length);
  }

  if (!doc || succeeded === 0) throw new Error('All image downloads failed');

  doc.save(`${sanitizeFilename(folderName)}_images.pdf`);
  return succeeded;
}
