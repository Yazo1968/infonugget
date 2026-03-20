/**
 * DocViz Word export — converts document markdown to DOCX with
 * AI-generated visuals inserted at matching section locations.
 *
 * Flow:
 *   1. Parse markdown into sections by heading
 *   2. Match DocViz proposals to sections via section_ref
 *   3. Insert each section's content + matching visual image + caption
 *   4. Skip proposals without generated images
 */
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  ImageRun,
  HeadingLevel,
  AlignmentType,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  ShadingType,
  Header,
  Footer,
  PageNumber,
  NumberFormat,
  convertInchesToTwip,
  Tab,
  TabStopType,
  TabStopPosition,
} from 'docx';
import { saveAs } from 'file-saver';
import type { DocVizProposal } from '../types';
import { createLogger } from './logger';

const log = createLogger('ExportDocViz');

// ── Style constants ──

const META_FONT = 'Calibri';
const CONTENT_FONT = 'Cambria';
const H1_SIZE = 32;    // 16pt
const H2_SIZE = 28;    // 14pt
const H3_SIZE = 26;    // 13pt
const H4_SIZE = 24;    // 12pt
const BODY_FONT_SIZE = 22; // 11pt
const META_FONT_SIZE = 17; // 8.5pt
const SMALL_SIZE = 16;     // 8pt
const ACCENT_COLOR = '2B579A';
const LABEL_COLOR = '666666';
const MUTED_COLOR = '999999';
const CAPTION_COLOR = '444444';
const TABLE_BORDER_COLOR = 'BFBFBF';
const TABLE_HEADER_BG = { type: ShadingType.SOLID, color: 'E8EDF3', fill: 'E8EDF3' } as const;
const TABLE_ALT_BG = { type: ShadingType.SOLID, color: 'F8F9FA', fill: 'F8F9FA' } as const;

const TABLE_BORDER = {
  style: BorderStyle.SINGLE,
  size: 1,
  color: TABLE_BORDER_COLOR,
};

const TABLE_CELL_BORDERS = {
  top: TABLE_BORDER,
  bottom: TABLE_BORDER,
  left: TABLE_BORDER,
  right: TABLE_BORDER,
};

const CELL_MARGINS = {
  top: convertInchesToTwip(0.04),
  bottom: convertInchesToTwip(0.04),
  left: convertInchesToTwip(0.08),
  right: convertInchesToTwip(0.08),
};

// ── Helpers ──

function sanitizeFilename(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, '_').trim();
}

function thickRule(): Paragraph {
  return new Paragraph({
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: ACCENT_COLOR } },
    spacing: { before: 300, after: 300 },
  });
}

function thinRule(): Paragraph {
  return new Paragraph({
    border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: 'D0D0D0' } },
    spacing: { before: 160, after: 160 },
  });
}

/**
 * Strip all markdown syntax from text, returning plain text.
 * Handles: **bold**, *italic*, __bold__, _italic_, ~~strike~~,
 * `code`, [links](url), ![images](url), HTML tags.
 */
