import { DetailLevel, StylingOptions } from '../../types';
import { buildExpertPriming, transformContentToTags, hexToColorName, fontToDescriptor, countWords, describeCanvas } from './promptUtils';

// ─────────────────────────────────────────────────────────────────
// PwC Corporate — Dedicated Prompt Pipeline (Hybrid JSON Trial)
// ─────────────────────────────────────────────────────────────────
// This file contains PwC-specific versions of the planner and
// renderer prompts. When the user selects "PwC Corporate" style,
// useCardGeneration.ts branches here instead of the standard
// prompt functions. All other styles continue through the generic
// pipeline untouched.
//
// TRIAL: The PwC planner outputs structured JSON instead of
// narrative prose. The PwC renderer receives a hybrid prompt —
// a short narrative role sentence, then a JSON design spec block,
// then the text content in bracketed tags. This tests whether
// structured specs produce more faithful PwC styling than prose.
//
// PwC design signatures encoded:
//   - Burnt orange as singular hero accent (callout borders, focal stats)
//   - Grey data visualizations with only focal metric in orange
//   - Orange left-border callout boxes for key figures
//   - Three-part structure: headline → evidence → bumper
//   - Modular card-based layout with generous whitespace
//   - Georgia serif headings / Arial sans-serif body contrast
//   - Flat charts: minimal gridlines, direct value labeling
//   - Discipline over decoration — every element serves the argument
// ─────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────
// Private helper: Cover content → bracketed tags
// Mirrors coverGeneration.ts:transformCoverContentToTags
// ─────────────────────────────────────────────────────────────────

function transformCoverContentToTags(coverContent: string, _cardTitle: string): string {
  let content = coverContent;

  content = content.replace(/^#\s+(.+)$/gm, '[TITLE] $1');
  content = content.replace(/^##\s+(.+)$/gm, '[SUBTITLE] $1');
  content = content.replace(/\*\*(.+?)\*\*/g, '$1');
  content = content.replace(/\*(.+?)\*/g, '$1');
  content = content.replace(/\n{3,}/g, '\n\n');
  content = content.trim();
  content = content.replace(/^[-*]\s+(.+)$/gm, '[TAKEAWAY-BULLET] $1');

  const lines = content.split('\n').map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return '';
    if (trimmed.startsWith('[TITLE]') || trimmed.startsWith('[SUBTITLE]') || trimmed.startsWith('[TAKEAWAY-BULLET]'))
      return trimmed;
    if (content.includes('[SUBTITLE]')) {
      return `[TAGLINE] ${trimmed}`;
    }
    return `[TAKEAWAY] ${trimmed}`;
  });

  const taggedContent = lines.filter((l) => l).join('\n');
  return `[BEGIN COVER CONTENT]\n${taggedContent}\n[END COVER CONTENT]`;
}

// ─────────────────────────────────────────────────────────────────
// Private helper: Build PwC design specification as JSON string
// ─────────────────────────────────────────────────────────────────

function buildPwcDesignSpec(settings: StylingOptions): string {
  const bgName = hexToColorName(settings.palette.background);
  const primaryName = hexToColorName(settings.palette.primary);
  const secondaryName = hexToColorName(settings.palette.secondary);
  const accentName = hexToColorName(settings.palette.accent);
  const textName = hexToColorName(settings.palette.text);
  const primaryFontDesc = fontToDescriptor(settings.fonts.primary);
  const secondaryFontDesc = fontToDescriptor(settings.fonts.secondary);

  const spec = {
    style: 'PwC corporate consulting',
    aesthetic:
      'Clean, authoritative, disciplined. Professional authority and analytical rigor. Every element serves the argument — no decorative flourishes.',
    palette: {
      background: `${bgName} (${settings.palette.background})`,
      primary_accent: `${primaryName} (${settings.palette.primary}) — used ONLY for callout borders, key statistics, and focal chart highlights`,
      secondary: `${secondaryName} (${settings.palette.secondary}) — headers and section labels`,
      warm_accent: `${accentName} (${settings.palette.accent}) — secondary supporting highlights`,
      text: `${textName} (${settings.palette.text}) — body text`,
      data_elements: 'grey tones for ALL data visualizations — only the single focal metric uses orange',
    },
    typography: {
      headings: `${primaryFontDesc} — authoritative, weighty, clearly serif`,
      body: `${secondaryFontDesc} — clean, subordinate, clearly sans-serif`,
      signature: 'The contrast between serif headings and sans-serif body is a core visual signature',
      hierarchy: 'Title → section headers → body text, with clear size steps between each level',
    },
    rendering_rules: [
      'Key statistics appear inside orange left-border callout boxes: a thick burnt orange vertical line on the left edge with content indented to its right',
      'Hero statistics are oversized burnt orange numerals that serve as the primary visual anchors',
      'Three-zone vertical structure: headline conclusion at top, evidence and data in the middle, bumper takeaway or source attribution at the bottom',
      'Flat charts with minimal gridlines and direct value labeling — no 3D effects, no drop shadows, no rounded bar edges',
      'All chart bars and columns render in grey except the single focal metric which renders in burnt orange',
      'Section dividers are thin horizontal rules — not heavy borders, not decorative elements',
      'Layout uses modular card-based blocks with generous whitespace between them',
      'No gradients, no textures, no background images, no decorative patterns — flat clean surfaces only',
    ],
    content_completeness:
      'CRITICAL: Every heading, bullet, statistic, and detail from the text content must appear in the final image. If the layout cannot fit everything, adapt the layout — add rows, reduce spacing, use smaller modules — but NEVER drop content.',
  };

  return JSON.stringify(spec, null, 2);
}

