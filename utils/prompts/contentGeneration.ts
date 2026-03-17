import { DetailLevel, UploadedFile, isCoverLevel } from '../../types';
import { buildExpertPriming } from './promptUtils';

// ─────────────────────────────────────────────────────────────────
// Card Content Generation
// ─────────────────────────────────────────────────────────────────
// Consumed by Claude (text LLM). Output uses headings (## ###),
// short statements, bullet points, numbered lists, tables, and quotes.
// No bold, no special markdown characters.
// ─────────────────────────────────────────────────────────────────

export function buildContentPrompt(
  cardTitle: string,
  level: DetailLevel,
  domain?: string,
): string {
  if (isCoverLevel(level)) {
    throw new Error(`Use buildCoverContentPrompt for card cover levels (got '${level}')`);
  }

  let wordCountRange = '120-150';
  let scopeGuidance = '';
  let formattingGuidance = '';

  if (level === 'Executive') {
    wordCountRange = '50-70';
    scopeGuidance = `Scope: This is an EXECUTIVE SUMMARY. Prioritize ruthlessly - include only the single most important insight, conclusion, or finding. Omit supporting details, examples, breakdowns, and secondary points. Think: what would a CEO need to see in a 10-second glance?`;
    formattingGuidance = `Formatting (Executive):
- Maximum one subheading below the title
- Keep content extremely brief given the word limit
- Use whichever allowed format best presents each piece of information`;
  } else if (level === 'Detailed') {
    wordCountRange = '250-300';
    scopeGuidance = `Scope: This is a DETAILED analysis. Include comprehensive data, supporting evidence, comparisons, and relationships. Cover all relevant dimensions of the topic.`;
    formattingGuidance = `Formatting:
- Use whichever allowed format best presents each piece of information
- Prefer bullet points, numbered lists, and tables over prose wherever possible
- Use tables when comparing items across multiple dimensions or presenting structured data`;
  } else {
    scopeGuidance = `Scope: This is a STANDARD summary. Cover the key points, important data, and primary relationships. Include enough detail to be informative but stay concise.`;
    formattingGuidance = `Formatting:
- Use whichever allowed format best presents each piece of information
- Prefer bullet points, numbered lists, and tables over prose wherever possible
- Use tables when comparing items across multiple dimensions or presenting structured data`;
  }

  const expertPriming = buildExpertPriming(domain);
  return `${expertPriming ? expertPriming + '\n\n' : ''}Content Generation - [${cardTitle}]
Using the DOCUMENT STRUCTURE and READING INSTRUCTIONS above, read and analyze the target section including all its sub-sections and nested content. Understand the context of this section and how it relates to the document as a whole. Use this understanding to inform your synthesis, but only include content from the target section.

WORD COUNT: EXACTLY ${wordCountRange} words. This is a hard limit. Count your output words before responding. If over, cut. If under, you may add - but NEVER exceed the upper bound.

${scopeGuidance}

Task:
Extract and restructure the section's content into infographic-ready text within the word limit. The output should make the section's hierarchy, logic, and connections between its parts immediately clear without referring back to the source.

Requirements:
- Make explicit any relationships that are implied in the original (cause-effect, sequence, hierarchy, comparison, part-to-whole)
- Preserve key data points, statistics, and specific terms exactly as written
- Do not invent information not present in the documents
- Only number headings when the content has inherent sequential order (steps, phases, stages, ranked items). For thematic, categorical, or parallel content use descriptive headings without numbers

${formattingGuidance}

Structure:
- Content is organized as main heading, subheadings, and sub-sub headings (up to 3 levels if needed)
- Do NOT include the section title as a heading - it will be added separately
- Use ## for main sections within the content
- Use ### for subsections under those (if word count permits)
- Never skip heading levels
- Never use # (H1) - that level is reserved for the section title

Allowed content types (use ONLY these — nothing else):
1. Headings (## and ###) for structure
2. Very short statements - concise and direct, never long or compound. NEVER use inline itemization (e.g. "x, y, z and w") — break itemized concepts into bullet points instead
3. Bullet points for unordered sets of items, features, or attributes
4. Numbered lists for sequential steps, ranked items, or ordered processes
5. Tables when comparing items across dimensions or presenting structured data
6. Quotes (>) for key quotes, definitions, or highlighted excerpts from the source

PROHIBITED CHARACTERS: No em dashes (\u2014), en dashes (\u2013), arrows (\u2192), check/cross marks (\u2713\u2717), square bracket annotations, tilde (~), pipe characters (|), or asterisks (*). Use colons, periods, commas, semicolons, hyphens, parentheses, and plain subheadings instead. If the source document contains any of these characters, replace them with their allowed equivalents in your output.

Output: Return your response in two XML-tagged sections. First, wrap the card content in <card_content> tags. Then, append a <layout_directives> block with brief visual layout instructions specific to this content.

<card_content> rules:
- Contains ONLY the card content (headings, bullets, tables, etc.)
- No preamble, no explanation
- ${wordCountRange} words maximum

<layout_directives> rules:
- Maximum 4 directives, one per line, each under 15 words
- Describe spatial arrangement and visual relationships between content elements
- Use only these relationship types: hierarchy, flow/sequence, comparison/contrast, grouping, cause-effect
- Format each as: [elements] -> [visual treatment]
- Example: "Revenue vs Cost -> opposing columns with contrasting colors"
`.trim();
}