function stripMarkdown(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')     // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')       // links
    .replace(/`([^`]+)`/g, '$1')                   // inline code
    .replace(/~~(.+?)~~/g, '$1')                   // strikethrough
    .replace(/\*\*\*(.+?)\*\*\*/g, '$1')           // bold+italic
    .replace(/___(.+?)___/g, '$1')                  // bold+italic alt
    .replace(/\*\*(.+?)\*\*/g, '$1')               // bold
    .replace(/__(.+?)__/g, '$1')                    // bold alt
    .replace(/\*(.+?)\*/g, '$1')                    // italic
    .replace(/_(.+?)_/g, '$1')                      // italic alt
    .replace(/<[^>]+>/g, '')                         // HTML tags
    .trim();
}

/**
 * Parse inline markdown formatting to TextRun array.
 * Handles: **bold**, *italic*, `code`, [links](url), ~~strikethrough~~, plain text.
 */
function parseInlineFormatting(text: string, font = CONTENT_FONT, size = BODY_FONT_SIZE): TextRun[] {
  const runs: TextRun[] = [];

  // Combined regex for all inline formatting
  const regex = /(\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*|~~(.+?)~~|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    // Plain text before this match
    if (match.index > lastIndex) {
      const plain = text.slice(lastIndex, match.index);
      if (plain) runs.push(new TextRun({ text: plain, size, font }));
    }

    if (match[2]) {
      // ***bold+italic***
      runs.push(new TextRun({ text: match[2], bold: true, italics: true, size, font }));
    } else if (match[3]) {
      // **bold**
      runs.push(new TextRun({ text: match[3], bold: true, size, font }));
    } else if (match[4]) {
      // *italic*
      runs.push(new TextRun({ text: match[4], italics: true, size, font }));
    } else if (match[5]) {
      // ~~strikethrough~~
      runs.push(new TextRun({ text: match[5], strike: true, size, font, color: MUTED_COLOR }));
    } else if (match[6]) {
      // `inline code`
      runs.push(new TextRun({ text: match[6], font: 'Consolas', size: size - 2, color: '1A1A1A' }));
    } else if (match[7] && match[8]) {
      // [link text](url) — render as underlined blue text
      runs.push(new TextRun({ text: match[7], color: ACCENT_COLOR, underline: { type: 'single' }, size, font }));
    }

    lastIndex = regex.lastIndex;
  }

  // Remaining plain text
  if (lastIndex < text.length) {
    const remaining = text.slice(lastIndex);
    if (remaining) runs.push(new TextRun({ text: remaining, size, font }));
  }

  if (runs.length === 0) {
    runs.push(new TextRun({ text, size, font }));
  }

  return runs;
}

/** Parse a markdown table into rows of cells (strips separator rows). */
function parseMarkdownTable(lines: string[]): string[][] {
  return lines
    .filter((l) => !l.match(/^\s*\|[\s-:|]+\|\s*$/))
    .map((l) =>
      l.split('|').slice(1, -1).map((cell) => stripMarkdown(cell.trim())),
    );
}

/** Map markdown heading level (1-6) to docx HeadingLevel. */
function getHeadingLevel(level: number): (typeof HeadingLevel)[keyof typeof HeadingLevel] {
  switch (level) {
    case 1: return HeadingLevel.HEADING_1;
    case 2: return HeadingLevel.HEADING_2;
    case 3: return HeadingLevel.HEADING_3;
    case 4: return HeadingLevel.HEADING_4;
    case 5: return HeadingLevel.HEADING_5;
    default: return HeadingLevel.HEADING_6;
  }
}

/** Map heading level to font size. */
function getHeadingSize(level: number): number {
  switch (level) {
    case 1: return H1_SIZE;
    case 2: return H2_SIZE;
    case 3: return H3_SIZE;
    default: return H4_SIZE;
  }
}

/**
 * Convert markdown content to docx elements.
 * Handles: headings (1-6), bullets, nested bullets, numbered lists,
 * tables, blockquotes, horizontal rules, plain text with inline formatting.
 */
function markdownToDocxElements(md: string): (Paragraph | Table)[] {
  const elements: (Paragraph | Table)[] = [];
  const lines = md.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip empty lines
    if (trimmed === '') { i++; continue; }

    // Horizontal rule (---, ***, ___)
    if (/^[-*_]{3,}\s*$/.test(trimmed)) {
      elements.push(thinRule());
      i++; continue;
    }

    // Headings (# through ######)
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const headingText = stripMarkdown(headingMatch[2]);
      elements.push(new Paragraph({
        children: [new TextRun({
          text: headingText,
          bold: true,
          size: getHeadingSize(level),
          color: level <= 2 ? ACCENT_COLOR : '333333',
          font: CONTENT_FONT,
        })],
        heading: getHeadingLevel(level),
        spacing: { before: level === 1 ? 280 : level === 2 ? 240 : 160, after: level <= 2 ? 120 : 80 },
      }));
      i++; continue;
    }

    // Table
    if (trimmed.startsWith('|')) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        tableLines.push(lines[i].trim());
        i++;
      }
      const rows = parseMarkdownTable(tableLines);
      if (rows.length > 0) {
        const colCount = rows[0].length;
        const tableRows = rows.map((cells, rowIdx) =>
          new TableRow({
            children: cells.map((cell) =>
              new TableCell({
                children: [new Paragraph({
                  children: [new TextRun({
                    text: cell,
                    bold: rowIdx === 0,
                    size: BODY_FONT_SIZE,
                    font: rowIdx === 0 ? META_FONT : CONTENT_FONT,
                    color: rowIdx === 0 ? '1A1A1A' : '333333',
                  })],
                  spacing: { before: 30, after: 30 },
                })],
                width: { size: Math.floor(100 / colCount), type: WidthType.PERCENTAGE },
                borders: TABLE_CELL_BORDERS,
                margins: CELL_MARGINS,
                shading: rowIdx === 0 ? TABLE_HEADER_BG : rowIdx % 2 === 0 ? TABLE_ALT_BG : undefined,
              }),
            ),
          }),
        );
        elements.push(new Table({
          rows: tableRows,
          width: { size: 100, type: WidthType.PERCENTAGE },
        }));
        elements.push(new Paragraph({ text: '', spacing: { after: 120 } }));
      }
      continue;
    }

    // Blockquote (single or multi-line)
    if (trimmed.startsWith('> ')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('> ')) {
        quoteLines.push(lines[i].trim().slice(2));
        i++;
      }
      elements.push(new Paragraph({
        children: parseInlineFormatting(quoteLines.join(' '), CONTENT_FONT, BODY_FONT_SIZE).map(
          (run) => new TextRun({ ...run, italics: true, color: '555555' } as ConstructorParameters<typeof TextRun>[0]),
        ),
        indent: { left: convertInchesToTwip(0.4) },
        border: { left: { style: BorderStyle.SINGLE, size: 8, color: ACCENT_COLOR } },
        spacing: { before: 80, after: 80 },
      }));
      continue;
    }

    // Bullet (-, *, +)
    if (/^[-*+] /.test(trimmed)) {
      elements.push(new Paragraph({
        children: parseInlineFormatting(trimmed.slice(2)),
        bullet: { level: 0 },
        spacing: { before: 40, after: 40 },
      }));
      i++; continue;
    }

    // Nested bullet (2+ spaces + -, *, +)
    if (/^\s{2,}[-*+] /.test(line)) {
      const content = line.replace(/^\s+[-*+] /, '');
      const indent = line.match(/^(\s+)/)?.[1].length || 2;
      const level = Math.min(Math.floor(indent / 2), 3);
      elements.push(new Paragraph({
        children: parseInlineFormatting(content),
        bullet: { level },
        spacing: { before: 30, after: 30 },
      }));
      i++; continue;
    }

    // Numbered list
    const numberedMatch = trimmed.match(/^(\d+)\.\s+(.+)/);
    if (numberedMatch) {
      elements.push(new Paragraph({
        children: parseInlineFormatting(numberedMatch[2]),
        numbering: { reference: 'docviz-numbering', level: 0 },
        spacing: { before: 40, after: 40 },
      }));
      i++; continue;
    }

    // Code block (``` fenced)
    if (trimmed.startsWith('```')) {
      const codeLines: string[] = [];
      i++; // skip opening fence
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // skip closing fence

      for (const codeLine of codeLines) {
        elements.push(new Paragraph({
          children: [new TextRun({
            text: codeLine || ' ',
            font: 'Consolas',
            size: BODY_FONT_SIZE - 2,
            color: '1A1A1A',
          })],
          shading: { type: ShadingType.SOLID, color: 'F5F5F5', fill: 'F5F5F5' },
          indent: { left: convertInchesToTwip(0.2) },
          spacing: { before: 10, after: 10 },
        }));
      }
      elements.push(new Paragraph({ text: '', spacing: { after: 80 } }));
      continue;
    }

    // Plain text
    elements.push(new Paragraph({
      children: parseInlineFormatting(trimmed),
      spacing: { before: 60, after: 60 },
    }));
    i++;
  }

  return elements;
}

