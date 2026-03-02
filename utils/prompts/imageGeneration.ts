import { StylingOptions } from '../../types';
import { assembleRendererPrompt, transformContentToTags, hexToColorName } from './promptUtils';

// ─────────────────────────────────────────────────────────────────
// Visualizer (Card Image Generation)
// ─────────────────────────────────────────────────────────────────
// Phase 4 — consumed by gemini-3.1-flash-image-preview (image model).
//
// CRITICAL: All prompts in this file use narrative prose only.
// No markdown (##, **, ---), no XML tags, no key-value pairs,
// no font names, no point sizes. These are all leakage vectors
// that the image model may render as visible text.
//
// Aspect ratio and resolution are set via imageConfig in the API
// call (S6) — they do not appear in the prompt text.
//
// Changes from original (per S1, S2, S5, S6, S7):
//   - All instructions rewritten as narrative prose
//   - Content block transformed to bracketed tags via assembler
//   - Palette described as semantic color-to-object bindings
//   - Typography described as visual relationships, not specs
//   - Style–palette conflict detection with override language
//   - Prompt order: role → style/palette → layout → content
//   - Aspect ratio / resolution removed from prompt text
// ─────────────────────────────────────────────────────────────────

export function buildVisualizerPrompt(
  cardTitle: string,
  contentToMap: string,
  settings: StylingOptions,
  visualPlan?: string,
  useReference?: boolean,
  subject?: string,
): string {
  // The assembler handles all transformations:
  // - Builds narrative style/palette/typography block from settings
  // - Sanitizes planner output (if provided)
  // - Transforms content markdown to bracketed tags
  // - Assembles in optimal order (role → style → [reference] → layout → content)
  const referenceNote = useReference
    ? 'A reference infographic is provided. Replicate its visual identity exactly: title ' +
      'decoration and weight, header styling, text hierarchy, color usage, background ' +
      'treatment, container shapes, icon style, and spacing. The new card must look like ' +
      'a sibling of the reference. Derive layout from the content below, not the reference.'
    : undefined;
  return assembleRendererPrompt(cardTitle, contentToMap, settings, visualPlan, referenceNote, subject);
}

// ─────────────────────────────────────────────────────────────────
// Annotation-Based Modification
// ─────────────────────────────────────────────────────────────────
// Phase 5a — consumed by gemini-3.1-flash-image-preview (image model).
//
// This prompt relies primarily on the reference image for style.
// Changes from original (per S8):
//   - Removed ## markdown headers
//   - Rewritten CRITICAL RULES as narrative sentences
//   - Front-loaded style preservation as the opening instruction
//   - Flattened process steps to plain text
// ─────────────────────────────────────────────────────────────────

export function buildModificationPrompt(
  instructions: string,
  cardTitle: string | null,
  hasRedline: boolean = true,
): string {
  const titleSuffix = cardTitle ? ` for "${cardTitle}"` : '';

  if (!hasRedline) {
    // Global instruction only — no redline map provided
    return `
You are a precise image editor. You will receive an original infographic image. Apply the modifications described below to the original image, producing a new version that incorporates all requested changes.

Maintain the exact same visual style, color palette, typography, and design language as the original image throughout all modifications. Execute each instruction precisely as written without adding creative interpretations unless specifically asked. The output must match the original image quality and resolution.

Modifications to apply${titleSuffix}:
${instructions}

Process: Study the original image carefully, noting its style, colors, fonts, and layout. Apply each modification while maintaining visual consistency. Output the complete modified image.
`.trim();
  }

  return `
You are a precise image editor. You will receive an original infographic image and a redline overlay map showing annotations on a black background. Apply the modifications described below to the original image, producing a new version that incorporates all requested changes.

Maintain the exact same visual style, color palette, typography, and design language as the original image throughout all modifications. Only modify the specific areas indicated by the annotations — leave all other parts of the image exactly as they are. Execute each instruction precisely as written without adding creative interpretations unless specifically asked. Use the redline map coordinates to locate exactly where changes should be applied. The output must match the original image quality and resolution.

Modifications to apply${titleSuffix}:
${instructions}

Process: Study the original image carefully, noting its style, colors, fonts, and layout. Cross-reference the redline map to locate each annotation spatially. Apply each modification in order while maintaining visual consistency. Output the complete modified image.
`.trim();
}

