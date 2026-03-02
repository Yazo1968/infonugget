import { DetailLevel, StylingOptions } from '../../types';
import { buildExpertPriming, buildNarrativeStyleBlock, sanitizePlannerOutput } from './promptUtils';

// ─────────────────────────────────────────────────────────────────
// Cover Card Generation — Prompts
// ─────────────────────────────────────────────────────────────────
// Cover cards are visual-first slides with minimal text:
//   - TitleCard:    Title + Subtitle + Tagline  (branding/opener)
//   - TakeawayCard: Title + Key Takeaway Bullets  (impact summary)
//
// Each has its own content instruction, content prompt, planner
// prompt, and visualizer prompt — all optimized for cover aesthetics
// rather than data-dense infographics.
// ─────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────
// 1. Cover Content Instruction (Chat Panel — system block)
// ─────────────────────────────────────────────────────────────────
// Injected as the final system block when the user sends a chat
// message with "Generate Cover" selected. Overrides normal card
// content generation behavior.
// ─────────────────────────────────────────────────────────────────

export function buildCoverContentInstruction(coverType: DetailLevel): string {
  if (coverType === 'TitleCard') {
    return `
COVER SLIDE GENERATION MODE — THIS OVERRIDES ALL OTHER INSTRUCTIONS.

You are generating content for a TITLE CARD SLIDE — a bold, visual-first opener, not a data infographic.

**Output format (strict):**
\`\`\`
# [Title — bold, concise, impactful, 2-8 words]
## [Subtitle — one line that adds context or scope, 5-12 words]
[Tagline — optional short phrase for branding, attribution, or date, 3-8 words]
\`\`\`

**WORD COUNT:** 15-25 words total across all three lines. This is a hard limit.

**Rules:**
- The title is the hero — make it bold, memorable, and instantly clear
- The subtitle provides scope, context, or framing (e.g., "Annual Performance Review 2024", "A Deep Dive into Market Trends")
- The tagline is optional — use it for attribution, dates, division names, or a short brand phrase
- Do NOT include body text, bullet points, data, statistics, tables, or sections
- Do NOT include any markdown formatting beyond the # and ## heading markers
- Re-read the source documents to extract the most fitting title and context
- Base the title on the user's prompt and the document content

**Output:** Return ONLY the cover content starting with #. No preamble, no explanation, no card-suggestions block. NOTHING outside the cover content.

REMINDER: 15-25 words maximum. This is a cover slide, not a content card.`.trim();
  }

  // TakeawayCard
  return `
COVER SLIDE GENERATION MODE — THIS OVERRIDES ALL OTHER INSTRUCTIONS.

You are generating content for a TAKEAWAY CARD SLIDE — a bold title paired with the key takeaways as bullet points.

**Output format (strict):**
\`\`\`
# [Title — bold, concise, impactful, 2-8 words]
- [Takeaway bullet 1 — a key finding, insight, or conclusion]
- [Takeaway bullet 2 — another key finding]
- [Takeaway bullet 3 — another key finding (optional)]
- [Takeaway bullet 4 — another key finding (optional)]
\`\`\`

**WORD COUNT:** 40-60 words total (title + all bullets combined). This is a hard limit.

**Rules:**
- The title is the hero — make it bold, memorable, and instantly clear
- Include 2-4 bullet points capturing the most important takeaways from the documents
- Each bullet should be a concise, self-contained insight — specific and data-informed where possible
- Include key metrics, statistics, or concrete findings in the bullets
- Use markdown bullet points (- ) for each takeaway
- Do NOT include body text, tables, numbered lists, multiple paragraphs, or sub-sections
- Do NOT include any markdown formatting beyond the # heading marker and bullet dashes
- Re-read the source documents to extract the most impactful findings relevant to the user's prompt

**Output:** Return ONLY the cover content starting with #. No preamble, no explanation, no card-suggestions block. NOTHING outside the cover content.

REMINDER: 40-60 words maximum. This is a cover slide, not a content card.`.trim();
}

// ─────────────────────────────────────────────────────────────────
// 2. Cover Content Prompt (SourcesPanel — synthesis flow)
// ─────────────────────────────────────────────────────────────────
// Used when generating a cover card from a document heading via
// the SourcesPanel. The heading text becomes the title; Claude
// derives subtitle/tagline/takeaway from the section content.
// ─────────────────────────────────────────────────────────────────