// ── Section parsing ──

interface MarkdownSection {
  heading: string;
  headingLevel: number;
  content: string;
  lineStart: number;
}

/** Split markdown into sections by heading. */
function splitIntoSections(markdown: string): MarkdownSection[] {
  const lines = markdown.split('\n');
  const sections: MarkdownSection[] = [];
  let currentSection: MarkdownSection | null = null;
  const contentLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);

    if (headingMatch) {
      if (currentSection) {
        currentSection.content = contentLines.join('\n');
        sections.push(currentSection);
        contentLines.length = 0;
      }
      currentSection = {
        heading: headingMatch[2].trim(),
        headingLevel: headingMatch[1].length,
        content: '',
        lineStart: i,
      };
    } else {
      contentLines.push(line);
    }
  }

  if (currentSection) {
    currentSection.content = contentLines.join('\n');
    sections.push(currentSection);
  }

  if (sections.length === 0 && markdown.trim()) {
    sections.push({ heading: '', headingLevel: 0, content: markdown, lineStart: 0 });
  }

  return sections;
}

/** Match a proposal's section_ref to a section heading using fuzzy matching. */
function findMatchingSection(proposal: DocVizProposal, sections: MarkdownSection[]): number {
  const ref = proposal.section_ref.toLowerCase().trim();

  // Exact match
  const exact = sections.findIndex((s) => s.heading.toLowerCase().trim() === ref);
  if (exact >= 0) return exact;

  // Contains match
  const contains = sections.findIndex((s) => {
    const h = s.heading.toLowerCase().trim();
    return h.includes(ref) || ref.includes(h);
  });
  if (contains >= 0) return contains;

  // Partial word overlap
  const refWords = ref.split(/\s+/).filter((w) => w.length > 3);
  let bestIdx = -1;
  let bestScore = 0;

  sections.forEach((s, idx) => {
    const hWords = s.heading.toLowerCase().split(/\s+/);
    const overlap = refWords.filter((w) => hWords.some((hw) => hw.includes(w) || w.includes(hw))).length;
    if (overlap > bestScore) {
      bestScore = overlap;
      bestIdx = idx;
    }
  });

  return bestScore >= 2 ? bestIdx : -1;
}