// ─────────────────────────────────────────────────────────────────
// Section Focus Builders
// ─────────────────────────────────────────────────────────────────
// Build structured section-focus blocks that tell Claude exactly
// which section to read from documents uploaded via the Files API.
// Two doc-type-specific builders (MD uses heading-name boundaries,
// PDF uses explicit page ranges) unified by buildSectionFocus().
// ─────────────────────────────────────────────────────────────────

/**
 * Section focus for a markdown document.
 * Uses heading names as start/end boundaries.
 */
function buildMdSectionFocus(cardTitle: string, doc: UploadedFile): string {
  const structure = doc.structure!;
  const targetIdx = structure.findIndex((h) => h.text === cardTitle);

  if (targetIdx === -1) {
    // Whole-document: full TOC, no markers
    const tocLines = structure
      .map((h) => `${'  '.repeat(h.level - 1)}- ${h.text}`)
      .join('\n');

    return [
      `DOCUMENT STRUCTURE (from "${doc.name}"):`,
      'Read the ENTIRE document.',
      '',
      tocLines,
      '',
      'READING INSTRUCTIONS:',
      'Read the entire document from beginning to end. Synthesize content from all sections.',
    ].join('\n');
  }

  const target = structure[targetIdx];

  // Parent: first heading with level < target.level, scanning backwards
  let parentIdx = -1;
  for (let i = targetIdx - 1; i >= 0; i--) {
    if (structure[i].level < target.level) { parentIdx = i; break; }
  }

  // End boundary: next heading with level <= target.level
  let endIdx = -1;
  for (let i = targetIdx + 1; i < structure.length; i++) {
    if (structure[i].level <= target.level) { endIdx = i; break; }
  }

  // Does the target have children listed in the TOC?
  const hasChildren = targetIdx + 1 < structure.length && structure[targetIdx + 1].level > target.level;

  // Build indented TOC with [TARGET] / [PARENT] markers
  const tocLines = structure
    .map((h, i) => {
      const indent = '  '.repeat(h.level - 1);
      let marker = '';
      if (i === targetIdx) marker = hasChildren ? ' [TARGET]' : ' [TARGET] *';
      else if (i === parentIdx) marker = ' [PARENT]';
      return `${indent}- ${h.text}${marker}`;
    })
    .join('\n');

  // Reading instructions
  const endText = endIdx !== -1
    ? `up to (but not including) heading "${structure[endIdx].text}"`
    : 'to the end of the document';
  const parentText = parentIdx !== -1
    ? ` Read the [PARENT] section "${structure[parentIdx].text}" for broader context.`
    : '';

  const lines: string[] = [
    `DOCUMENT STRUCTURE (from "${doc.name}"):`,
    'Locate the section marked [TARGET] and read between the specified boundaries.',
    '',
    tocLines,
  ];
  if (!hasChildren) {
    lines.push('');
    lines.push('* This section may contain sub-headings (H4+) not listed in this outline.');
  }
  lines.push('');
  lines.push('READING INSTRUCTIONS:');
  lines.push(
    `Read from heading "${target.text}" ${endText}.${parentText} Extract all content from the [TARGET] section including all sub-sections and any deeper headings within these boundaries.`,
  );

  return lines.join('\n');
}

/**
 * Section focus for a native PDF document.
 * Uses explicit page ranges for every heading in the TOC.
 */