// ─────────────────────────────────────────────────────────────────
// 1. PwC Planner — Standard Cards (JSON output)
// ─────────────────────────────────────────────────────────────────
// Same signature as buildPlannerPrompt in contentGeneration.ts.
// Instructs Gemini Flash to output structured JSON instead of
// narrative prose. The JSON is then embedded into the renderer's
// design spec as the "visual_brief" field.
// ─────────────────────────────────────────────────────────────────

export function buildPwcPlannerPrompt(
  cardTitle: string,
  synthesisContent: string,
  aspectRatio: string = '16:9',
  previousPlan?: string,
  subject?: string,
): string {
  const wordCount = countWords(synthesisContent);
  const canvasDescription = describeCanvas(aspectRatio);

  let diversityClause = '';
  if (previousPlan) {
    diversityClause = `
## PREVIOUS CONCEPT (DO NOT REPEAT):
The following visual concept was already used. You MUST propose a fundamentally different approach — different diagram type, different information structure. Do not reuse the same concept with minor variations.
---
${previousPlan.slice(0, 600)}
---
`;
  }

  const expertPriming = buildExpertPriming(subject);
  return `
# VISUAL BRIEF — [${cardTitle}]

${expertPriming ? expertPriming + '\n\n' : ''}You are an expert information designer creating a visual brief for a PwC corporate consulting infographic.

## CANVAS:
- Aspect ratio: ${aspectRatio} (${canvasDescription})
- Content density: ~${wordCount} words
${diversityClause}
## CONTENT:
---
${synthesisContent}
---

## PwC INFORMATION ARCHITECTURE:
Your visual concept must follow PwC corporate consulting principles:

Preferred structures: modular card-based blocks, comparison grids, scorecards, KPI tiles with hero statistics, column charts, bar charts, stacked bar charts, grouped bar charts, waterfall charts, bullet charts, donut charts, timeline bars, before-and-after panels, data tables with highlighted rows.

Layout pattern: Three-part vertical flow — headline conclusion at top, evidence and data in the middle as modular blocks, bumper takeaway at the bottom. Each section separated by thin dividers.

Hero statistics: Identify key numbers, percentages, monetary values. These become oversized focal numbers with left-border accent treatment.

Avoid: flowcharts, mind maps, Venn diagrams, fishbone diagrams, radial/circular layouts, hub-spoke, concentric rings, network graphs, organic shapes, decorative illustrations.

## OUTPUT FORMAT:
Respond with a JSON object only — no markdown, no explanation, no wrapping. Use this exact structure:

{
  "data_pattern": "one sentence naming the dominant data structure (hierarchy, comparison, sequence, metrics set, etc.) and why it fits",
  "visual_concept": "one or two sentences describing the best infographic visualization — which chart/diagram types to combine and why they make the content intuitive",
  "content_groups": [
    { "label": "group name", "items": ["content item 1", "content item 2"], "is_hero_stat": false },
    { "label": "key metric", "items": ["42%"], "is_hero_stat": true }
  ],
  "hero_callouts": ["list of specific numbers, percentages, or metrics to render as oversized burnt orange focal numbers"],
  "focal_hierarchy": ["what grabs attention first", "what grabs attention second", "what grabs attention third"]
}

## RULES:
- Output valid JSON only — no prose, no markdown code fences, no explanation
- Every content item must appear in at least one content_group — nothing may be dropped
- Set is_hero_stat: true for groups containing standalone key metrics
- hero_callouts should list the actual values (e.g. "42%", "$3.2M", "15% growth")
- Do NOT rewrite or paraphrase content text — reference it by its existing headings or labels
- Do NOT mention colors, fonts, or pixel values
`.trim();
}

