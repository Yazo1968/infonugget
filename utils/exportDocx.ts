/**
 * DOCX export for card folder content.
 * Converts selected cards' synthesized content into a downloadable Word document.
 *
 * Visual hierarchy:
 *   - Metadata & card info: small muted text, shaded backgrounds — clearly secondary
 *   - Card content: full-size, normal weight — the primary content
 *   - Thick horizontal rules separate major sections
 */
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  ShadingType,
  PageBreak,
} from 'docx';
import { saveAs } from 'file-saver';
import type { Card, CardFolder, UploadedFile } from '../types';

export interface ExportFolderParams {
  projectName: string;
  nuggetName: string;
  folder: CardFolder;
  documents: UploadedFile[];
}

// ── Shared style constants ──

const META_FONT_SIZE = 17; // 8.5pt — clearly smaller than body
const BODY_FONT_SIZE = 22; // 11pt — standard reading size
const LABEL_COLOR = '666666';
const MUTED_COLOR = '999999';
const ACCENT_COLOR = '2B579A'; // Word-blue for section headers
const ACTIVE_COLOR = '2E7D32';
const SHADING_LIGHT = { type: ShadingType.SOLID, color: 'F5F5F5', fill: 'F5F5F5' } as const;
const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const THIN_BORDER = { style: BorderStyle.SINGLE, size: 1, color: 'DDDDDD' };

/** Sanitize a string for use as a filename. */
function sanitizeFilename(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, '_').trim();
}

/** Format epoch ms to readable date string. */
function fmtDate(ts?: number): string {
  return ts ? new Date(ts).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
}

/** Create a thick horizontal rule paragraph. */
function thickRule(): Paragraph {
  return new Paragraph({
    border: {
      bottom: { style: BorderStyle.SINGLE, size: 6, color: ACCENT_COLOR },
    },
    spacing: { before: 300, after: 300 },
  });
}

/** Create a thin horizontal rule paragraph. */
function thinRule(): Paragraph {
  return new Paragraph({
    border: {
      bottom: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
    },
    spacing: { before: 160, after: 160 },
  });
}

/** Section label — small uppercase muted text. */
function sectionLabel(text: string): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({
        text: text.toUpperCase(),
        bold: true,
        size: 15,
        color: ACCENT_COLOR,
        font: 'Calibri',
      }),
    ],
    spacing: { before: 60, after: 100 },
  });
}

// ── Markdown-to-DOCX conversion ──

/** Parse a markdown table into rows of cells. */
function parseMarkdownTable(lines: string[]): string[][] {
  return lines
    .filter((l) => !l.match(/^\s*\|[\s-:|]+\|\s*$/))
    .map((l) =>
      l
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim()),
    );
}

/** Convert inline markdown to TextRun array (handles **bold**). */
function parseInlineFormatting(text: string): TextRun[] {
  const runs: TextRun[] = [];
  const regex = /\*\*(.+?)\*\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      runs.push(new TextRun({ text: text.slice(lastIndex, match.index), size: BODY_FONT_SIZE }));
    }
    runs.push(new TextRun({ text: match[1], bold: true, size: BODY_FONT_SIZE }));
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) {
    runs.push(new TextRun({ text: text.slice(lastIndex), size: BODY_FONT_SIZE }));
  }
  if (runs.length === 0) {
    runs.push(new TextRun({ text, size: BODY_FONT_SIZE }));
  }
  return runs;
}

/**
 * Convert card markdown content to docx elements.
 * Handles: headings, bullets, numbered lists, quotes, tables, plain text.
 */