export function buildCoverContentPrompt(
  cardTitle: string,
  coverType: DetailLevel,
  subject?: string,
): string {
  const expertPriming = buildExpertPriming(subject);
  let instructions: string;

  if (coverType === 'TitleCard') {
    instructions = `${expertPriming ? expertPriming + '\n\n' : ''}Cover Slide Content — [${cardTitle}]
Using the DOCUMENT STRUCTURE and READING INSTRUCTIONS above, read and analyze the target section and its sub-sections.

**Task:**
Generate content for a TITLE CARD SLIDE. The cover must use "${cardTitle}" as the title (or a refined, punchier version of it).

**Output format (strict):**
# [Title — use or refine "${cardTitle}", 2-8 words]
## [Subtitle — one line that adds context, scope, or framing from the section content, 5-12 words]
[Tagline — optional short phrase for branding, attribution, or date context, 3-8 words]

**Rules:**
- WORD COUNT: 15-25 words total across all lines. Hard limit. Count your output words before responding.
- The title must be based on "${cardTitle}" — you may refine it to be more impactful but preserve its meaning
- The subtitle should be derived from the section content — what is this section about at a high level?
- The tagline is optional — include only if there is a natural date, source attribution, or contextual phrase
- Do NOT include body text, bullet points, data tables, or multiple sections
- Do NOT use any markdown formatting beyond # and ## heading markers

**Output:** Return ONLY the cover content starting with #. No preamble, no explanation. REMINDER: 15-25 words maximum.
`.trim();
  } else {
    // TakeawayCard
    instructions = `${expertPriming ? expertPriming + '\n\n' : ''}Cover Slide Content — [${cardTitle}]
Using the DOCUMENT STRUCTURE and READING INSTRUCTIONS above, read and analyze the target section and its sub-sections.

**Task:**
Generate content for a TAKEAWAY CARD SLIDE. The cover must use "${cardTitle}" as the title (or a refined, punchier version of it), paired with the key takeaways from the section as bullet points.

**Output format (strict):**
# [Title — use or refine "${cardTitle}", 2-8 words]
- [Takeaway bullet 1 — a key finding, insight, or conclusion from this section]
- [Takeaway bullet 2 — another key finding]
- [Takeaway bullet 3 — another key finding (optional)]
- [Takeaway bullet 4 — another key finding (optional)]

**Rules:**
- WORD COUNT: 40-60 words total (title + all bullets combined). Hard limit. Count your output words before responding.
- The title must be based on "${cardTitle}" — you may refine it to be more impactful but preserve its meaning
- Include 2-4 bullet points with the most important insights, findings, or conclusions from this section
- Each bullet should be concise, self-contained, and data-informed where possible — include key metrics or statistics
- Use markdown bullet points (- ) for each takeaway
- Do NOT include body text, tables, numbered lists, or multiple paragraphs
- Do NOT use any markdown formatting beyond the # heading marker and bullet dashes

**Output:** Return ONLY the cover content starting with #. No preamble, no explanation. REMINDER: 40-60 words maximum.
`.trim();
  }

  return instructions;
}

// ─────────────────────────────────────────────────────────────────
// 3. Cover Planner Prompt (Layout Planning)
// ─────────────────────────────────────────────────────────────────
// Consumed by Gemini Flash (text LLM). Produces a spatial layout
// blueprint for a cover slide — fundamentally different from
// content card planning. Emphasis on visual impact, whitespace,
// and title prominence over data arrangement.
// ─────────────────────────────────────────────────────────────────

