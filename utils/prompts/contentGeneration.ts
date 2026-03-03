import { DetailLevel, UploadedFile, isCoverLevel } from '../../types';
import { buildExpertPriming, countWords, describeCanvas } from './promptUtils';

// ─────────────────────────────────────────────────────────────────
// Card Content Generation
// ─────────────────────────────────────────────────────────────────
// Consumed by Claude (text LLM). Output uses headings (## ###),
// short sentences, bullet points, numbered lists, and tables.
// No bold, no blockquotes, no special markdown characters.
// ─────────────────────────────────────────────────────────────────

export function buildContentPrompt(
  cardTitle: string,
  level: DetailLevel,
  subject?: string,
): string {
  if (isCoverLevel(level)) {
    throw new Error(`Use buildCoverContentPrompt for card cover levels (got '${level}')`);
  }

  let wordCountRange = '200-250';
  let scopeGuidance = '';
  let formattingGuidance = '';

  if (level === 'Executive') {
    wordCountRange = '70-100';
    scopeGuidance = `Scope: This is an EXECUTIVE SUMMARY. Prioritize ruthlessly - include only the single most important insight, conclusion, or finding. Omit supporting details, examples, breakdowns, and secondary points. Think: what would a CEO need to see in a 10-second glance?`;
    formattingGuidance = `Formatting (strict for Executive):
- Maximum one subheading below the title
- Prefer 2-3 short bullet points or a few short sentences - nothing more
- No tables, no numbered lists, no sub-sub headings`;
  } else if (level === 'Detailed') {
    wordCountRange = '450-500';
    scopeGuidance = `Scope: This is a DETAILED analysis. Include comprehensive data, supporting evidence, comparisons, and relationships. Cover all relevant dimensions of the topic.`;
    formattingGuidance = `Formatting:
- Use short, direct sentences - no long compound sentences
- Whatever can be presented as bullet points, tables, or numbered lists SHOULD be - minimize prose
- Use bullet points for features, attributes, or non-sequential items
- Use numbered lists for sequential steps, ranked items, or ordered processes
- Use tables when comparing items across multiple dimensions or presenting structured data - but only when a table genuinely fits the data
- Choose the format that best presents each piece of information - do not force any format where it does not fit`;
  } else {
    scopeGuidance = `Scope: This is a STANDARD summary. Cover the key points, important data, and primary relationships. Include enough detail to be informative but stay concise.`;
    formattingGuidance = `Formatting:
- Use short, direct sentences - no long compound sentences
- Whatever can be presented as bullet points, tables, or numbered lists SHOULD be - minimize prose
- Use bullet points for features, attributes, or non-sequential items
- Use numbered lists for sequential steps, ranked items, or ordered processes
- Use tables only when comparing 3+ items across multiple dimensions and a table genuinely fits
- Choose the format that best presents each piece of information - do not force any format where it does not fit`;
  }

  const expertPriming = buildExpertPriming(subject);
  return `${expertPriming ? expertPriming + '\n\n' : ''}Content Generation - [${cardTitle}]
Using the DOCUMENT STRUCTURE and READING INSTRUCTIONS above, read and analyze the target section including all its sub-sections and nested content. Understand the context of this section and how it relates to the document as a whole. Use this understanding to inform your synthesis, but only include content from the target section.

WORD COUNT: EXACTLY ${wordCountRange} words. This is a hard limit. Count your output words before responding. If over, cut. If under, you may add - but NEVER exceed the upper bound.

${scopeGuidance}

Task:
Extract and restructure the section's content into infographic-ready text within the word limit. The output should make the section's hierarchy, logic, and connections between its parts immediately clear without referring back to the source.

Requirements:
- Make explicit any relationships that are implied in the original (cause-effect, sequence, hierarchy, comparison, part-to-whole)
- Use short, direct sentences - no filler, no repetition, no long compound sentences
- Whatever can be presented as bullet points, tables, or numbered lists SHOULD be - minimize use of prose
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

Allowed content types (use ONLY these):
1. Headings (## and ###) for structure
2. Short sentences - concise and direct, never long or compound
3. Bullet points for unordered sets of items, features, or attributes
4. Numbered lists for sequential steps, ranked items, or ordered processes
5. Tables when comparing items across dimensions - only when a table genuinely fits the data

FORBIDDEN characters in output - do NOT use any of these:
- Em dashes
- Square brackets [ ]
- Blockquote marker >
- Pipe characters |
- Asterisks * or **
Use only simple punctuation: periods, commas, colons, semicolons, hyphens, parentheses.

Output: Return ONLY the card content. No preamble, no explanation. REMINDER: ${wordCountRange} words maximum.
`.trim();
}