// ─────────────────────────────────────────────────────────────────
// 2. PwC Visualizer — Standard Cards (Hybrid JSON)
// ─────────────────────────────────────────────────────────────────
// Same signature as buildVisualizerPrompt in imageGeneration.ts.
// Composes: narrative role → JSON design spec → content tags.
// The planner's JSON output is embedded as visual_brief inside
// the design spec.
// ─────────────────────────────────────────────────────────────────

export function buildPwcVisualizerPrompt(
  cardTitle: string,
  contentToMap: string,
  settings: StylingOptions,
  visualPlan?: string,
  useReference?: boolean,
): string {
  // 1. Role — short narrative sentence
  const role =
    'You are an expert Information Designer. Create a clean, authoritative PwC corporate consulting infographic.';

  // 2. Reference note
  const referenceNote = useReference
    ? 'A reference infographic is provided. Replicate its visual identity exactly: the burnt orange ' +
      'accent treatment, grey data styling, serif heading weight, callout box treatment, section ' +
      'divider style, and overall modular composition. The new infographic must look like a sibling ' +
      'of the reference — same visual system, different content.'
    : undefined;

  // 3. Design specification as JSON
  const designSpec = buildPwcDesignSpec(settings);

  // 4. Visual brief — embed planner JSON output or provide default
  let visualBriefBlock: string;
  if (visualPlan) {
    // The planner output is already JSON — embed it directly
    // Apply sanitization to strip any residual markdown wrapping
    let cleanPlan = visualPlan.trim();
    // Strip markdown code fences if the planner wrapped its JSON in them
    cleanPlan = cleanPlan.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    visualBriefBlock = cleanPlan;
  } else {
    visualBriefBlock = JSON.stringify(
      {
        data_pattern: 'Content hierarchy with supporting details',
        visual_concept: 'Modular card-based scorecard with stat counters and comparison blocks',
        content_groups: [],
        hero_callouts: [],
        focal_hierarchy: ['title', 'hero statistics', 'section headings', 'body content'],
      },
      null,
      2,
    );
  }

  // 5. Content (transformed from markdown to bracketed tags)
  const contentBlock = transformContentToTags(contentToMap, cardTitle);

  // Assemble: role → [reference] → design spec with embedded brief → content
  const blocks: string[] = [role];
  if (referenceNote) blocks.push(referenceNote);

  blocks.push(
    `Follow this design specification precisely:\n${designSpec}`,
    `Visual brief from the layout planner — use this to guide information architecture:\n${visualBriefBlock}`,
    contentBlock,
  );

  return blocks.join('\n\n');
}

// ─────────────────────────────────────────────────────────────────
// 3. PwC Cover Planner (JSON output)
// ─────────────────────────────────────────────────────────────────
// Same signature as buildCoverPlannerPrompt in coverGeneration.ts.
// Outputs structured JSON for PwC cover slide layout.
// ─────────────────────────────────────────────────────────────────

export function buildPwcCoverPlannerPrompt(
  cardTitle: string,
  coverContent: string,
  style: string,
  aspectRatio: string = '16:9',
  coverType: DetailLevel,
): string {
  const canvasDescription = describeCanvas(aspectRatio);

  const coverKind = coverType === 'TitleCard' ? 'Title Card' : 'Takeaway Card';

  const textElements =
    coverType === 'TitleCard'
      ? `Title (hero), subtitle (secondary), optional tagline (smallest)`
      : `Title (hero), takeaway bullet points (secondary list with orange markers)`;

  return `
COVER SLIDE LAYOUT — [${cardTitle}]

You are an expert cover slide designer for PwC corporate presentations. Plan the layout of a ${coverKind}.

CANVAS: ${aspectRatio} (${canvasDescription})
CONTENT DENSITY: MINIMAL — this is a cover slide, not a data infographic.
TEXT ELEMENTS: ${textElements}

CONTENT:
---
${coverContent}
---

PwC COVER PRINCIPLES:
- Title: left-aligned or center-left, large, bold, serif. Never centered-and-small.
- ONE geometric burnt orange accent element: a bold left stripe, underline, or angular block. Only one.
- Whitespace-driven canvas. Whitespace signals confidence and authority.
- No gradients, no textures, no background images, no illustrations, no decorative patterns.

OUTPUT FORMAT:
Respond with a JSON object only — no markdown, no explanation:

{
  "title_position": "where the title sits and how it dominates (e.g. 'left-aligned in the upper third, spanning 60% of canvas width')",
  "orange_accent": {
    "shape": "stripe, underline, angular block, or square",
    "position": "where relative to the title",
    "scale": "thin accent line or bold stripe"
  },
  "supporting_text": "where subtitle/tagline/bullets appear relative to the title",
  "whitespace": "how whitespace is distributed across the canvas"
}

RULES:
- Output valid JSON only — no prose, no code fences
- Do NOT rewrite the content text
- Do NOT mention font names, point sizes, hex colors, or pixel values
`.trim();
}

