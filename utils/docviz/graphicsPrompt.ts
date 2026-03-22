import { StylingOptions } from '../../types';
import { describeCanvas } from '../prompts/promptUtils';

/**
 * Build the prompt template for DocViz image generation.
 * No AI call — just string injection from user selections.
 * The data is provided as a screenshot image (sent separately).
 */
export function buildGraphicsPrompt(
  activeType: string,
  settings: StylingOptions,
  visualTitle?: string,
  description?: string,
  sectionRef?: string,
): string {
  const p = settings.palette;
  const technique = settings.technique || '';
  const composition = settings.composition || '';
  const mood = settings.mood || '';

  const pFontDesc = settings.fonts.primary;
  const sFontDesc = settings.fonts.secondary;

  const titleLine = visualTitle ? `\nTitle: "${visualTitle}"` : '';
  const subtitleLine = description ? `\nSubtitle: ${description}` : '';
  const footnoteLine = sectionRef ? `\nFootnote: ${sectionRef}` : '';

  return `<visual_type>
Create a ${activeType} that accurately and completely represents the data provided. Follow international standards for the layout, components, logic and elements of ${activeType}.
${titleLine}${subtitleLine}${footnoteLine}
</visual_type>

<visual_style>
${settings.style}${technique ? `\nTechnique: ${technique}` : ''}${composition ? `\nComposition: ${composition}` : ''}${mood ? `\nMood: ${mood}` : ''}
Palette: background ${p.background} | primary ${p.primary} | secondary ${p.secondary} | accent ${p.accent} | text ${p.text}
Typography: ${pFontDesc} for titles/headers, ${sFontDesc} for body text
Canvas: ${settings.aspectRatio} ${describeCanvas(settings.aspectRatio)}
</visual_style>

<instructions>
1. Use all the data — nothing omitted
2. Interpret and structure the data appropriately for the visual type — do not reproduce it as-is
3. All text labels, values, and descriptions from the data must appear in the visual
4. Apply the conventions, layout, and encoding standards appropriate for this visual type and its domain
</instructions>`;
}
