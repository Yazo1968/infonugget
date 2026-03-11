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
// Prompt Utilities for gemini-3.1-flash-image-preview
// ─────────────────────────────────────────────────────────────────
// Structured prompt format using XML-delimited sections
// (<role>, <design_system>, <rules>, <content>)
// for clear separation of style, layout, and content concerns.
// Content preserved in native markdown (headings, bullets).
// ─────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────
// S2 / B1: Content Preparation for Image Model
// ─────────────────────────────────────────────────────────────────
// Prepares synthesis content for the image model prompt. Strips
// formatting markers (bold, italic, HR) while preserving headings
// and bullet structure in native markdown. Wrapped in <content> tags.
// ─────────────────────────────────────────────────────────────────

/**
 * Prepares synthesis content for the image generation prompt.
 * Preserves native markdown structure (headings, bullets) instead of
 * converting to bracketed tags — Gemini understands markdown natively
 * and won't render ## or - as visible text (unlike [SECTION] tags).
 *
 * @deprecated transformContentToTags — replaced by this function.
 * Legacy alias kept below for backward compatibility with imageGeneration.ts.
 */
export function prepareContentBlock(synthesisContent: string, cardTitle: string): string {
  let content = synthesisContent;
  // Strip H1 (title is provided separately)
  content = content.replace(/^#\s+.+$/gm, '');
  // Collapse excessive blank lines
  content = content.replace(/\n{3,}/g, '\n\n');
  content = content.trim();
  return `Title: ${cardTitle}\n\n${content}`;
}

/** @deprecated Use prepareContentBlock instead. Kept for backward compat with imageGeneration.ts. */
export function transformContentToTags(synthesisContent: string, cardTitle: string): string {
  return prepareContentBlock(synthesisContent, cardTitle);
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
 * Builds a plain-text style block for the image prompt.
 * No XML tags — just style identity, palette (hex), typography, canvas.
 */
export function buildDesignSystemBlock(settings: StylingOptions): string {
  return buildStyleBlock(settings);
}

export function buildStyleBlock(settings: StylingOptions): string {
  const identity = STYLE_IDENTITIES[settings.style] || '';
  const styleDesc = identity
    ? `${settings.style} — ${identity}`
    : `${settings.style}`;
  const p = settings.palette;
  const pFontDesc = fontToDescriptor(settings.fonts.primary);
  const sFontDesc = fontToDescriptor(settings.fonts.secondary);
  const typeLine = pFontDesc === sFontDesc
    ? `Typography: ${pFontDesc} throughout, clear size hierarchy from title to body`
    : `Typography: ${pFontDesc} for titles/headers, ${sFontDesc} for body text`;
  return `${styleDesc}
Palette: background ${p.background} | primary ${p.primary} | secondary ${p.secondary} | accent ${p.accent} | text ${p.text}
${typeLine}
Canvas: ${settings.aspectRatio} ${describeCanvas(settings.aspectRatio)}`;
}

/** @deprecated Use buildDesignSystemBlock instead. Kept for backward compat. */
export function buildNarrativeStyleBlock(settings: StylingOptions): string {
  return buildDesignSystemBlock(settings);
}

// ─────────────────────────────────────────────────────────────────
// Prompt Assembler — 4-Section Template
// ─────────────────────────────────────────────────────────────────
// Instructions (static) → Subject → Content (as-is) → Style (injected)
// ─────────────────────────────────────────────────────────────────

export function assembleRendererPrompt(
  cardTitle: string,
  synthesisContent: string,
  settings: StylingOptions,
  referenceNote?: string,
  subject?: string,
): string {
  const subjectLine = subject || 'Not specified';
  const styleBlock = buildStyleBlock(settings);
  const contentBlock = prepareContentBlock(synthesisContent, cardTitle);
  let refLine = '';
  if (referenceNote) refLine = `\n\n${referenceNote}`;

  return `INSTRUCTIONS: Role: Act as an expert Information Architect and Presentation Designer. Task: Transform the provided text into a highly visual, logically connected slide. Use a step-by-step cognitive process:
* Step 1: Macro-Relational Synthesis. Before visualizing individual points, analyze the holistic relationship between all provided content sections. Identify if they form a cause-and-effect loop, a problem-solution bridge, a timeline, or a comparative matrix. The final layout must visually connect these sections (using arrows, overlapping shapes, or bridging elements), not just list them in disconnected silos.
* Step 2: Visual Framework Selection. Based strictly on Step 1, select the most effective overall layout. Ensure the flow of information (e.g., left-to-right, center-out) matches the logical relationship you identified.
* Step 3: Component Design. For quantitative data, use precise charts (bar, pie, line). For categories/lists, use modular grids with relevant iconography.
* Step 4: Strict Content Constraint. Use only the data, facts, and text provided in the "CONTENT" section. Elevate key metrics or critical statements as bold callouts. Do not hallucinate, assume, extrapolate, or invent any external context, statistics, or filler text.

SUBJECT: ${subjectLine}

CONTENT: ${contentBlock}

STYLE: ${styleBlock}${refLine}`;
}
