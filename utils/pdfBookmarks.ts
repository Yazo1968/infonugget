import type { PDFRef } from 'pdf-lib';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { BookmarkNode, Heading } from '../types';
import { createLogger } from './logger';

const log = createLogger('PdfBookmarks');

// ── Extraction from pdf.js ──

/**
 * Extract bookmarks (outline) from a pdf.js PDFDocumentProxy.
 * Returns a nested BookmarkNode[] tree, or empty array if no outline exists.
 */
export async function extractBookmarksFromPdf(pdfDocument: PDFDocumentProxy): Promise<BookmarkNode[]> {
  try {
    const outline = await pdfDocument.getOutline();
    if (!outline || outline.length === 0) return [];

    const resolvePageNumber = async (item: any): Promise<number> => {
      try {
        if (item.dest) {
          // dest can be a string (named destination) or an array [pageRef, ...]
          const dest = typeof item.dest === 'string' ? await pdfDocument.getDestination(item.dest) : item.dest;
          if (dest && dest[0]) {
            const pageIndex = await pdfDocument.getPageIndex(dest[0]);
            return pageIndex + 1; // 1-based page numbers
          }
        }
      } catch {
        // Fallback: page 1 if destination can't be resolved
      }
      return 1;
    };

    const buildTree = async (items: any[], level: number): Promise<BookmarkNode[]> => {
      const nodes: BookmarkNode[] = [];
      for (const item of items) {
        const page = await resolvePageNumber(item);
        const children = item.items && item.items.length > 0 ? await buildTree(item.items, level + 1) : [];
        nodes.push({
          id: crypto.randomUUID(),
          title: item.title || 'Untitled',
          page,
          level,
          children,
        });
      }
      return nodes;
    };

    return buildTree(outline, 1);
  } catch (err) {
    log.warn('Failed to extract bookmarks from PDF:', err);
    return [];
  }
}

// ── Conversion utilities ──

/**
 * Flatten a nested BookmarkNode[] tree into a flat Heading[] array.
 * Preserves all existing consumers (TOC display, card generation section hints).
 */
export function flattenBookmarks(bookmarks: BookmarkNode[]): Heading[] {
  const result: Heading[] = [];
  const walk = (nodes: BookmarkNode[]) => {
    for (const node of nodes) {
      result.push({
        level: node.level,
        text: node.title,
        id: node.id,
        selected: false,
        page: node.page,
        wordCount: node.wordCount,
      });
      if (node.children.length > 0) walk(node.children);
    }
  };
  walk(bookmarks);
  return result;
}

/**
 * Convert a flat Heading[] array into a nested BookmarkNode[] tree.
 * Used for migrating existing documents that only have flat headings.
 * Builds hierarchy based on heading levels.
 */
export function headingsToBookmarks(headings: Heading[]): BookmarkNode[] {
  if (headings.length === 0) return [];

  const root: BookmarkNode[] = [];
  // Stack tracks the current nesting path: [level, children-array]
  const stack: { level: number; children: BookmarkNode[] }[] = [{ level: 0, children: root }];

  for (const h of headings) {
    const node: BookmarkNode = {
      id: h.id || crypto.randomUUID(),
      title: h.text,
      page: h.page ?? 1,
      level: h.level,
      children: [],
      wordCount: h.wordCount,
    };

    // Pop stack until we find a parent with a lower level
    while (stack.length > 1 && stack[stack.length - 1].level >= h.level) {
      stack.pop();
    }

    // Append to the current parent's children
    stack[stack.length - 1].children.push(node);
    // Push this node so deeper items can nest under it
    stack.push({ level: h.level, children: node.children });
  }

  return root;
}

// ── AI system prompt builder ──

/**
 * Build a TOC string for injection into Claude's system prompt.
 * Produces indented `- Title (page N)` with nesting reflecting hierarchy.
 */
export function buildTocSystemPrompt(bookmarks: BookmarkNode[], docName: string, totalPages?: number): string {
  if (bookmarks.length === 0) return '';

  const lines: string[] = [];
  lines.push(`Table of Contents for "${docName}"${totalPages ? ` (${totalPages} pages)` : ''}:`);
  lines.push('');

  const walk = (nodes: BookmarkNode[], indent: number) => {
    for (const node of nodes) {
      const prefix = '  '.repeat(indent);
      lines.push(`${prefix}- ${node.title} (page ${node.page})`);
      if (node.children.length > 0) walk(node.children, indent + 1);
    }
  };
  walk(bookmarks, 0);

  return lines.join('\n');
}

// ── Write bookmarks into PDF (vendored pdf-lib logic) ──