// ─────────────────────────────────────────────────────────────────
// Planner (Creative Visual Brief)
// ─────────────────────────────────────────────────────────────────
// Phase 2 — consumed by Claude (text LLM).
//
// Produces a conceptual creative brief — NOT a rigid wireframe.
// Focuses on data relationships, visual concept, groupings, and
// focal hierarchy. Leaves spatial placement and style decisions
// to the image model (renderer), which receives the style identity,
// palette, and fonts separately.
// ─────────────────────────────────────────────────────────────────

export function buildPlannerPrompt(
  cardTitle: string,
  synthesisContent: string,
  aspectRatio: string = '16:9',
  previousPlan?: string,
  subject?: string,
): string {
  const wordCount = countWords(synthesisContent);
  const canvasDescription = describeCanvas(aspectRatio);

  // Build diversity clause when regenerating
  let diversityClause = '';
  if (previousPlan) {
    diversityClause = `
## PREVIOUS CONCEPT (DO NOT REPEAT):
The following visual concept was already used for this content. You MUST propose a fundamentally different visualization approach — different visual metaphor, different diagram type, different information structure. Do not reuse the same concept with minor variations.
---
${previousPlan.slice(0, 600)}
---
`;
  }

  const domainContext = subject
    ? `\n## DOMAIN CONTEXT:\nThis content belongs to the domain of "${subject}". Use domain-appropriate visual metaphors, diagram types, and iconography conventions when proposing the visualization concept.\n`
    : '';

  return `
# CREATIVE VISUAL BRIEF — [${cardTitle}]

You are an expert information designer creating a creative brief for an infographic. Your job is to analyze the content and describe the BEST way to visualize its underlying relationships — not to produce a rigid wireframe. Let the content's own logic suggest the visual form.
${domainContext}
## CANVAS:
- Aspect ratio: ${aspectRatio} (${canvasDescription})
- Content density: ~${wordCount} words
${diversityClause}
## CONTENT:
---
${synthesisContent}
---

## VISUAL VOCABULARY:
Choose freely from the full range of infographic elements — pick whichever best represents the content:

Charts: column, bar, stacked bar, grouped bar, line, area, pie, donut, gauge, radar/spider, scatter plot, bubble, waterfall, funnel, treemap, heatmap, sparklines, pictorial/icon charts, waffle charts, bullet charts, slope charts

Diagrams: hierarchy/org chart, tree, flowchart, process flow, cycle, Venn, Euler, swimlane, Sankey, mind map, network/node graph, decision tree, concept map, fishbone/Ishikawa, SWOT matrix, quadrant/2x2 matrix, pyramid, staircase/step, concentric rings, timeline, Gantt, roadmap, journey map, comparison table, scorecard/dashboard panel

Visual elements: callout badges, stat counters, icon arrays, progress bars, checklists, annotated illustrations, pull quotes, KPI tiles, before/after splits, geographical maps, rating scales, milestone markers

## YOUR TASK:
Analyze the content and write a short creative brief (roughly 150–250 words total) covering these four areas. Write in narrative prose, not bullet lists.

**1. DATA RELATIONSHIPS**
What is the underlying structure of this content? Identify the dominant pattern: Is it a hierarchy? A sequence? A comparison? A concept with supporting details? A chronology? Overlapping categories? A set of metrics? A definition with attributes? Name the pattern and explain why it fits.

**2. VISUAL CONCEPT**
Propose the best infographic visualization for this content by selecting from the visual vocabulary above. You may combine multiple element types (e.g. a process flow with embedded stat counters, or a hierarchy diagram with callout badges). Describe the concept in one or two sentences — focus on what makes the information intuitive.

**3. CONTENT GROUPINGS**
Which pieces of content belong together logically? Describe natural clusters. Note which items are standalone key figures or callouts that should be visually prominent (e.g. statistics, monetary values, percentages).

**4. FOCAL HIERARCHY**
What should grab the viewer's attention first, second, and third? Describe this as a viewing sequence, not positions. Reference content by its existing headings or labels.

## RULES:
- Do NOT dictate exact positions (no "top-left", "right column", "bottom strip")
- Do NOT prescribe container types (no "a card containing...", "a sidebar with...")
- Do NOT mention colors, fonts, point sizes, or pixel values
- Do NOT rewrite, paraphrase, or abbreviate any content text
- Reference ALL content items — nothing may be dropped
- Keep it concise — this is a brief, not a specification
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
