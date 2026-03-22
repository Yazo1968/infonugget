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

