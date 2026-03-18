import { AutoDeckBriefing, AutoDeckLod } from '../../types';
import { LOD_LEVELS } from '../deckShared/constants';

// ── Prompt configuration ──

export interface SmartDeckPromptConfig {
  briefing: AutoDeckBriefing;
  lod: AutoDeckLod;
  includeCover: boolean;
  includeClosing: boolean;
  documentNames: string[];
}

// ── Word count specs per card type ──

const COVER_SPEC = '15–25 words total. Format: # Title\\n## Subtitle\\nOne-line tagline.';
const CLOSING_SPEC = '40–60 words total. Format: # Title\\n- Bullet takeaway 1\\n- Bullet takeaway 2\\n- ... (3–5 key takeaways)';

// ── Prohibited characters (matches content generation rules) ──

const PROHIBITED_CHARS = `PROHIBITED CHARACTERS — never use any of these:
- Em dash (\u2014) or en dash (\u2013) — use hyphen (-) instead
- Arrows (\u2192 \u2190 \u2193 \u2191) — use "to", "from", or colons instead
- Check marks (\u2713 \u2714) or cross marks (\u2717 \u2718)
- Tildes (~), pipes (|) outside tables, or asterisks (*) for emphasis outside markdown bold/italic`;

// ── Builder ──

/**
 * Compose the user-message prompt for single-shot deck generation.
 * This goes into `userText` of the chatMessageApi call.
 */
export function buildSmartDeckPrompt(config: SmartDeckPromptConfig): string {
  const { briefing, lod, includeCover, includeClosing, documentNames } = config;
  const lodConfig = LOD_LEVELS[lod];

  const sections: string[] = [];

  // 1. Role
  sections.push(
    'You are a presentation content writer. Your task is to create a complete card deck from the provided source documents.',
  );

  // 2. Briefing
  const briefLines: string[] = [];
  if (briefing.objective) briefLines.push(`- Objective: ${briefing.objective}`);
  if (briefing.audience) briefLines.push(`- Audience: ${briefing.audience}`);
  if (briefing.type) briefLines.push(`- Presentation type: ${briefing.type}`);
  if (briefing.tone) briefLines.push(`- Tone: ${briefing.tone}`);
  if (briefing.focus) briefLines.push(`- Focus: ${briefing.focus}`);
  if (briefLines.length > 0) {
    sections.push(`BRIEFING:\n${briefLines.join('\n')}`);
  }

  // 3. Source documents
  sections.push(
    `SOURCE DOCUMENTS (${documentNames.length}):\n${documentNames.map((n) => `- ${n}`).join('\n')}\n\nAll content must originate exclusively from these source documents. Do NOT invent, infer, or add information not present in the documents.`,
  );

  // 4. Level of detail + word counts
  sections.push(
    `LEVEL OF DETAIL: ${lodConfig.label}\nEach content card must contain ${lodConfig.wordCountMin}–${lodConfig.wordCountMax} words.`,
  );

  // 5. Card count
  const countParts: string[] = [];
  if (briefing.minCards != null && briefing.maxCards != null) {
    countParts.push(
      `The allowed range for content cards is ${briefing.minCards} to ${briefing.maxCards} (excluding cover/closing).\n` +
      `Before writing any cards, first analyze the source documents and decide the exact number of content cards you will produce. ` +
      `Choose the number that best fits the material within the ${briefing.minCards}–${briefing.maxCards} range. ` +
      `State your chosen number in a brief internal note to yourself, then produce exactly that many content cards — no more, no fewer.`,
    );
  } else if (briefing.minCards != null) {
    countParts.push(
      `You must generate at least ${briefing.minCards} content cards (excluding cover/closing). ` +
      `Analyze the source material first, decide the exact number, then produce exactly that many.`,
    );
  } else if (briefing.maxCards != null) {
    countParts.push(
      `You must generate at most ${briefing.maxCards} content cards (excluding cover/closing). ` +
      `Analyze the source material first, decide the exact number, then produce exactly that many.`,
    );
  } else {
    countParts.push(
      'Analyze the source documents and decide the optimal number of content cards based on the volume, structure, and natural topic boundaries of the material. ' +
      'Decide the exact number first, then produce exactly that many.',
    );
  }
  if (includeCover) countParts.push('Additionally, generate a cover card (card number 0) BEFORE the content cards. The cover card does NOT count toward the content card count.');
  if (includeClosing) countParts.push('Additionally, generate a closing card as the LAST card AFTER all content cards. The closing card does NOT count toward the content card count.');
  sections.push(`CARD COUNT:\n${countParts.join('\n')}`);

  // 6. Card format specs
  const formatLines: string[] = [
    'CONTENT FORMAT RULES:',
    '- Each card\'s content must begin with a single # heading (the card title).',
    '- Use ## for sections and ### for subsections. Never skip heading levels.',
    '- Under any heading, use ONLY: short statements, bullet points, numbered lists, tables, or blockquotes (>).',
    '- No inline itemization — "x, y, z and w" must become a bullet list.',
    '- Preserve all data points and statistics exactly as found in source documents.',
    '- Make implicit relationships between data points explicit.',
  ];
  if (includeCover) {
    formatLines.push(`\nCOVER CARD (number 0): ${COVER_SPEC}`);
  }
  if (includeClosing) {
    formatLines.push(`\nCLOSING CARD (last card): ${CLOSING_SPEC}`);
  }
  sections.push(formatLines.join('\n'));

  // 7. Prohibited characters
  sections.push(PROHIBITED_CHARS);

  // 8. Output format
  sections.push(
    `OUTPUT FORMAT:
Respond with a JSON array only — no explanation, no markdown fences, no surrounding text.
Each element must have this exact shape:
{ "number": <int>, "title": "<string>", "content": "<markdown string>", "wordCount": <int> }

Numbering:${includeCover ? '\n- Cover card: number 0' : ''}
- Content cards: numbered sequentially starting from ${includeCover ? '1' : '1'}${includeClosing ? '\n- Closing card: the highest number (after all content cards)' : ''}

The "content" field must contain the full card markdown starting with # heading.
The "wordCount" field must be the actual word count of the content.`,
  );

  return sections.join('\n\n');
}
