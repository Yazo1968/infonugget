import { StylingOptions } from '../../types';
import { STYLE_IDENTITIES } from '../ai';

// ─────────────────────────────────────────────────────────────────
// Shared Prompt Helpers
// ─────────────────────────────────────────────────────────────────

/** Count words in a string (whitespace-split). */
export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Map an aspect ratio string to a human-readable canvas description. */
export function describeCanvas(aspectRatio: string): string {
  if (aspectRatio === '9:16') return 'portrait — taller than wide';
  if (aspectRatio === '1:1') return 'square — equal width and height';
  if (aspectRatio === '4:5' || aspectRatio === '3:4' || aspectRatio === '2:3')
    return 'portrait — taller than wide';
  if (aspectRatio === '5:4' || aspectRatio === '3:2') return 'near-square landscape';
  return 'landscape — wider than tall';
}

// ─────────────────────────────────────────────────────────────────
// Expert Priming — Subject-Based Domain Expert Injection
// ─────────────────────────────────────────────────────────────────
// Builds a priming sentence that makes Claude adopt the role of a
// top-tier domain expert based on the nugget's subject. Injected
// into system prompts across all content-generating pipelines.
// ─────────────────────────────────────────────────────────────────

/**
 * Build expert priming text from a nugget's subject string.
 * Returns an empty string if subject is falsy.
 */
export function buildExpertPriming(subject?: string): string {
  if (!subject) return '';
  return `You are a domain expert on the following subject: ${subject}. Use accurate terminology and professional judgment to organize and present the source material. Do NOT add facts, claims, data, or context from your own knowledge — work exclusively with what the source documents provide.`;
}

// ─────────────────────────────────────────────────────────────────
// Prompt Utilities for gemini-3-pro-image-preview
// ─────────────────────────────────────────────────────────────────
// All functions in this file produce narrative prose optimized for
// the image generation model. No markdown, no XML, no key-value
// pairs — these are leakage vectors in image-model prompts.
// ─────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────
// S2 / B1: Content Markdown → Bracketed Tags
// ─────────────────────────────────────────────────────────────────
// Transforms synthesis output (standard markdown) into bracketed
// structural tags safe for the image model. The synthesis phase
// continues to output markdown for other consumers; this transform
// is applied only when assembling the image-model prompt.
// ─────────────────────────────────────────────────────────────────