// ── Image fetching ──

async function fetchImageAsArrayBuffer(url: string): Promise<{ data: ArrayBuffer; width: number; height: number }> {
  const response = await fetch(url);
  const blob = await response.blob();
  const data = await blob.arrayBuffer();

  const dimensions = await new Promise<{ width: number; height: number }>((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 800, height: 600 });
    img.src = url;
  });

  return { data, ...dimensions };
}

/** Create the image paragraph + caption for a visual. */
function createVisualBlock(
  visual: DocVizProposal,
  cached: { data: ArrayBuffer; width: number; height: number },
  figureNumber: number,
): (Paragraph | Table)[] {
  const blocks: (Paragraph | Table)[] = [];

  // Calculate dimensions — fit within 5.5 inches (page width minus margins)
  const maxWidthPx = 528; // ~5.5 inches at 96dpi
  const scale = Math.min(1, maxWidthPx / cached.width);
  const imgWidth = Math.round(cached.width * scale);
  const imgHeight = Math.round(cached.height * scale);

  // Spacer
  blocks.push(new Paragraph({ text: '', spacing: { before: 240 } }));

  // Thin border frame around image area
  blocks.push(new Paragraph({
    children: [
      new ImageRun({
        data: cached.data,
        transformation: { width: imgWidth, height: imgHeight },
        type: 'png',
      }),
    ],
    alignment: AlignmentType.CENTER,
    spacing: { before: 60, after: 40 },
  }));

  // Caption — "Figure N: Title — Type"
  blocks.push(new Paragraph({
    children: [
      new TextRun({
        text: `Figure ${figureNumber}: `,
        bold: true,
        size: META_FONT_SIZE,
        color: CAPTION_COLOR,
        font: META_FONT,
      }),
      new TextRun({
        text: visual.visual_title,
        italics: true,
        size: META_FONT_SIZE,
        color: CAPTION_COLOR,
        font: META_FONT,
      }),
      new TextRun({
        text: `  —  ${visual.visual_type}`,
        size: SMALL_SIZE,
        color: MUTED_COLOR,
        font: META_FONT,
      }),
    ],
    alignment: AlignmentType.CENTER,
    spacing: { before: 20, after: 240 },
  }));

  return blocks;
}

