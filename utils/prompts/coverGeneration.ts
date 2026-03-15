import { DetailLevel } from '../../types';
import { buildExpertPriming } from './promptUtils';

// ─────────────────────────────────────────────────────────────────
// Cover Card Generation — Content Prompt
// ─────────────────────────────────────────────────────────────────
// Used when generating a cover card from a document heading via
// the SourcesPanel. The heading text becomes the title; Claude
// derives subtitle/tagline/takeaway from the section content.
//
// Cover visualizer and content instruction prompts have
// moved server-side to the generate-card Edge Function.
// ─────────────────────────────────────────────────────────────────

export function buildCoverContentPrompt(
  cardTitle: string,
  coverType: DetailLevel,
  domain?: string,
): string {
  const expertPriming = buildExpertPriming(domain);
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