// ─────────────────────────────────────────────────────────────────
// 4. PwC Cover Visualizer (Hybrid JSON)
// ─────────────────────────────────────────────────────────────────
// Same signature as buildCoverVisualizerPrompt in coverGeneration.ts.
// Hybrid: narrative role → JSON cover spec → content tags.
// ─────────────────────────────────────────────────────────────────

export function buildPwcCoverVisualizerPrompt(
  cardTitle: string,
  coverContent: string,
  settings: StylingOptions,
  visualPlan?: string,
  useReference?: boolean,
  coverType?: DetailLevel,
): string {
  const bgName = hexToColorName(settings.palette.background);
  const primaryName = hexToColorName(settings.palette.primary);
  const secondaryName = hexToColorName(settings.palette.secondary);
  const textName = hexToColorName(settings.palette.text);
  const primaryFontDesc = fontToDescriptor(settings.fonts.primary);
  const secondaryFontDesc = fontToDescriptor(settings.fonts.secondary);

  // 1. Role
  const role =
    'You are an expert cover slide designer. Create a clean, authoritative PwC corporate cover slide — ' +
    'not a data infographic. No charts, no data grids, no multi-section layouts. ' +
    'The title is the absolute hero element.';

  // 2. Reference note
  const referenceNote = useReference
    ? 'A reference cover is provided. Replicate its visual identity exactly: serif title weight, ' +
      'orange accent treatment, whitespace distribution. The new cover must look like a sibling of the reference.'
    : undefined;

  // 3. Cover design spec as JSON
  const bulletGuidance =
    coverType === 'TakeawayCard'
      ? 'Clean vertically stacked list below title, sans-serif, each bullet with small orange square marker'
      : null;

  const coverSpec = {
    style: 'PwC corporate cover slide',
    palette: {
      background: `${bgName} (${settings.palette.background}) — clean, uncluttered`,
      accent: `${primaryName} (${settings.palette.primary}) — single geometric accent element only (stripe, underline, or angular block)`,
      title_text: `${secondaryName} (${settings.palette.secondary}) — large, bold, commanding`,
      supporting_text: `${textName} (${settings.palette.text}) — subtitle, tagline, or bullets`,
    },
    typography: {
      title: `${primaryFontDesc} — authoritative, weighty, clearly serif`,
      supporting: `${secondaryFontDesc} — clean, subordinate, clearly sans-serif`,
      signature: 'Serif-sans contrast is a core PwC visual signature',
    },
    rendering_rules: [
      'Title is the largest, most dominant text — left-aligned or center-left',
      'ONE burnt orange geometric accent near the title (stripe, underline, or block)',
      'Visual impact from three things only: large serif title, orange accent, generous whitespace',
      'No gradients, no textures, no background images, no illustrations, no decorative patterns',
      'Canvas should feel restrained and premium',
      ...(bulletGuidance ? [bulletGuidance] : []),
    ],
  };

  // 4. Visual brief from planner
  let layoutBlock: string;
  if (visualPlan) {
    let cleanPlan = visualPlan.trim();
    cleanPlan = cleanPlan.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    layoutBlock = `Cover layout from the planner:\n${cleanPlan}`;
  } else {
    const defaultLayout =
      coverType === 'TakeawayCard'
        ? {
            title_position: 'upper portion, large, bold, serif',
            orange_accent: { shape: 'underline', position: 'below title', scale: 'bold stripe' },
            supporting_text: 'takeaway bullets below title as stacked list with orange markers',
            whitespace: 'generous surrounding all elements',
          }
        : {
            title_position: 'left-aligned or center-left, dominant',
            orange_accent: { shape: 'left stripe', position: 'beside title', scale: 'bold vertical stripe' },
            supporting_text: 'subtitle below title, tagline at bottom edge',
            whitespace: 'confident whitespace fills canvas',
          };
    layoutBlock = `Cover layout:\n${JSON.stringify(defaultLayout, null, 2)}`;
  }

  // 5. Content
  const contentBlock = transformCoverContentToTags(coverContent, cardTitle);

  // Assemble
  const blocks: string[] = [role];
  if (referenceNote) blocks.push(referenceNote);
  blocks.push(
    `Follow this cover design specification precisely:\n${JSON.stringify(coverSpec, null, 2)}`,
    layoutBlock,
    `All text must be legible with high contrast against the background.`,
    contentBlock,
  );

  return blocks.join('\n\n');
}