function buildPdfSectionFocus(cardTitle: string, doc: UploadedFile): string {
  const structure = doc.structure!;
  const targetIdx = structure.findIndex((h) => h.text === cardTitle);

  // Pre-compute page ranges for every heading: "pp. X-Y" or "p. X" or "pp. X+"
  const pageRanges = structure.map((h, i) => {
    const start = h.page ?? 1;
    if (i + 1 < structure.length) {
      const nextStart = structure[i + 1].page ?? start;
      const end = nextStart > start ? nextStart - 1 : start;
      return start === end ? `p. ${start}` : `pp. ${start}-${end}`;
    }
    return `pp. ${start}+`;
  });

  if (targetIdx === -1) {
    // Whole-document: full TOC with page ranges, no markers
    const tocLines = structure
      .map((h, i) => `${'  '.repeat(h.level - 1)}- ${h.text} (${pageRanges[i]})`)
      .join('\n');

    return [
      `DOCUMENT STRUCTURE (from "${doc.name}"):`,
      'Read the ENTIRE document.',
      '',
      tocLines,
      '',
      'READING INSTRUCTIONS:',
      'Read the entire document from beginning to end. Synthesize content from all sections.',
    ].join('\n');
  }

  const target = structure[targetIdx];

  // Parent
  let parentIdx = -1;
  for (let i = targetIdx - 1; i >= 0; i--) {
    if (structure[i].level < target.level) { parentIdx = i; break; }
  }

  // End boundary (next sibling-or-higher)
  let endIdx = -1;
  for (let i = targetIdx + 1; i < structure.length; i++) {
    if (structure[i].level <= target.level) { endIdx = i; break; }
  }

  const hasChildren = targetIdx + 1 < structure.length && structure[targetIdx + 1].level > target.level;

  // Target page range for reading instructions
  const targetStart = target.page ?? 1;
  let targetEndPage: number | undefined;
  if (endIdx !== -1) {
    const nextPage = structure[endIdx].page ?? targetStart;
    targetEndPage = nextPage > targetStart ? nextPage - 1 : targetStart;
  }

  // Build TOC with markers and page ranges
  const tocLines = structure
    .map((h, i) => {
      const indent = '  '.repeat(h.level - 1);
      let marker = '';
      if (i === targetIdx) marker = hasChildren ? ' [TARGET]' : ' [TARGET] *';
      else if (i === parentIdx) marker = ' [PARENT]';
      return `${indent}- ${h.text} (${pageRanges[i]})${marker}`;
    })
    .join('\n');

  // Page range text for reading instructions
  const pageRange = targetEndPage != null
    ? (targetEndPage > targetStart ? `pages ${targetStart}-${targetEndPage}` : `page ${targetStart}`)
    : `page ${targetStart} onwards`;
  const endText = endIdx !== -1
    ? `ending before "${structure[endIdx].text}" on page ${structure[endIdx].page}`
    : 'continuing to the end of the document';
  const parentText = parentIdx !== -1
    ? ` Read the [PARENT] section "${structure[parentIdx].text}" for broader context.`
    : '';

  const lines: string[] = [
    `DOCUMENT STRUCTURE (from "${doc.name}"):`,
    'Locate the section marked [TARGET] and read the specified pages.',
    '',
    tocLines,
  ];
  if (!hasChildren) {
    lines.push('');
    lines.push('* This section may contain sub-headings (H4+) not listed in this outline.');
  }
  lines.push('');
  lines.push('READING INSTRUCTIONS:');
  lines.push(
    `Read ${pageRange} of "${doc.name}" — section "${target.text}" starting on page ${targetStart}, ${endText}.${parentText} Extract all content from the [TARGET] section including all sub-sections and any deeper headings within these page boundaries.`,
  );

  return lines.join('\n');
}

/**
 * Build a section focus block for card content synthesis.
 * Routes to the appropriate builder based on the document's sourceType.
 *
 * @param cardTitle — The heading text to focus on
 * @param enabledDocs — All enabled documents in the nugget
 * @returns Section focus text to prepend to the content prompt, or '' if no docs have structure
 */
export function buildSectionFocus(cardTitle: string, enabledDocs: UploadedFile[]): string {
  // First pass: find the doc containing the target heading
  for (const doc of enabledDocs) {
    if (!doc.structure?.length) continue;
    if (doc.structure.some((h) => h.text === cardTitle)) {
      return doc.sourceType === 'native-pdf'
        ? buildPdfSectionFocus(cardTitle, doc)
        : buildMdSectionFocus(cardTitle, doc);
    }
  }

  // No heading match → whole-document fallback (uses first doc with structure)
  for (const doc of enabledDocs) {
    if (!doc.structure?.length) continue;
    return doc.sourceType === 'native-pdf'
      ? buildPdfSectionFocus(cardTitle, doc)
      : buildMdSectionFocus(cardTitle, doc);
  }

  return '';
}