// ─────────────────────────────────────────────────────────────────
// Content-Only Modification (re-render with updated text)
// ─────────────────────────────────────────────────────────────────
// Phase 5b — consumed by gemini-3.1-flash-image-preview (image model).
//
// Changes from original (per S8):
//   - Full narrative rewrite — no markdown, no key-value pairs
//   - Palette as narrative semantic color-to-object bindings
//   - Typography as descriptive visual hierarchy
//   - Content block uses bracketed tags
//   - Style–palette override language when applicable
// ─────────────────────────────────────────────────────────────────

export function buildContentModificationPrompt(
  content: string,
  cardTitle: string | null,
  style?: string,
  palette?: { background: string; primary: string; secondary: string; accent: string; text: string },
): string {
  const titleSuffix = cardTitle ? ` titled "${cardTitle}"` : '';

  // Opening: role + reference instruction
  const opening =
    `You are an expert Information Designer. You will receive a reference infographic ` +
    `image — study its visual style, layout approach, color palette, typography, and ` +
    `design language carefully.\n\n` +
    `Generate a new infographic${titleSuffix} that renders the updated content below while matching ` +
    `the reference image's visual family exactly — same style, same color palette, same ` +
    `typography approach, same design language. The layout should adapt to the updated ` +
    `content's structure while preserving the reference's aesthetic.`;

  // Palette: narrative semantic assignments (if provided)
  let paletteBlock = '';
  if (palette) {
    const bgName = hexToColorName(palette.background);
    const primaryName = hexToColorName(palette.primary);
    const secondaryName = hexToColorName(palette.secondary);
    const accentName = hexToColorName(palette.accent);
    const textName = hexToColorName(palette.text);

    const overrideClause = style
      ? ` Strictly adhere to this palette — override any default color associations from the ${style} style.`
      : '';

    paletteBlock =
      `\n\nApply the color palette from the reference: ${bgName} (${palette.background}) ` +
      `for the background, ${primaryName} (${palette.primary}) for headers and primary elements, ` +
      `${secondaryName} (${palette.secondary}) for secondary accents, ${accentName} ` +
      `(${palette.accent}) for highlighted numbers and key statistics, and ${textName} ` +
      `(${palette.text}) for body text. Limit the image exclusively to these five colors.${overrideClause}`;
  }

  // Style: narrative aesthetic instruction (if provided, no palette)
  let styleBlock = '';
  if (style && !palette) {
    styleBlock = `\n\nFollow the ${style} aesthetic throughout the infographic.`;
  }

  // Typography: descriptive hierarchy (no font names, no sizes)
  const typographyBlock =
    `\n\nRender text with a clear visual hierarchy matching the reference image. ` +
    `The main title must be the largest and boldest element at the top. Section headers ` +
    `must be bold and clearly visible above their content groups. Body text should be ` +
    `legible and noticeably smaller. Key statistics should be emphasized and prominent.`;

  // Render instruction
  const renderInstruction =
    `\n\nEvery single piece of text content provided below must appear in the final image — ` +
    `no heading, bullet point, statistic, or detail may be omitted. If the layout ` +
    `cannot fit all the content, adapt it rather than dropping text. Reduce whitespace, ` +
    `add rows, extend sections, or use a denser arrangement — but never cut content. ` +
    `All text must be legible with high contrast.`;

  // Content: transform to bracketed tags
  const contentBlock = '\n\n' + transformContentToTags(content, cardTitle || 'Untitled');

  return (opening + paletteBlock + styleBlock + typographyBlock + renderInstruction + contentBlock).trim();
}
