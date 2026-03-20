import { StylingOptions } from '../../types';

/**
 * Build the fixed prompt template for DocViz image generation.
 * No AI call — just string injection from user selections.
 * The data is provided as a screenshot image (sent separately).
 */
export function buildGraphicsPrompt(
  activeType: string,
  settings: StylingOptions,
): string {
  const p = settings.palette;
  const technique = settings.technique || '';
  const mood = settings.mood || '';

  return `Create a ${activeType} that accurately and completely represents the data provided. Follow international standards for the layout, components, logic and elements of ${activeType}.
Rules:
* Use all the data — nothing omitted
* Interpret and structure the data appropriately for the visual type — do not reproduce it as-is
* All text labels, values, and descriptions from the data must appear in the visual
* Apply the conventions, layout, and encoding standards appropriate for this visual type and its domain

Use the following style:
FONTS
TITLE: ${settings.fonts.primary}
BODY: ${settings.fonts.secondary}${technique ? `\nTECHNIQUE: ${technique}` : ''}${mood ? `\nMOOD: ${mood}` : ''}
Color Palette: background ${p.background} | primary ${p.primary} | secondary ${p.secondary} | accent ${p.accent} | text ${p.text}`;
}