// ── Main export function ──

export interface ExportDocVizParams {
  documentName: string;
  markdownContent: string;
  proposals: DocVizProposal[];
  projectName?: string;
  nuggetName?: string;
}

/**
 * Export document with DocViz visuals as a professional DOCX file.
 * Inserts generated images after their matching sections with numbered captions.
 * Returns the number of visuals inserted.
 */
export async function exportDocVizToDocx({
  documentName,
  markdownContent,
  proposals,
  projectName,
  nuggetName,
}: ExportDocVizParams): Promise<number> {
  const withImages = proposals.filter((p) => p.imageUrl);
  if (withImages.length === 0 && !markdownContent.trim()) {
    return 0;
  }

  log.info(`Exporting DocViz: ${withImages.length} visuals for "${documentName}"`);

  const sections = splitIntoSections(markdownContent);
  log.debug(`Document has ${sections.length} sections`);

  // Map proposals to section indices
  const sectionVisuals: Map<number, DocVizProposal[]> = new Map();
  const unmatchedVisuals: DocVizProposal[] = [];

  for (const proposal of withImages) {
    const sectionIdx = findMatchingSection(proposal, sections);
    if (sectionIdx >= 0) {
      const existing = sectionVisuals.get(sectionIdx) || [];
      existing.push(proposal);
      sectionVisuals.set(sectionIdx, existing);
    } else {
      unmatchedVisuals.push(proposal);
      log.warn(`No section match for visual: "${proposal.section_ref}"`);
    }
  }

  // Fetch all images in parallel
  const imageCache: Map<string, { data: ArrayBuffer; width: number; height: number }> = new Map();
  const imageUrls = withImages.map((p) => p.imageUrl!).filter(Boolean);
  await Promise.all(imageUrls.map(async (url) => {
    try {
      imageCache.set(url, await fetchImageAsArrayBuffer(url));
    } catch (err) {
      log.warn(`Failed to fetch image: ${url}`, err);
    }
  }));

  // ── Build document ──
  const children: (Paragraph | Table)[] = [];
  const exportDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const docTitle = documentName.replace(/\.[^.]+$/, '');

  // ── Cover section ──
  children.push(new Paragraph({ text: '', spacing: { after: 400 } }));

  children.push(new Paragraph({
    children: [new TextRun({ text: docTitle, bold: true, size: 44, color: '1A1A1A', font: META_FONT })],
    heading: HeadingLevel.TITLE,
    alignment: AlignmentType.LEFT,
    spacing: { after: 120 },
  }));

  if (projectName || nuggetName) {
    const breadcrumbs: TextRun[] = [];
    if (projectName) breadcrumbs.push(new TextRun({ text: projectName, size: 20, color: LABEL_COLOR, font: META_FONT }));
    if (projectName && nuggetName) breadcrumbs.push(new TextRun({ text: '  ›  ', size: 20, color: MUTED_COLOR, font: META_FONT }));
    if (nuggetName) breadcrumbs.push(new TextRun({ text: nuggetName, size: 20, color: LABEL_COLOR, font: META_FONT }));
    children.push(new Paragraph({ children: breadcrumbs, spacing: { after: 60 } }));
  }

  children.push(new Paragraph({
    children: [new TextRun({
      text: `${exportDate}  ·  ${withImages.length} visual${withImages.length !== 1 ? 's' : ''} embedded`,
      size: META_FONT_SIZE, color: MUTED_COLOR, italics: true, font: META_FONT,
    })],
    spacing: { after: 80 },
  }));

  children.push(thickRule());

  // ── Render sections with visuals ──
  let figureCounter = 0;

  for (let sIdx = 0; sIdx < sections.length; sIdx++) {
    const section = sections[sIdx];

    // Section heading (skip headings inside content — they're handled by markdownToDocxElements)
    if (section.heading) {
      const fontSize = getHeadingSize(section.headingLevel);
      children.push(new Paragraph({
        children: [new TextRun({
          text: stripMarkdown(section.heading),
          bold: true,
          size: fontSize,
          color: section.headingLevel <= 2 ? ACCENT_COLOR : '333333',
          font: CONTENT_FONT,
        })],
        heading: getHeadingLevel(section.headingLevel),
        spacing: {
          before: sIdx === 0 ? 100 : section.headingLevel === 1 ? 360 : 240,
          after: section.headingLevel <= 2 ? 120 : 80,
        },
      }));
    }

    // Section content
    if (section.content.trim()) {
      const contentElements = markdownToDocxElements(section.content);
      children.push(...contentElements);
    }

    // Insert matching visuals after section content
    const visuals = sectionVisuals.get(sIdx);
    if (visuals) {
      for (const visual of visuals) {
        const cached = visual.imageUrl ? imageCache.get(visual.imageUrl) : null;
        if (!cached) continue;

        figureCounter++;
        children.push(...createVisualBlock(visual, cached, figureCounter));
      }
    }
  }

  // ── Unmatched visuals — appendix ──
  if (unmatchedVisuals.length > 0) {
    children.push(thickRule());
    children.push(new Paragraph({
      children: [new TextRun({
        text: 'ADDITIONAL VISUALS',
        bold: true,
        size: H3_SIZE,
        color: ACCENT_COLOR,
        font: META_FONT,
      })],
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 200, after: 120 },
    }));

    for (const visual of unmatchedVisuals) {
      const cached = visual.imageUrl ? imageCache.get(visual.imageUrl) : null;
      if (!cached) continue;

      children.push(new Paragraph({
        children: [new TextRun({
          text: `Section: ${visual.section_ref}`,
          size: BODY_FONT_SIZE,
          color: LABEL_COLOR,
          font: META_FONT,
          italics: true,
        })],
        spacing: { before: 160, after: 40 },
      }));

      figureCounter++;
      children.push(...createVisualBlock(visual, cached, figureCounter));
    }
  }

  // ── Footer rule ──
  children.push(thickRule());
  children.push(new Paragraph({
    children: [new TextRun({
      text: `Generated by InfoNugget DocViz  ·  ${exportDate}`,
      size: SMALL_SIZE, color: MUTED_COLOR, italics: true, font: META_FONT,
    })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 40, after: 200 },
  }));

  // ── Build & save ──
  const doc = new Document({
    numbering: {
      config: [{
        reference: 'docviz-numbering',
        levels: [{
          level: 0,
          format: NumberFormat.DECIMAL,
          text: '%1.',
          alignment: AlignmentType.LEFT,
        }],
      }],
    },
    sections: [{
      properties: {
        page: {
          margin: {
            top: convertInchesToTwip(1),
            bottom: convertInchesToTwip(0.8),
            left: convertInchesToTwip(1),
            right: convertInchesToTwip(1),
          },
        },
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            children: [
              new TextRun({ text: docTitle, size: SMALL_SIZE, color: MUTED_COLOR, font: META_FONT, italics: true }),
            ],
            alignment: AlignmentType.RIGHT,
            spacing: { after: 100 },
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            children: [
              new TextRun({ children: [PageNumber.CURRENT], size: SMALL_SIZE, color: MUTED_COLOR, font: META_FONT }),
            ],
            alignment: AlignmentType.CENTER,
          })],
        }),
      },
      children,
    }],
  });

  const blob = await Packer.toBlob(doc);
  const filename = `${sanitizeFilename(docTitle)} - DocViz.docx`;
  saveAs(blob, filename);

  log.info(`DocViz export complete: ${figureCounter} visuals inserted`);
  return figureCounter;
}