export function buildCoverPlannerPrompt(
  cardTitle: string,
  coverContent: string,
  style: string,
  aspectRatio: string = '16:9',
  coverType: DetailLevel,
): string {
  let canvasDescription = 'landscape — wider than tall';
  if (aspectRatio === '9:16') canvasDescription = 'portrait — taller than wide';
  else if (aspectRatio === '1:1') canvasDescription = 'square — equal width and height';
  else if (aspectRatio === '4:5') canvasDescription = 'near-square portrait';

  const coverKind = coverType === 'TitleCard' ? 'Title Card' : 'Takeaway Card';

  const takeawayGuidance =
    coverType === 'TakeawayCard'
      ? `The takeaway bullet points should appear below the title as a clean, vertically stacked list — visually distinct from the title, using a slightly smaller but still bold treatment. Each bullet should be clearly separated. Consider subtle bullet markers, icons, or decorative dashes. The bullets should be immediately scannable.`
      : `The subtitle sits directly below the title — smaller but clearly legible. The optional tagline is the smallest text element, positioned at the bottom or near the subtitle.`;

  return `
COVER SLIDE LAYOUT PLANNING — [${cardTitle}]

You are an expert cover slide designer. Your job is to plan the visual layout of a ${coverKind} — a bold, visual-first slide that functions as an opener or title card. This is NOT a data infographic. There should be NO data grids, NO bullet lists, NO tables, and NO multi-section layouts.

CANVAS CONSTRAINTS:
- Aspect ratio: ${aspectRatio} (${canvasDescription})
- Content density: MINIMAL — this is a cover slide with a title and a small number of supporting text elements

CONTENT TO VISUALIZE:
---
${coverContent}
---

YOUR TASK:
Plan a visually striking cover slide layout. The title is the absolute hero element — it should dominate the composition. The canvas should feel cohesive and intentional, with strong visual presence.

CRITICAL RULES:
- This is a COVER SLIDE, not a content infographic
- The title MUST be the largest, most prominent element — dominating the canvas
- NO data visualization elements (charts, graphs, tables, grids)
- NO bullet lists or multi-section arrangements
- Fill the canvas with a cohesive visual composition — abstract shapes, patterns, gradients, or style-driven decorative elements
- Whitespace should be intentional and dramatic, not empty

OUTPUT FORMAT:

Write all descriptions as narrative sentences, not key-value lists.

1. COMPOSITION: Describe the overall slide composition in narrative form:
   - Where the title sits (centered, top-third, bottom-third, overlaid on visual)
   - What fills the rest of the canvas (abstract graphic, pattern, illustration, gradient, decorative shapes)
   - ${takeawayGuidance}

2. VISUAL FOCAL POINT: Describe the dominant visual element that makes this cover striking:
   - An abstract shape, pattern, or decorative composition that reinforces the topic
   - How it interacts with the title (behind, around, framing, integrated)
   - It should occupy at least 40-60% of the canvas area

3. STYLE APPLICATION: Describe how the [${style}] aesthetic drives the cover design:
   - Shape character (rounded, sharp, organic, geometric)
   - Background treatment (solid, gradient, textured, patterned)
   - Decorative elements specific to the ${style} aesthetic
   - Write in narrative sentences. The renderer handles all color decisions — do not mention any colors.

4. TEXT HIERARCHY: Describe the text treatment:
   - Title: TIER-1 — the hero element, bold and commanding
   - ${coverType === 'TitleCard' ? 'Subtitle: TIER-2 — secondary, clearly subordinate to title' : 'Takeaway bullets: TIER-2 — clean stacked list, visually distinct from title, each bullet clearly separated'}
   - ${coverType === 'TitleCard' ? 'Tagline: TIER-4 — smallest, subtle, positioned at edge or bottom' : ''}
   - Write in narrative sentences, not lists

RULES:
- Write all descriptions as narrative sentences, not key-value lists
- Be EXPLICIT about spatial positions
- Do NOT rewrite or paraphrase the content text
- FORBIDDEN in your output: font names, point sizes, hex colors, pixel values, key-value pairs
`.trim();
}

// ─────────────────────────────────────────────────────────────────
// 4. Cover Visualizer Prompt (Image Generation)
// ─────────────────────────────────────────────────────────────────
// Consumed by gemini-3-pro-image-preview (image model).
// All narrative prose — no markdown, no XML, no key-value pairs.
// Optimized for visual-first cover slides.
// ─────────────────────────────────────────────────────────────────