function markdownToDocxElements(md: string): (Paragraph | Table)[] {
  const elements: (Paragraph | Table)[] = [];
  const lines = md.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === '') {
      i++;
      continue;
    }

    // Heading ###
    if (trimmed.startsWith('### ')) {
      elements.push(
        new Paragraph({
          children: [new TextRun({ text: trimmed.slice(4), bold: true, size: BODY_FONT_SIZE, color: '333333' })],
          heading: HeadingLevel.HEADING_4,
          spacing: { before: 120, after: 60 },
        }),
      );
      i++;
      continue;
    }
    // Heading ##
    if (trimmed.startsWith('## ')) {
      elements.push(
        new Paragraph({
          children: [new TextRun({ text: trimmed.slice(3), bold: true, size: 24, color: '222222' })],
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 160, after: 80 },
        }),
      );
      i++;
      continue;
    }
    // Heading #
    if (trimmed.startsWith('# ')) {
      elements.push(
        new Paragraph({
          children: [new TextRun({ text: trimmed.slice(2), bold: true, size: 26, color: '111111' })],
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 200, after: 100 },
        }),
      );
      i++;
      continue;
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
        const tableRows = rows.map(
          (cells, rowIdx) =>
            new TableRow({
              children: cells.map(
                (cell) =>
                  new TableCell({
                    children: [
                      new Paragraph({
                        children: [new TextRun({ text: cell, bold: rowIdx === 0, size: BODY_FONT_SIZE })],
                      }),
                    ],
                    width: { size: Math.floor(100 / colCount), type: WidthType.PERCENTAGE },
                    shading: rowIdx === 0 ? SHADING_LIGHT : undefined,
                  }),
              ),
            }),
        );
        elements.push(
          new Table({ rows: tableRows, width: { size: 100, type: WidthType.PERCENTAGE } }),
        );
        elements.push(new Paragraph({ text: '', spacing: { after: 80 } }));
      }
      continue;
    }

    // Blockquote
    if (trimmed.startsWith('> ')) {
      elements.push(
        new Paragraph({
          children: [new TextRun({ text: trimmed.slice(2), italics: true, color: '555555', size: BODY_FONT_SIZE })],
          indent: { left: 720 },
          border: { left: { style: BorderStyle.SINGLE, size: 6, color: 'CCCCCC' } },
          spacing: { before: 60, after: 60 },
        }),
      );
      i++;
      continue;
    }

    // Bullet
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      elements.push(
        new Paragraph({
          children: parseInlineFormatting(trimmed.slice(2)),
          bullet: { level: 0 },
          spacing: { before: 40, after: 40 },
        }),
      );
      i++;
      continue;
    }

    // Nested bullet
    if (/^\s{2,}[-*] /.test(line)) {
      const content = line.replace(/^\s+[-*] /, '');
      elements.push(
        new Paragraph({
          children: parseInlineFormatting(content),
          bullet: { level: 1 },
          spacing: { before: 40, after: 40 },
        }),
      );
      i++;
      continue;
    }

    // Numbered list
    const numberedMatch = trimmed.match(/^(\d+)\.\s+(.+)/);
    if (numberedMatch) {
      elements.push(
        new Paragraph({
          children: parseInlineFormatting(numberedMatch[2]),
          numbering: { reference: 'card-numbering', level: 0 },
          spacing: { before: 40, after: 40 },
        }),
      );
      i++;
      continue;
    }

    // Plain text
    elements.push(
      new Paragraph({
        children: parseInlineFormatting(trimmed),
        spacing: { before: 60, after: 60 },
      }),
    );
    i++;
  }

  return elements;
}

/**
 * Export selected cards in a folder as a DOCX file.
 * Returns the number of cards exported, or 0 if none had content.
 */
