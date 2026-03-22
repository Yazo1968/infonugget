/**
 * Export selected card images as a PDF document.
 * Each image is placed full-bleed on its own page.
 * Optional header/footer overlaid on top of the image when settings are provided.
 */
import { jsPDF } from 'jspdf';
import type { ExportImageItem } from './exportImages';
import type { HeaderFooterSettings } from '../types';

/** Fetch an image URL and return it as a base64 data URL with its dimensions. */
async function fetchImageAsBase64(url: string): Promise<{ dataUrl: string; width: number; height: number }> {
  let dataUrl: string;

  if (url.startsWith('data:')) {
    dataUrl = url;
  } else {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    const mime = blob.type || 'image/jpeg';
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);
    dataUrl = `data:${mime};base64,${base64}`;
  }

  const { width, height } = await new Promise<{ width: number; height: number }>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('Failed to decode image'));
    img.src = dataUrl;
  });

  return { dataUrl, width, height };
}

function getFormat(dataUrl: string): string {
  if (dataUrl.includes('image/png')) return 'PNG';
  if (dataUrl.includes('image/webp')) return 'WEBP';
  return 'JPEG';
}

function sanitizeFilename(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, '_').trim();
}

function formatDate(): string {
  const d = new Date();
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

// Overlay positions (percentage of page height/width)
const HEADER_PAD_X = 5; // mm from edge
const HEADER_Y = 5;     // mm from top
const FOOTER_LINE_OFFSET = 8; // mm from bottom

/** Convert font size from % of image width to jsPDF pt. */
function fontSizePt(pct: number, pageWMm: number): number {
  const mm = pageWMm * pct / 100;
  return mm / 0.353; // 1pt = 0.353mm
}

/** Render footer overlaid on the image: left (project — nugget), center (page), right (date). */
function renderFooter(
  doc: jsPDF,
  hf: HeaderFooterSettings,
  pageW: number,
  pageH: number,
  pageNum: number,
  totalPages: number,
  projectName: string,
  nuggetName: string,
): void {
  const pad = pageW * 0.02;
  const fsPt = fontSizePt(hf.fontSize ?? 1.2, pageW);
  const footerY = pageH - pad;

  doc.setFontSize(fsPt);
  doc.setTextColor(120, 120, 120);
  doc.setFont('helvetica', 'normal');

  // Left: project — nugget
  const leftText = `${projectName} — ${nuggetName}`;
  doc.text(leftText, pad, footerY);

  // Center: page number
  const pageStr = `${pageNum} of ${totalPages}`;
  const pageStrWidth = doc.getTextWidth(pageStr);
  doc.text(pageStr, (pageW - pageStrWidth) / 2, footerY);

  // Right: date
  const dateStr = formatDate();
  const dateWidth = doc.getTextWidth(dateStr);
  doc.text(dateStr, pageW - pad - dateWidth, footerY);
}

export async function exportImagesToPdf(params: {
  folderName: string;
  images: ExportImageItem[];
  onProgress?: (fetched: number, total: number) => void;
  headerFooter?: HeaderFooterSettings;
  projectName?: string;
  nuggetName?: string;
}): Promise<number> {
  const { folderName, images, onProgress, headerFooter, projectName = '', nuggetName = '' } = params;
  if (images.length === 0) return 0;

  const hasHF = headerFooter?.enabled;

  let doc: jsPDF | null = null;
  let fetched = 0;
  let succeeded = 0;

  // First pass: fetch all images
  const loaded: { dataUrl: string; width: number; height: number; format: string }[] = [];
  for (let i = 0; i < images.length; i++) {
    try {
      const { dataUrl, width, height } = await fetchImageAsBase64(images[i].imageUrl);
      loaded.push({ dataUrl, width, height, format: getFormat(dataUrl) });
    } catch (err) {
      console.warn(`Failed to fetch image for "${images[i].cardTitle}":`, err);
    }
    fetched++;
    onProgress?.(fetched, images.length);
  }

  if (loaded.length === 0) throw new Error('All image downloads failed');

  const totalPages = loaded.length;
  const pxToMm = 0.264583;

  for (let i = 0; i < loaded.length; i++) {
    const { dataUrl, width, height, format } = loaded[i];

    const imgWidthMm = width * pxToMm;
    const imgHeightMm = height * pxToMm;
    const orientation = width >= height ? 'landscape' : 'portrait';

    if (!doc) {
      doc = new jsPDF({ orientation, unit: 'mm', format: [imgWidthMm, imgHeightMm] });
    } else {
      doc.addPage([imgWidthMm, imgHeightMm], orientation);
    }

    // Full-bleed image
    doc.addImage(dataUrl, format, 0, 0, imgWidthMm, imgHeightMm);

    // Overlay footer on top of image
    if (hasHF) {
      renderFooter(doc, headerFooter!, imgWidthMm, imgHeightMm, i + 1, totalPages, projectName, nuggetName);
    }

    succeeded++;
  }

  if (!doc || succeeded === 0) throw new Error('All image downloads failed');

  doc.save(`${sanitizeFilename(folderName)}_images.pdf`);
  return succeeded;
}
