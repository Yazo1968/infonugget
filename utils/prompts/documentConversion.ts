// ─────────────────────────────────────────────────────────────────
// Document Conversion Prompts (Gemini Flash)
// - PDF → Markdown (full conversion with image interpretation)
// - PDF → Heading extraction (TOC/bookmark structure)
// ─────────────────────────────────────────────────────────────────

export const PDF_CONVERSION_PROMPT = `Convert the PDF to well-structured markdown with proper heading hierarchy.

## HEADING STRUCTURE (CRITICAL)

You MUST identify headings from the PDF's visual formatting and convert them to markdown heading syntax (# ## ### etc.).

STEP 1: Look for a Table of Contents, Contents, or Index page in the first 10 pages. If found, use it as a map to understand the document's heading hierarchy and section names.

STEP 2: Scan every page and identify headings from visual formatting cues: font size, bold weight, numbering patterns (1, 1.1, 1.1.1), spacing, and all-caps. Assign markdown heading levels based on relative visual hierarchy:
- Largest/boldest headings → # (H1)
- Next size down → ## (H2)
- Next → ### (H3)
- And so on up to ###### (H6)

A true heading MUST meet ALL of these criteria:
- It occupies its own line — it is NOT inline bold/italic text within a paragraph
- It is followed by body content or sub-headings, not by a continuation of the same sentence
- It is visually distinct from body text — larger font size, different weight, or different color
- It does NOT read as a complete sentence (headings are labels/titles like "Introduction", "2.1 Methods")
- It serves a structural role: introduces a new topic or section

STEP 3 (Consistency check): Group candidate headings by level. Within each level, headings MUST share a consistent visual pattern (similar font size, weight, numbering style). If a candidate doesn't match the dominant pattern, it is likely inline emphasis — render it as bold text, NOT a heading.

## CONTENT RULES

- **Reproduce the ENTIRE document content faithfully and completely. Do NOT summarize, paraphrase, condense, or omit ANY content.**
- Convert images of charts or diagrams to markdown tables or descriptions, with a footnote indicating the original was an image. Place all such footnotes at the end.
- Preserve lists, tables, blockquotes, and other structural elements as proper markdown.
- Do NOT include page numbers, repeating headers/footers, or watermarks.
- Front matter (title page, printed TOC) should be included but does NOT count toward the heading hierarchy — render it as regular text or a simple list.

Return ONLY the markdown content, nothing else.`;

export const HEADING_EXTRACTION_PROMPT = `You are a document structure analyst. Extract the heading/bookmark structure AND per-section word counts from this PDF document.

## HEADING EXTRACTION

STEP 1: Look for a Table of Contents, Contents, or Index page in the first 10 pages. If found, use it as a map to validate your understanding of the document's hierarchy and section names. Mark the TOC/Index/Title pages as a "Front Matter" entry at level 1.

STEP 2: Scan every page and identify headings from visual formatting cues: font size, bold weight, numbering patterns (1, 1.1, 1.1.1), spacing, and all-caps. Assign levels based on relative visual hierarchy (largest/boldest = level 1, next size down = level 2, etc.). Always derive headings from the actual document content — do NOT rely on embedded PDF bookmarks/outlines.

CRITICAL — A true heading MUST meet ALL of these criteria:
- It occupies its own line or block — it is NOT inline bold/italic text within a paragraph. If bold or formatted text appears mid-sentence or mid-paragraph as emphasis, it is body text, NOT a heading.
- It is followed by body content or sub-headings below it, not by a continuation of the same sentence.
- It is visually distinct from body text — it uses a LARGER font size, different weight, or different color than the surrounding body paragraphs. A short paragraph in the same font/size as body text is NOT a heading, even if it is on its own line.
- It does NOT read as a complete sentence. Headings are labels or titles (e.g., "Introduction", "2.1 Methods"), not standalone statements. If a line ends with a period and reads as a full sentence or thought, it is a short paragraph, NOT a heading.
- It serves a structural role: it introduces a new topic or section, and is followed by more detailed content underneath. A standalone line that summarizes, concludes, or transitions between paragraphs is body text.

STEP 2b (Consistency check): After your initial heading scan, group all candidate headings by their assigned level. Within each level, headings MUST share a consistent visual pattern — similar font size, weight, color, casing, and numbering style. If a candidate heading does not match the dominant pattern for its level, it is likely inline emphasis and should be removed from the heading list. For example, if most level-2 headings are 14pt bold numbered "2.1, 2.2, …", a one-off bold phrase inside a paragraph is NOT a level-2 heading even if it looks bold.

STEP 3 (Front Matter): If you identified a printed TOC, Index, or Title Page, output it as a single "Front Matter" entry at level 1. Do NOT distribute those words into the body sections.

## WORD COUNTING

For each section (from one heading to the start of the next heading at the same or higher level), count the words in the body text below that heading using these rules:

### What counts as a word:
- A continuous string of characters separated by whitespace = 1 word
- Hyphenated words (e.g., "state-of-the-art") = 1 word
- Slashed words (e.g., "and/or") = 1 word
- A number with or without a symbol (e.g., "42", "$100", "50%") = 1 word
- Abbreviations and acronyms (e.g., "U.S.A.", "NASA") = 1 word

### What does NOT count:
- Standalone punctuation marks (periods, commas, dashes, bullets)
- Headers and footers that repeat on every page
- Page numbers
- The heading text itself (count only body text below the heading)

### Special content handling:
- Text inside tables: count all cell text as words
- Text inside figures, charts, diagrams: OCR any visible text labels, axis titles, legends, and data labels — count these as words
- Decorative images (photos, icons, logos with no informative text): ignore entirely (0 words)
- Captions below figures/tables: count as words belonging to the enclosing section
- Footnotes: count as words belonging to the section that references them

## OUTPUT FORMAT

Return ONLY a JSON array. No explanation, no markdown fences, no wrapper object.

[
  {"level": 1, "title": "Front Matter", "page": 1, "wordCount": 85},
  {"level": 1, "title": "exact heading text", "page": 4, "wordCount": 0},
  {"level": 2, "title": "exact heading text", "page": 4, "wordCount": 523}
]

Rules:
- "level" is an integer 1-6 reflecting heading hierarchy
- "title" is the verbatim heading text from the document
- "page" is the absolute 1-based PDF page number where the heading appears
- "wordCount" is the integer count of body-text words directly under this heading (NOT including child sections — only text before the next heading)
- Group headings with no body text before the next heading get wordCount: 0
- Be aware that page numbers printed in the document may differ from the absolute PDF page numbers — always output the absolute PDF page number

If no headings are found, return: []`;
