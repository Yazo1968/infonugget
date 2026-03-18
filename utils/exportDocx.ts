/**
 * DOCX export for card folder content.
 * Converts selected cards' synthesized content into a downloadable Word document.
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
} from 'docx';
import { saveAs } from 'file-saver';
import type { Card, CardFolder, UploadedFile } from '../types';

export interface ExportFolderParams {
  projectName: string;
  nuggetName: string;
  folder: CardFolder;
  documents: UploadedFile[];
}

/** Sanitize a string for use as a filename. */
function sanitizeFilename(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, '_').trim();
}

// ── Markdown-to-DOCX conversion ──

/** Parse a markdown table into rows of cells. */
function parseMarkdownTable(lines: string[]): string[][] {
  return lines
    .filter((l) => !l.match(/^\s*\|[\s-:|]+\|\s*$/)) // skip separator rows
    .map((l) =>
      l
        .split('|')
        .slice(1, -1) // remove leading/trailing empty splits
        .map((cell) => cell.trim()),
    );
}

/** Convert a line of inline markdown to TextRun array (handles **bold**). */
function parseInlineFormatting(text: string): TextRun[] {
  const runs: TextRun[] = [];
  const regex = /\*\*(.+?)\*\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      runs.push(new TextRun(text.slice(lastIndex, match.index)));
    }
    runs.push(new TextRun({ text: match[1], bold: true }));
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) {
    runs.push(new TextRun(text.slice(lastIndex)));
  }
  if (runs.length === 0) {
    runs.push(new TextRun(text));
  }
  return runs;
}

/**
 * Convert card markdown content to an array of docx Paragraph/Table elements.
 * Handles the limited markdown subset used in card content:
 * headings (##, ###), bullets, numbered lists, quotes, tables, plain text.
 */
function markdownToDocxElements(md: string): (Paragraph | Table)[] {
  const elements: (Paragraph | Table)[] = [];
  const lines = md.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip blank lines
    if (trimmed === '') {
      i++;
      continue;
    }

    // Heading ## or ###
    if (trimmed.startsWith('### ')) {
      elements.push(
        new Paragraph({
          children: parseInlineFormatting(trimmed.slice(4)),
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 120, after: 60 },
        }),
      );
      i++;
      continue;
    }
    if (trimmed.startsWith('## ')) {
      elements.push(
        new Paragraph({
          children: parseInlineFormatting(trimmed.slice(3)),
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 160, after: 80 },
        }),
      );
      i++;
      continue;
    }
    if (trimmed.startsWith('# ')) {
      elements.push(
        new Paragraph({
          children: parseInlineFormatting(trimmed.slice(2)),
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 200, after: 100 },
        }),
      );
      i++;
      continue;
    }

    // Table (lines starting with |)
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
                        children: [
                          new TextRun({
                            text: cell,
                            bold: rowIdx === 0,
                            size: 20,
                          }),
                        ],
                      }),
                    ],
                    width: { size: Math.floor(100 / colCount), type: WidthType.PERCENTAGE },
                  }),
              ),
            }),
        );
        elements.push(
          new Table({
            rows: tableRows,
            width: { size: 100, type: WidthType.PERCENTAGE },
          }),
        );
        elements.push(new Paragraph({ text: '' })); // spacer after table
      }
      continue;
    }

    // Blockquote
    if (trimmed.startsWith('> ')) {
      elements.push(
        new Paragraph({
          children: [
            new TextRun({
              text: trimmed.slice(2),
              italics: true,
              color: '555555',
            }),
          ],
          indent: { left: 720 }, // 0.5 inch
          spacing: { before: 60, after: 60 },
        }),
      );
      i++;
      continue;
    }

    // Bullet list
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

    // Nested bullet (  - or  *)
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

    // Plain text paragraph
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

  // Collect cards that have content
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

  // Build document sections
  const children: (Paragraph | Table)[] = [];

  // ── Title ──
  children.push(
    new Paragraph({
      children: [new TextRun({ text: folder.name, bold: true, size: 36 })],
      heading: HeadingLevel.TITLE,
      spacing: { after: 200 },
    }),
  );

  // ── Metadata ──
  const metaBorder = {
    top: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
    bottom: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
    left: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
    right: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
  };

  const metaRows = [
    ['Project', projectName],
    ['Nugget', nuggetName],
    ['Folder', folder.name],
    ['Cards Exported', `${cardsWithContent.length} of ${folder.cards.length}`],
    ['Export Date', new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })],
  ];

  children.push(
    new Table({
      rows: metaRows.map(
        ([label, value]) =>
          new TableRow({
            children: [
              new TableCell({
                children: [new Paragraph({ children: [new TextRun({ text: label, bold: true, size: 20 })] })],
                width: { size: 25, type: WidthType.PERCENTAGE },
                borders: metaBorder,
              }),
              new TableCell({
                children: [new Paragraph({ children: [new TextRun({ text: value, size: 20 })] })],
                width: { size: 75, type: WidthType.PERCENTAGE },
                borders: metaBorder,
              }),
            ],
          }),
      ),
      width: { size: 100, type: WidthType.PERCENTAGE },
    }),
  );
  children.push(new Paragraph({ text: '' }));

  // ── Documents Log ──
  const enabledDocs = documents.filter((d) => d.enabled !== false);
  if (enabledDocs.length > 0) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: 'Source Documents', bold: true })],
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 240, after: 120 },
      }),
    );
    for (const doc of enabledDocs) {
      const typeLabel = doc.sourceType === 'native-pdf' ? 'PDF' : 'Markdown';
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: doc.name, bold: true }),
            new TextRun({ text: `  (${typeLabel})`, color: '888888', size: 18 }),
          ],
          bullet: { level: 0 },
          spacing: { before: 40, after: 40 },
        }),
      );
    }
    children.push(new Paragraph({ text: '' }));
  }

  // ── Cards ──
  children.push(
    new Paragraph({
      children: [new TextRun({ text: 'Card Content', bold: true })],
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 240, after: 120 },
    }),
  );

  for (const { card, content } of cardsWithContent) {
    const level = card.detailLevel || 'Standard';

    // Card title
    children.push(
      new Paragraph({
        children: [new TextRun({ text: card.text, bold: true })],
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 300, after: 60 },
      }),
    );

    // Detail level label
    children.push(
      new Paragraph({
        children: [
          new TextRun({ text: 'Detail Level: ', color: '888888', size: 18 }),
          new TextRun({ text: level, bold: true, color: '888888', size: 18 }),
        ],
        spacing: { after: 120 },
      }),
    );

    // Card content converted from markdown
    const contentElements = markdownToDocxElements(content);
    children.push(...contentElements);

    // Separator between cards
    children.push(
      new Paragraph({
        children: [new TextRun({ text: '───────────────────────────────', color: 'CCCCCC' })],
        alignment: AlignmentType.CENTER,
        spacing: { before: 200, after: 200 },
      }),
    );
  }

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
