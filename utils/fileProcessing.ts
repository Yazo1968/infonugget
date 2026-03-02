import { Heading, UploadedFile } from '../types';
import { getGeminiAI, withGeminiRetry } from './ai';
import { parseMarkdownStructure } from './markdown';
import { HEADING_EXTRACTION_PROMPT, PDF_CONVERSION_PROMPT } from './prompts/documentConversion';

// ── Helpers ──

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
  });
}

/**
 * Create a placeholder UploadedFile immediately from a File object.
 * Shows in the UI right away while the actual conversion runs.
 */
export function createPlaceholderDocument(file: File): UploadedFile {
  return {
    id: crypto.randomUUID(),
    name: file.name,
    size: file.size,
    type: file.type,
    lastModified: file.lastModified,
    status: 'processing',
    progress: 0,
  };
}

// ── Gemini PDF Conversion ──

/**
 * Convert a PDF to well-structured Markdown via Gemini Flash.
 * Handles text, tables, charts (→ markdown tables), diagrams (→ descriptions).
 */
async function convertPdfWithGemini(file: File): Promise<string> {
  const base64 = await fileToBase64(file);
  console.debug(`[FileProcessing] PDF base64 ready (${base64.length} chars), sending to Gemini Flash…`);

  const response = await withGeminiRetry(async () => {
    const ai = await getGeminiAI();
    return await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        { parts: [{ inlineData: { data: base64, mimeType: 'application/pdf' } }, { text: PDF_CONVERSION_PROMPT }] },
      ],
      config: { httpOptions: { timeout: 300000 } },
    });
  });

  // Filter out thinking parts (Gemini 2.5 may include thought tokens)
  const text =
    response.candidates?.[0]?.content?.parts
      ?.filter((p: any) => p.text && !p.thought)
      .map((p: any) => p.text)
      .join('') || '';

  console.debug(`[FileProcessing] Gemini conversion complete (${text.length} chars)`);
  return text;
}

// ── Main Conversion Pipeline ──

/**
 * Full conversion pipeline:
 * - MD: passthrough (read text directly, no API call)
 * - PDF: converted to Markdown via Gemini Flash
 */
export async function processFileToDocument(file: File, id?: string): Promise<UploadedFile> {
  const isMd = file.name.endsWith('.md') || file.type === 'text/markdown';
  const isPdf = file.name.endsWith('.pdf') || file.type === 'application/pdf';

  let markdown = '';

  if (isMd) {
    markdown = await file.text();
  } else if (isPdf) {
    markdown = await convertPdfWithGemini(file);
  } else {
    throw new Error(`Unsupported file type: ${file.name}`);
  }

  const structure = parseMarkdownStructure(markdown);

  return {
    id: id ?? crypto.randomUUID(),
    name: file.name,
    size: file.size,
    type: file.type,
    lastModified: file.lastModified,
    content: markdown,
    structure,
    status: 'ready',
    progress: 100,
    originalFormat: isMd ? 'md' : 'pdf',
    createdAt: Date.now(),
    originalName: file.name,
    version: 1,
    sourceOrigin: { type: 'uploaded' as const, timestamp: Date.now() },
  };
}

// ── Gemini Heading + Word Count Extraction (for native PDF path) ──

/**
 * Extract heading/bookmark structure + per-section word counts from a PDF via Gemini Flash.
 * Returns Heading[] with page numbers and word counts, or empty array on failure.
 * Used by PdfProcessorModal for the single Gemini-only extraction path.
 */
export async function extractHeadingsWithGemini(base64: string, fileName: string): Promise<Heading[]> {
  try {
    console.debug(`[FileProcessing] Extracting headings + word counts via Gemini Flash for "${fileName}"...`);

    const response = await withGeminiRetry(async () => {
      const ai = await getGeminiAI();
      return await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [
          {
            parts: [{ inlineData: { data: base64, mimeType: 'application/pdf' } }, { text: HEADING_EXTRACTION_PROMPT }],
          },
        ],
        config: { httpOptions: { timeout: 300000 } },
      });
    });

    // Filter out thinking parts (Gemini 2.5 may include thought tokens)
    const text =
      response.candidates?.[0]?.content?.parts
        ?.filter((p: any) => p.text && !p.thought)
        .map((p: any) => p.text)
        .join('') || '';

    console.debug(`[FileProcessing] Gemini heading response (${text.length} chars)`);

    // Parse JSON response — Gemini may wrap it in markdown fences
    const cleaned = text
      .replace(/```(?:json)?\s*/g, '')
      .replace(/```\s*/g, '')
      .trim();
    const arrayMatch = cleaned.match(/\[[\s\S]*\]/);

    if (!arrayMatch) {
      console.warn('[FileProcessing] No heading array found in Gemini response. Raw:', text.substring(0, 500));
      return [];
    }

    const parsed = JSON.parse(arrayMatch[0]) as Array<{ level: number; title: string; page?: number; wordCount?: number }>;
    const headings: Heading[] = parsed.map((entry, i) => ({
      level: entry.level,
      text: entry.title,
      id: `h-${i}-${Math.random().toString(36).substr(2, 4)}`,
      selected: false,
      page: entry.page,
      wordCount: typeof entry.wordCount === 'number' ? entry.wordCount : undefined,
    }));

    console.debug(`[FileProcessing] Gemini heading extraction: ${headings.length} headings from "${fileName}"`);
    return headings;
  } catch (err) {
    console.warn('[FileProcessing] Gemini heading extraction failed:', err);
    return [];
  }
}

// ── Utilities ──

/**
 * Convert a base64 string to a Blob. Useful for re-uploading native PDFs.
 */
export function base64ToBlob(base64: string, mimeType: string = 'application/pdf'): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}