export function transformContentToTags(synthesisContent: string, cardTitle: string): string {
  let content = synthesisContent;

  // Strip horizontal rules
  content = content.replace(/^---+$/gm, '');

  // Convert heading levels to bracketed tags (most specific first)
  // #### Sub-subsection → [DETAIL] Sub-subsection
  content = content.replace(/^####\s+(.+)$/gm, '[DETAIL] $1');
  // ### Subheading → [SUBSECTION] Subheading
  content = content.replace(/^###\s+(.+)$/gm, '[SUBSECTION] $1');
  // ## Heading → [SECTION] Heading
  content = content.replace(/^##\s+(.+)$/gm, '[SECTION] $1');
  // # Title → strip entirely (the wrapper adds [TITLE] from cardTitle, so inline H1s are duplicates)
  content = content.replace(/^#\s+.+$/gm, '');

  // Strip bold markers
  content = content.replace(/\*\*(.+?)\*\*/g, '$1');

  // Strip italic markers
  content = content.replace(/\*(.+?)\*/g, '$1');

  // Strip bullet dashes (leading - or * list items) — keep the text
  content = content.replace(/^[\s]*[-*]\s+/gm, '');

  // Collapse excessive blank lines to single blank line
  content = content.replace(/\n{3,}/g, '\n\n');

  // Trim
  content = content.trim();

  // Wrap with title and delimiters
  return `[BEGIN TEXT CONTENT]\n[TITLE] ${cardTitle}\n\n${content}\n[END TEXT CONTENT]`;
}

// ─────────────────────────────────────────────────────────────────
// B2: Sanitize Planner Output
// ─────────────────────────────────────────────────────────────────
// Safety net that strips any residual toxic patterns from the
// planner's output before it reaches the image model. Catches
// font names, point sizes, hex colors, and key-value patterns
// that the planner was told not to produce but might anyway.
// ─────────────────────────────────────────────────────────────────

// Known font families that should never appear in planner output
const FONT_NAMES = [
  'Montserrat',
  'Inter',
  'Roboto',
  'Open Sans',
  'Lato',
  'Poppins',
  'Raleway',
  'Nunito',
  'Source Sans',
  'Work Sans',
  'DM Sans',
  'Playfair Display',
  'Merriweather',
  'Lora',
  'Georgia',
  'Garamond',
  'PT Serif',
  'Libre Baskerville',
  'Source Serif',
  'Crimson Text',
  'Source Code Pro',
  'Fira Code',
  'JetBrains Mono',
  'IBM Plex Mono',
  'IBM Plex Sans',
  'Helvetica',
  'Arial',
  'Verdana',
  'Tahoma',
  'Trebuchet',
  // Additional fonts from STYLE_FONTS
  'Bebas Neue',
  'Orbitron',
  'Rajdhani',
  'Oswald',
  'Impact',
  'Arial Black',
  'DIN Condensed',
  'Pacifico',
  'Comic Sans MS',
  'Rubik',
  'Quicksand',
  'Futura',
  'Courier New',
];

export function sanitizePlannerOutput(plannerText: string): string {
  let text = plannerText;

  // ── Strip markdown formatting (leakage vectors for image model) ──

  // Remove heading markers
  text = text.replace(/^#{1,6}\s+/gm, '');

  // Remove bold markers
  text = text.replace(/\*\*(.+?)\*\*/g, '$1');

  // Remove italic markers
  text = text.replace(/\*(.+?)\*/g, '$1');

  // Remove horizontal rules
  text = text.replace(/^---+$/gm, '');

  // Remove numbered list prefixes but keep the text
  text = text.replace(/^\d+\.\s+/gm, '');

  // Remove bullet dashes but keep the text
  text = text.replace(/^[\s]*[-*]\s+/gm, '');

  // ── Strip toxic payload patterns ──

  // Remove lines that are purely font specifications
  // Pattern: "Title: FontName Bold, 42pt, ..."
  text = text.replace(
    /^.*?:\s*(?:(?:Montserrat|Inter|Roboto|Open Sans|Lato|Poppins|Raleway|Nunito|Helvetica|Arial|Bebas Neue|Orbitron|Rajdhani|Oswald|Impact|DIN Condensed|Pacifico|Comic Sans MS|Rubik|Quicksand|Futura|Courier New|IBM Plex Sans|IBM Plex Mono)\s+(?:Bold|SemiBold|Regular|Medium|Light|Thin|ExtraBold|Black)\s*,?\s*\d+(?:-\d+)?pt).*$/gim,
    '',
  );

  // Remove standalone point size specs (e.g., "36pt", "22-28pt", "36-48pt")
  text = text.replace(/\b\d{1,3}(?:-\d{1,3})?pt\b/gi, '');

  // Remove hex color codes (#RRGGBB or #RGB)
  text = text.replace(/#[0-9A-Fa-f]{3,8}\b/g, '');

  // Remove known font names when they appear as nouns (not inside content)
  for (const font of FONT_NAMES) {
    // Replace font name when it appears in a typography/font context
    // Use word boundary to avoid partial matches
    const escaped = font.replace(/\s+/g, '\\s+');
    text = text.replace(
      new RegExp(`\\b${escaped}\\b\\s*(?:Bold|SemiBold|Regular|Medium|Light|Thin|ExtraBold|Black)?`, 'gi'),
      '',
    );
  }

  // Remove font weight + size combos that slipped through (e.g., "Bold, 42pt")
  text = text.replace(/\b(?:Bold|SemiBold|Regular|Medium|Light)\s*,?\s*\d+(?:-\d+)?pt/gi, '');

  // Remove pixel values (e.g., "24px", "1920x1080")
  text = text.replace(/\b\d{2,4}x\d{2,4}\b/g, '');
  text = text.replace(/\b\d+px\b/gi, '');

  // Clean up orphaned commas, colons, and dashes from removed content
  text = text.replace(/,\s*,/g, ',');
  text = text.replace(/:\s*$/gm, '');
  text = text.replace(/:\s*,/g, ':');

  // Collapse excessive whitespace
  text = text.replace(/[ \t]{2,}/g, ' ');
  text = text.replace(/\n{3,}/g, '\n\n');

  return text.trim();
}

// ─────────────────────────────────────────────────────────────────
// B4 / S1 / S3: Narrative Style Block Builder
// ─────────────────────────────────────────────────────────────────
// Composes palette, typography, and style as narrative prose.
// Dynamically built from user settings. Includes style–palette
// conflict detection and override language.
// ─────────────────────────────────────────────────────────────────

/**
 * Maps a hex color code to a human-readable descriptive name.
 * Used to create narrative color descriptions that bind colors
 * to objects semantically (e.g., "deep navy for headers").
 */
export function hexToColorName(hex: string): string {
  const normalizedHex = hex.toUpperCase().replace('#', '');

  // Direct lookup for common palette colors
  const knownColors: Record<string, string> = {
    // ── Whites, Creams & Off-Whites ──
    FFFFFF: 'white',
    FAFAFA: 'off-white',
    F5F7FA: 'light grey',
    F5F5F5: 'soft light gray',
    F4ECD8: 'warm cream',
    FAF3E8: 'warm ivory',
    FFF8F0: 'warm white',
    FAF0E6: 'linen cream',
    F0F0F0: 'pale gray',
    F4F7F9: 'cool white',
    F0F0F5: 'pale lavender',

    // ── Grays ──
    E0E0E0: 'light gray',
    EEEEEE: 'light gray',
    D0D0D0: 'silver gray',
    CCCCCC: 'medium gray',
    C0C0C0: 'silver',
    A0A0A0: 'warm gray',
    '999999': 'neutral gray',
    '888888': 'mid grey',
    '808080': 'mid gray',
    '6B7B8D': 'slate grey',
    '666666': 'dark gray',
    '555555': 'mid grey',
    '4A4A4A': 'medium grey',
    '333333': 'dark charcoal',
    '2D3436': 'dark grey',
    '2D2D2D': 'near-black',
    '222222': 'dark grey',
    '1A1A1A': 'near black',
    '1A1A2E': 'dark navy',
    '111111': 'near-black',
    '0D0D0D': 'near black',
    '000000': 'black',

    // ── Blues ──
    '1877F2': 'facebook blue',
    '1A365D': 'deep navy',
    '1D3557': 'navy blue',
    '1E3A5F': 'deep navy',
    '14213D': 'dark navy',
    '2C3E50': 'dark slate',
    '2C5282': 'slate blue',
    '2B6CB0': 'medium blue',
    '2D5BFF': 'bright blue',
    '2D8CFF': 'bright blue',
    '3182CE': 'ocean blue',
    '3D405B': 'muted navy',
    '4299E1': 'sky blue',
    '4A90D9': 'medium blue',
    '63B3ED': 'light blue',
    '7FB3D8': 'soft blue',
    '87CEEB': 'sky blue',
    '0B3D91': 'deep blue',
    '0066CC': 'royal blue',
    '003366': 'dark navy',
    '0047AB': 'cobalt blue',
    '0077B6': 'cerulean blue',
    '0066FF': 'bold blue',
    '00B4D8': 'cyan blue',

    // ── Data-Centric Minimalist palette ──
    '28435A': 'deep teal',
    '5F9EA0': 'muted teal',
    '9BC4CB': 'soft cyan',
    '212529': 'charcoal',

    // ── Reds ──
    FF0040: 'hot pink',
    E63946: 'crimson red',
    E53E3E: 'bright red',
    C53030: 'deep red',
    FC8181: 'salmon',
    FF0000: 'red',
    FF6F61: 'coral',
    CC0000: 'crimson',
    B91C1C: 'dark red',
    DC2626: 'bold red',
    EF4444: 'bright red',

    // ── Greens ──
    '38A169': 'emerald green',
    '39FF14': 'green neon',
    '2F855A': 'forest green',
    '48BB78': 'fresh green',
    '50C878': 'emerald green',
    '5B8C5A': 'olive green',
    '68D391': 'light green',
    '81B29A': 'sage green',
    A8D5A2: 'soft green',
    '276749': 'deep green',
    '059669': 'teal green',
    '10B981': 'bright emerald',
    '22C55E': 'vivid green',

    // ── Oranges & Yellows ──
    D04A02: 'burnt orange',
    EB8C00: 'tangerine',
    C75B12: 'rustic orange',
    D4A03C: 'mustard gold',
    DD6B20: 'warm orange',
    E07A5F: 'terra cotta',
    ED8936: 'bright orange',
    F2CC8F: 'sandy peach',
    F4845F: 'peach orange',
    F6AD55: 'golden orange',
    FF6B35: 'vivid orange',
    FFDE00: 'bright yellow',
    FFD700: 'gold',
    FFC947: 'warm yellow',
    ECC94B: 'golden yellow',
    F59E0B: 'amber',
    F97316: 'vivid orange',
    FBBF24: 'bright gold',
    '3B2F2F': 'dark brown',

    // ── Purples ──
    '6C5CE7': 'purple',
    '805AD5': 'vibrant purple',
    '6B46C1': 'deep purple',
    '9F7AEA': 'lavender purple',
    B794F4: 'light purple',
    BF00FF: 'purple neon',
    '553C9A': 'dark violet',
    '7C3AED': 'electric violet',
    '8B5CF6': 'bright purple',

    // ── Teals & Cyans ──
    '00CEC9': 'turquoise',
    '00F0FF': 'cyan neon',
    '319795': 'teal',
    '2C7A7B': 'deep teal',
    '38B2AC': 'bright teal',
    '4FD1C5': 'light teal',
    '0D9488': 'rich teal',
    '14B8A6': 'vivid teal',

    // ── Pinks ──
    D4A0C0: 'dusty rose',
    D53F8C: 'magenta pink',
    ED64A6: 'bright pink',
    F687B3: 'soft pink',
    FBB6CE: 'light pink',
    FD79A8: 'soft pink',
    EC4899: 'hot pink',
  };

  if (knownColors[normalizedHex]) {
    return knownColors[normalizedHex];
  }

  // Fallback: parse RGB and generate a basic descriptor
  const r = parseInt(normalizedHex.substring(0, 2), 16);
  const g = parseInt(normalizedHex.substring(2, 4), 16);
  const b = parseInt(normalizedHex.substring(4, 6), 16);
  const brightness = (r + g + b) / 3;

  // Determine base hue
  let hue = 'neutral';
  if (r > g && r > b) hue = b > 150 ? 'pink' : 'red-orange';
  else if (g > r && g > b) hue = 'green';
  else if (b > r && b > g) hue = r > 150 ? 'purple' : 'blue';
  else if (r > 200 && g > 200 && b < 100) hue = 'yellow';
  else if (r > 200 && g > 120 && b < 100) hue = 'orange';
  else if (Math.abs(r - g) < 30 && Math.abs(g - b) < 30) hue = 'gray';

  // Determine lightness
  let lightness = '';
  if (brightness > 200) lightness = 'light ';
  else if (brightness > 140) lightness = '';
  else if (brightness > 80) lightness = 'medium ';
  else lightness = 'dark ';

  return `${lightness}${hue}`.trim();
}

/**
 * Maps a font family name to a descriptive visual characteristic.
 * The image model cannot load fonts by name — it only understands
 * visual descriptions like "geometric sans-serif" or "elegant serif".
 */
export function fontToDescriptor(fontName: string): string {
  const name = fontName.toLowerCase().trim();

  // Known font → descriptor mappings
  const fontDescriptors: Record<string, string> = {
    // Geometric sans-serifs
    montserrat: 'clean, geometric sans-serif',
    poppins: 'rounded, geometric sans-serif',
    futura: 'sharp, geometric sans-serif',
    raleway: 'thin, elegant sans-serif',
    'dm sans': 'compact, geometric sans-serif',
    nunito: 'rounded, friendly sans-serif',
    quicksand: 'rounded, modern sans-serif',

    // Condensed / display sans-serifs
    'bebas neue': 'tall, condensed, all-caps sans-serif',
    oswald: 'condensed, strong, industrial sans-serif',
    impact: 'heavy, ultra-condensed, bold sans-serif',
    'arial black': 'heavy, wide, bold sans-serif',
    'din condensed': 'technical, narrow, industrial sans-serif',

    // Futuristic / technical sans-serifs
    orbitron: 'futuristic, geometric, squared sans-serif',
    rajdhani: 'angular, condensed, technical sans-serif',

    // Humanist / grotesque sans-serifs
    inter: 'modern, neutral sans-serif',
    roboto: 'contemporary, versatile sans-serif',
    'open sans': 'friendly, neutral sans-serif',
    lato: 'warm, humanist sans-serif',
    'source sans': 'technical, clean sans-serif',
    'source sans pro': 'technical, clean sans-serif',
    'work sans': 'minimal, clean sans-serif',
    rubik: 'rounded, geometric, friendly sans-serif',
    'noto sans': 'versatile, neutral sans-serif',
    helvetica: 'classic, neutral sans-serif',
    arial: 'neutral, clean sans-serif',
    verdana: 'wide, readable sans-serif',

    // Script / handwritten
    pacifico: 'flowing, casual, handwritten script',
    'comic sans ms': 'casual, rounded, handwritten sans-serif',

    // Serifs
    'playfair display': 'elegant, high-contrast serif',
    merriweather: 'sturdy, readable serif',
    lora: 'calligraphic, balanced serif',
    georgia: 'classic, rounded serif',
    garamond: 'refined, old-style serif',
    'pt serif': 'traditional, professional serif',
    'libre baskerville': 'classic, transitional serif',
    'source serif': 'sturdy, slab-influenced serif',
    'source serif pro': 'sturdy, slab-influenced serif',
    'crimson text': 'elegant, bookish serif',
    'noto serif': 'versatile, neutral serif',
    'times new roman': 'traditional, formal serif',

    // Monospace
    'source code pro': 'clean, technical monospace',
    'fira code': 'modern, ligature-rich monospace',
    'jetbrains mono': 'sharp, developer monospace',
    'ibm plex mono': 'structured, technical monospace',
    'ibm plex sans': 'engineered, technical sans-serif',
    courier: 'classic typewriter monospace',
    'courier new': 'classic typewriter monospace',
  };

  // Try exact match
  if (fontDescriptors[name]) {
    return fontDescriptors[name];
  }

  // Try partial match (e.g., "Source Sans 3" → "source sans")
  for (const [key, descriptor] of Object.entries(fontDescriptors)) {
    if (name.includes(key) || key.includes(name)) {
      return descriptor;
    }
  }

  // Fallback: infer from common naming patterns
  if (name.includes('serif') && !name.includes('sans')) {
    return 'professional serif';
  }
  if (name.includes('sans')) {
    return 'clean sans-serif';
  }
  if (name.includes('mono') || name.includes('code')) {
    return 'clean monospace';
  }
  if (name.includes('slab')) {
    return 'bold, slab-serif';
  }
  if (name.includes('display') || name.includes('headline')) {
    return 'expressive display typeface';
  }

  // Last resort
  return 'clean, professional typeface';
}

// ─────────────────────────────────────────────────────────────────
// Style–Palette Conflict Detection (S3)
// ─────────────────────────────────────────────────────────────────
// Style names carry trained color associations. When the user's
// palette conflicts, we add explicit override language.
// Maps the actual 13 styles from VISUAL_STYLES in ai.ts.
// ─────────────────────────────────────────────────────────────────

/**
 * Known color families associated with the app's visual styles.
 * Used to detect palette–style conflicts. Keys must match
 * the lowercased style names from VISUAL_STYLES in ai.ts.
 */
const STYLE_COLOR_FAMILIES: Record<string, string[]> = {
  'flat design': ['blue', 'gray', 'slate', 'orange'],
  'data-centric minimalist': ['navy', 'teal', 'blue', 'gray'],
  isometric: ['blue', 'green', 'coral', 'red'],
  'line art': ['black', 'gray', 'red'],
  'retro / mid-century': ['orange', 'green', 'gold', 'cream', 'brown'],
  'risograph / duotone': ['red', 'navy', 'cream'],
  'neon / dark mode': ['cyan', 'purple', 'green', 'neon', 'black'],
  'paper cutout': ['orange', 'green', 'sand', 'cream', 'terracotta'],
  'pop art': ['red', 'blue', 'yellow', 'black'],
  watercolour: ['blue', 'pink', 'green', 'rose'],
  blueprint: ['blue', 'navy', 'gold'],
  'doodle art': ['black', 'gray', 'orange'],
  'geometric gradient': ['purple', 'teal', 'pink'],
  'corporate memphis': ['blue', 'orange', 'coral', 'yellow', 'navy'],
  'pwc corporate': ['orange', 'black', 'charcoal', 'tangerine'],
};

function detectPaletteStyleConflict(style: string, palette: StylingOptions['palette']): boolean {
  const normalizedStyle = style.toLowerCase().trim();
  const expectedFamily = STYLE_COLOR_FAMILIES[normalizedStyle];

  if (!expectedFamily) {
    // Unknown style — can't detect conflict, assume potential mismatch
    return true;
  }

  // Check if the primary and secondary palette colors align with the style's family
  const paletteColorNames = [
    hexToColorName(palette.primary),
    hexToColorName(palette.secondary),
    hexToColorName(palette.accent),
  ].map((name) => name.toLowerCase());

  // If at least one palette color matches the style's expected family, no conflict
  for (const colorName of paletteColorNames) {
    for (const familyKeyword of expectedFamily) {
      if (colorName.includes(familyKeyword)) {
        return false;
      }
    }
  }

  // No palette color matched any expected family keyword — conflict detected
  return true;
}

/**
 * Builds the complete narrative style block from user settings.
 * Produces two paragraphs: color palette and typography.
 * All in narrative prose — no key-value pairs, no lists, no markdown.
 */
export function buildNarrativeStyleBlock(settings: StylingOptions): string {
  // ── Style Identity (creative driver) ──
  const identity = STYLE_IDENTITIES[settings.style] || '';
  const styleParagraph = identity
    ? `Design this infographic in a ${settings.style} aesthetic. ${identity} ` +
      `Let this style drive every visual decision — shapes, decorations, title treatments, ` +
      `section dividers, background textures, and iconography.`
    : `Design this infographic in a bold ${settings.style} aesthetic. Let the ${settings.style} style ` +
      `drive every visual decision — shapes, decorations, title treatments, section dividers, ` +
      `background textures, and iconography should all feel authentically ${settings.style}.`;

  // ── Color Palette ──
  const bgName = hexToColorName(settings.palette.background);
  const primaryName = hexToColorName(settings.palette.primary);
  const secondaryName = hexToColorName(settings.palette.secondary);
  const accentName = hexToColorName(settings.palette.accent);
  const textName = hexToColorName(settings.palette.text);

  const hasConflict = detectPaletteStyleConflict(settings.style, settings.palette);
  const overrideClause = hasConflict ? ` Use this custom palette instead of the typical ${settings.style} colors.` : '';

  const paletteParagraph =
    `Color palette: ${bgName} (${settings.palette.background}) background, ` +
    `${primaryName} (${settings.palette.primary}) for headers and primary elements, ` +
    `${secondaryName} (${settings.palette.secondary}) for secondary accents, ` +
    `${accentName} (${settings.palette.accent}) for callout numbers and highlights, ` +
    `${textName} (${settings.palette.text}) for body text. ` +
    `Stay within these five colors but allow natural tonal variation for depth and dimension.${overrideClause}`;

  // ── Typography ──
  const primaryFontDesc = fontToDescriptor(settings.fonts.primary);
  const secondaryFontDesc = fontToDescriptor(settings.fonts.secondary);

  const sameFamily = primaryFontDesc === secondaryFontDesc;
  const typographyParagraph = sameFamily
    ? `Use a ${primaryFontDesc} typeface throughout. Maintain a clear size hierarchy ` +
      `from title to headers to body text. All text must be legible.`
    : `Use a ${primaryFontDesc} typeface for titles and headers, and a ${secondaryFontDesc} ` +
      `typeface for body text. Maintain a clear size hierarchy. All text must be legible.`;

  return `${styleParagraph}\n\n${paletteParagraph}\n\n${typographyParagraph}`;
}

// ─────────────────────────────────────────────────────────────────
// S7 / B3: Prompt Assembler
// ─────────────────────────────────────────────────────────────────
// Composes the complete image-model prompt in optimal order:
// 1. Role & output type
// 2. Visual style & palette (narrative)
// 3. Layout structure (from planner or auto-inferred)
// 4. Content to render (bracketed tags)
// ─────────────────────────────────────────────────────────────────

export function assembleRendererPrompt(
  cardTitle: string,
  synthesisContent: string,
  settings: StylingOptions,
  plannerOutput?: string,
  referenceNote?: string,
  subject?: string,
): string {
  // 1. Role — open-ended, lets style drive the aesthetic
  const domainClause = subject
    ? ` The content belongs to the domain of "${subject}" — use domain-appropriate visual metaphors, iconography, and diagram conventions.`
    : '';
  const role = `You are an expert Information Designer. Create a visually striking infographic.${domainClause}`;

  // 2. Style & Palette (narrative prose from settings — style leads)
  const styleBlock = buildNarrativeStyleBlock(settings);

  // 3. Layout — planner output sandwiched with style enforcement
  let layoutBlock: string;
  if (plannerOutput) {
    const cleanPlan = sanitizePlannerOutput(plannerOutput);
    layoutBlock =
      `Use the following creative brief to guide the information architecture and visual concept. ` +
      `Interpret it strictly within the ${settings.style} style described above — the style identity ` +
      `is non-negotiable and takes precedence over any visual interpretation of the brief.\n\n` +
      `${cleanPlan}\n\n` +
      `Every single piece of text content provided below must appear in the final image — ` +
      `no heading, bullet point, statistic, or detail may be omitted. If the layout concept ` +
      `cannot fit all the content, adapt the layout rather than dropping text. Reduce whitespace, ` +
      `add rows, extend sections, or use a denser arrangement — but never cut content. ` +
      `All text must be legible with high contrast.`;
  } else {
    layoutBlock =
      `Choose the spatial arrangement that best fits the content hierarchy — ` +
      `grids, flowing sections, or radial layouts as appropriate. ` +
      `Every single piece of text content provided below must appear in the final image — ` +
      `no heading, bullet point, statistic, or detail may be omitted. If the layout ` +
      `cannot fit all the content, adapt it rather than dropping text. ` +
      `All text must be legible with high contrast.`;
  }

  // 4. Content (transformed from markdown to bracketed tags)
  const contentBlock = transformContentToTags(synthesisContent, cardTitle);

  // Assemble: role → style → [reference] → layout → content
  const blocks = [role, styleBlock];
  if (referenceNote) blocks.push(referenceNote);
  blocks.push(layoutBlock, contentBlock);
  return blocks.join('\n\n');
}