export async function exportFolderToDocx({
  projectName,
  nuggetName,
  folder,
  documents,
}: ExportFolderParams): Promise<number> {
  const selectedCards = folder.cards.filter((c) => c.selected);

  const cardsWithContent: { card: Card; content: string }[] = [];
  for (const card of selectedCards) {
    const level = card.detailLevel || 'Standard';
    const content = card.synthesisMap?.[level];
    if (content) {
      cardsWithContent.push({ card, content });
    }
  }

  if (cardsWithContent.length === 0) {
    return 0;
  }

  const children: (Paragraph | Table)[] = [];

  // ════════════════════════════════════════════════════════════════
  //  COVER SECTION — folder title + metadata (small, muted, shaded)
  // ════════════════════════════════════════════════════════════════

  // Folder name as document title
  children.push(
    new Paragraph({
      children: [new TextRun({ text: folder.name, bold: true, size: 40, color: '1A1A1A' })],
      heading: HeadingLevel.TITLE,
      spacing: { after: 80 },
    }),
  );

  // Subtitle line: project > nugget
  children.push(
    new Paragraph({
      children: [
        new TextRun({ text: projectName, size: 20, color: LABEL_COLOR }),
        new TextRun({ text: '  >  ', size: 20, color: MUTED_COLOR }),
        new TextRun({ text: nuggetName, size: 20, color: LABEL_COLOR }),
      ],
      spacing: { after: 40 },
    }),
  );

  // Export date + card count — single muted line
  const exportDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: `${exportDate}  ·  ${cardsWithContent.length} of ${folder.cards.length} cards exported`,
          size: META_FONT_SIZE,
          color: MUTED_COLOR,
          italics: true,
        }),
      ],
      spacing: { after: 60 },
    }),
  );

  children.push(thickRule());

  // ════════════════════════════════════════════════════════════════
  //  DOCUMENTS LOG — compact, small font, shaded table
  // ════════════════════════════════════════════════════════════════

  if (documents.length > 0) {
    children.push(sectionLabel('Documents Log'));

    const docTableBorder = {
      top: NO_BORDER,
      bottom: { style: BorderStyle.SINGLE, size: 1, color: 'E8E8E8' },
      left: NO_BORDER,
      right: NO_BORDER,
    };

    const docRows = documents.map((doc) => {
      const isActive = doc.enabled !== false;
      const typeLabel = doc.sourceType === 'native-pdf' ? 'PDF' : 'MD';
      return new TableRow({
        children: [
          // Status
          new TableCell({
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: isActive ? 'Active' : 'Inactive',
                    size: 15,
                    bold: true,
                    color: isActive ? ACTIVE_COLOR : MUTED_COLOR,
                  }),
                ],
              }),
            ],
            width: { size: 12, type: WidthType.PERCENTAGE },
            borders: docTableBorder,
            shading: isActive ? undefined : SHADING_LIGHT,
          }),
          // Document name
          new TableCell({
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: doc.name,
                    size: META_FONT_SIZE,
                    color: isActive ? '333333' : MUTED_COLOR,
                  }),
                ],
              }),
            ],
            width: { size: 76, type: WidthType.PERCENTAGE },
            borders: docTableBorder,
            shading: isActive ? undefined : SHADING_LIGHT,
          }),
          // Type
          new TableCell({
            children: [
              new Paragraph({
                children: [new TextRun({ text: typeLabel, size: 15, color: MUTED_COLOR })],
                alignment: AlignmentType.RIGHT,
              }),
            ],
            width: { size: 12, type: WidthType.PERCENTAGE },
            borders: docTableBorder,
            shading: isActive ? undefined : SHADING_LIGHT,
          }),
        ],
      });
    });

    children.push(
      new Table({
        rows: docRows,
        width: { size: 100, type: WidthType.PERCENTAGE },
      }),
    );

    children.push(thickRule());
  }

  // ════════════════════════════════════════════════════════════════
  //  CARD CONTENT — the primary content, full-size
  // ════════════════════════════════════════════════════════════════

  children.push(sectionLabel('Card Content'));

  for (let idx = 0; idx < cardsWithContent.length; idx++) {
    const { card, content } = cardsWithContent[idx];
    const level = card.detailLevel || 'Standard';

    // ── Card title (prominent) ──
    children.push(
      new Paragraph({
        children: [new TextRun({ text: card.text, bold: true, size: 28, color: '1A1A1A' })],
        heading: HeadingLevel.HEADING_1,
        spacing: { before: idx === 0 ? 120 : 360, after: 40 },
      }),
    );

    // ── Card metadata — single compact line, muted ──
    const album = card.albumMap?.[level];
    const imageCount = album ? album.length : 0;
    const lastImageTs = album && album.length > 0 ? album[album.length - 1].createdAt : undefined;
    const isStale = !!(lastImageTs && card.lastEditedAt && card.lastEditedAt > lastImageTs);

    const metaParts: string[] = [level];
    if (card.createdAt) metaParts.push(`Created ${fmtDate(card.createdAt)}`);
    if (card.lastEditedAt && card.lastEditedAt !== card.createdAt)
      metaParts.push(`Modified ${fmtDate(card.lastEditedAt)}`);
    if (imageCount > 0) {
      let imgText = `${imageCount} image${imageCount > 1 ? 's' : ''}`;
      if (isStale) imgText += ' (stale)';
      metaParts.push(imgText);
    }

    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: metaParts.join('  ·  '),
            size: META_FONT_SIZE,
            color: MUTED_COLOR,
            italics: true,
          }),
        ],
        spacing: { after: 40 },
      }),
    );

    // Sources line (if any)
    if (card.sourceDocuments?.length) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: 'Sources: ', size: META_FONT_SIZE, color: LABEL_COLOR, bold: true }),
            new TextRun({ text: card.sourceDocuments.join(', '), size: META_FONT_SIZE, color: MUTED_COLOR }),
          ],
          spacing: { after: 60 },
        }),
      );
    }

    // Thin separator between meta and content
    children.push(
      new Paragraph({
        border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: 'E0E0E0' } },
        spacing: { before: 40, after: 160 },
      }),
    );

    // ── Card content — full size, the star of the show ──
    const contentElements = markdownToDocxElements(content);
    children.push(...contentElements);

    // Card-to-card separator (skip after last card)
    if (idx < cardsWithContent.length - 1) {
      children.push(thinRule());
    }
  }

  // ── Footer ──
  children.push(thickRule());
  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: `Generated by InfoNugget  ·  ${exportDate}`,
          size: 15,
          color: MUTED_COLOR,
          italics: true,
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { before: 40 },
    }),
  );

  // Build document
  const doc = new Document({
    numbering: {
      config: [
        {
          reference: 'card-numbering',
          levels: [
            {
              level: 0,
              format: 'decimal',
              text: '%1.',
              alignment: AlignmentType.LEFT,
            },
          ],
        },
      ],
    },
    sections: [
      {
        children,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const filename = `${sanitizeFilename(folder.name)} - ${sanitizeFilename(nuggetName)}.docx`;
  saveAs(blob, filename);

  return cardsWithContent.length;
}