/**
 * Encode a Uint8Array to base64 using chunked encoding.
 * Avoids stack overflow from btoa(String.fromCharCode(...spread)) on large PDFs.
 */
function uint8ArrayToBase64(bytes: Uint8Array): string {
  const CHUNK_SIZE = 8192;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const chunk = bytes.subarray(i, Math.min(i + CHUNK_SIZE, bytes.length));
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return btoa(binary);
}

/**
 * Decode a base64 string to Uint8Array.
 */
export function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Write bookmarks (outlines) into a PDF and return the new PDF as base64.
 * Uses pdf-lib to create a proper PDF outline tree.
 */
export async function writeBookmarksToPdf(pdfBase64: string, bookmarks: BookmarkNode[]): Promise<string> {
  if (bookmarks.length === 0) return pdfBase64;

  const { PDFDocument, PDFName, PDFString, PDFArray, PDFRef, PDFNumber } = await import('pdf-lib');

  const pdfBytes = base64ToUint8Array(pdfBase64);
  const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const pages = pdfDoc.getPages();
  const context = pdfDoc.context;

  // Helper: get page ref for a 1-based page number
  const getPageRef = (pageNum: number): PDFRef => {
    const idx = Math.max(0, Math.min(pageNum - 1, pages.length - 1));
    return pages[idx].ref;
  };

  // Flatten bookmarks into ordered list with refs for building linked list
  interface OutlineEntry {
    node: BookmarkNode;
    ref: PDFRef;
    parentRef: PDFRef | null;
    children: OutlineEntry[];
  }

  const outlinesRef = context.nextRef();

  // Build outline entries recursively
  const buildEntries = (nodes: BookmarkNode[], parentRef: PDFRef): OutlineEntry[] => {
    return nodes.map((node) => {
      const ref = context.nextRef();
      const entry: OutlineEntry = { node, ref, parentRef, children: [] };
      entry.children = buildEntries(node.children, ref);
      return entry;
    });
  };

  const topEntries = buildEntries(bookmarks, outlinesRef);

  // Count all entries recursively
  const countAll = (entries: OutlineEntry[]): number => {
    let n = entries.length;
    for (const e of entries) n += countAll(e.children);
    return n;
  };

  // Create outline dict for each entry
  const createOutlineItems = (entries: OutlineEntry[], parentRef: PDFRef) => {
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const dict = context.obj({});

      dict.set(PDFName.of('Title'), PDFString.of(entry.node.title));
      dict.set(PDFName.of('Parent'), parentRef);

      // Destination: [pageRef, /Fit]
      const dest = PDFArray.withContext(context);
      dest.push(getPageRef(entry.node.page));
      dest.push(PDFName.of('Fit'));
      dict.set(PDFName.of('Dest'), dest);

      // Prev/Next siblings
      if (i > 0) {
        dict.set(PDFName.of('Prev'), entries[i - 1].ref);
      }
      if (i < entries.length - 1) {
        dict.set(PDFName.of('Next'), entries[i + 1].ref);
      }

      // Children
      if (entry.children.length > 0) {
        dict.set(PDFName.of('First'), entry.children[0].ref);
        dict.set(PDFName.of('Last'), entry.children[entry.children.length - 1].ref);
        // Negative count = closed by default
        dict.set(PDFName.of('Count'), PDFNumber.of(-entry.children.length));
        createOutlineItems(entry.children, entry.ref);
      }

      context.assign(entry.ref, dict);
    }
  };

  createOutlineItems(topEntries, outlinesRef);

  // Create root Outlines dict
  const outlinesDict = context.obj({});
  outlinesDict.set(PDFName.of('Type'), PDFName.of('Outlines'));
  if (topEntries.length > 0) {
    outlinesDict.set(PDFName.of('First'), topEntries[0].ref);
    outlinesDict.set(PDFName.of('Last'), topEntries[topEntries.length - 1].ref);
  }
  outlinesDict.set(PDFName.of('Count'), PDFNumber.of(countAll(topEntries)));
  context.assign(outlinesRef, outlinesDict);

  // Set outlines on the document catalog
  const catalog = pdfDoc.catalog;
  catalog.set(PDFName.of('Outlines'), outlinesRef);

  const savedBytes = await pdfDoc.save();
  return uint8ArrayToBase64(new Uint8Array(savedBytes));
}

// ── Tree counting ──

/** Count all bookmarks recursively. */
export function countBookmarks(nodes: BookmarkNode[]): number {
  let count = nodes.length;
  for (const n of nodes) count += countBookmarks(n.children);
  return count;
}