export function buildCoverVisualizerPrompt(
  cardTitle: string,
  coverContent: string,
  settings: StylingOptions,
  visualPlan?: string,
  useReference?: boolean,
  coverType?: DetailLevel,
): string {
  // 1. Role — cover slide designer
  const role =
    'You are an expert cover slide designer. Create a visually striking cover slide — ' +
    'a bold, brand-forward title card that functions as an opener or presentation cover. ' +
    'This is NOT a data infographic. Do not include charts, data grids, bullet lists, or multi-section layouts. ' +
    'The title must be the absolute hero element — the largest, most dominant text on the canvas. ' +
    'Fill the entire canvas with a cohesive visual composition — no empty white areas.';

  // 2. Style & Palette (reuse narrative style block from settings)
  const styleBlock = buildNarrativeStyleBlock(settings);

  // 3. Reference note (if applicable)
  const referenceNote = useReference
    ? 'A reference cover slide is provided. Replicate its visual identity exactly: title ' +
      'decoration and weight, background treatment, color usage, and overall composition style. ' +
      'The new cover must look like a sibling of the reference.'
    : undefined;

  // 4. Layout
  let layoutBlock: string;
  if (visualPlan) {
    const cleanPlan = sanitizePlannerOutput(visualPlan);
    layoutBlock =
      `${cleanPlan}\n\n` +
      `Render the title as the hero element — bold, dominant, and immediately readable. ` +
      `All text must be legible with high contrast against the background.`;
  } else {
    const defaultGuidance =
      coverType === 'TakeawayCard'
        ? 'Place the title prominently in the upper portion of the canvas. Below it, render ' +
          'the takeaway bullet points as a clean, vertically stacked list — visually distinct from the title, ' +
          'each bullet clearly separated with consistent spacing. Use subtle bullet markers or decorative dashes. ' +
          'Fill the remaining canvas with style-driven decorative elements.'
        : 'Center the title as the dominant element. Place the subtitle directly below it, ' +
          'clearly subordinate but legible. If there is a tagline, position it at the bottom edge. ' +
          'Fill the canvas with style-driven decorative elements — abstract shapes, patterns, or gradients.';
    layoutBlock = `${defaultGuidance} All text must be legible with high contrast against the background.`;
  }

  // 5. Content — minimal, just title + supporting text in bracketed tags
  const contentBlock = transformCoverContentToTags(coverContent, cardTitle);

  // Assemble: role → style → [reference] → layout → content
  const blocks = [role, styleBlock];
  if (referenceNote) blocks.push(referenceNote);
  blocks.push(layoutBlock, contentBlock);
  return blocks.join('\n\n');
}

// ─────────────────────────────────────────────────────────────────
// Helper: Transform cover content to bracketed tags
// ─────────────────────────────────────────────────────────────────
// Similar to transformContentToTags but optimized for minimal
// cover slide content (title + subtitle/takeaway).
// ─────────────────────────────────────────────────────────────────

function transformCoverContentToTags(coverContent: string, _cardTitle: string): string {
  let content = coverContent;

  // Convert # Title → [TITLE] Title
  content = content.replace(/^#\s+(.+)$/gm, '[TITLE] $1');
  // Convert ## Subtitle → [SUBTITLE] Subtitle
  content = content.replace(/^##\s+(.+)$/gm, '[SUBTITLE] $1');

  // Strip any remaining markdown formatting
  content = content.replace(/\*\*(.+?)\*\*/g, '$1');
  content = content.replace(/\*(.+?)\*/g, '$1');

  // Collapse blank lines
  content = content.replace(/\n{3,}/g, '\n\n');
  content = content.trim();

  // Convert markdown bullet points to [TAKEAWAY-BULLET] tags
  content = content.replace(/^[-*]\s+(.+)$/gm, '[TAKEAWAY-BULLET] $1');

  // Any remaining non-tagged lines become [TAGLINE] (for TitleCard) or [TAKEAWAY] (for TakeawayCard)
  const lines = content.split('\n').map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return '';
    if (trimmed.startsWith('[TITLE]') || trimmed.startsWith('[SUBTITLE]') || trimmed.startsWith('[TAKEAWAY-BULLET]'))
      return trimmed;
    // Non-tagged non-empty line — treat as tagline or takeaway
    if (content.includes('[SUBTITLE]')) {
      return `[TAGLINE] ${trimmed}`;
    }
    return `[TAKEAWAY] ${trimmed}`;
  });

  const taggedContent = lines.filter((l) => l).join('\n');

  return `[BEGIN COVER CONTENT]\n${taggedContent}\n[END COVER CONTENT]`;
}
