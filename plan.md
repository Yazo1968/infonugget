# Plan: Enforce Strict Card Content Structure

## Goal
Make the content synthesis prompt enforce a uniform content structure across ALL detail levels (Executive, Standard, Detailed). Only these formats allowed under any heading/subheading:
- Very short statements (no inline itemization like "x, y, z and w")
- Bullet points
- Numbered lists
- Tables
- Quotes

## File: `utils/prompts/contentGeneration.ts`

### Changes to `buildContentPrompt()`:

1. **Unify formatting guidance** — remove per-level formatting differences. Currently Executive says "No tables, no numbered lists, no sub-sub headings" — this gets replaced with the same allowed-formats list as other levels. The only thing that varies by level is word count and scope (what to include), NOT format.

2. **Update "Allowed content types" block** (lines 82-87) — replace with the five allowed formats, adding quotes and the anti-itemization rule:
   - Headings (## and ###) for structure
   - Very short statements — concise, direct, no compound sentences, no inline itemization (never "x, y, z and w" — use bullet points instead)
   - Bullet points for unordered sets
   - Numbered lists for sequential/ranked items
   - Tables for structured comparisons
   - Quotes for key quotes or highlighted excerpts

3. **Remove `>` from PROHIBITED CHARACTERS** (line 89) — blockquote markers are now allowed since quotes are a valid format.

4. **Update header comment** (line 9) — remove "no blockquotes" since quotes are now allowed.

5. **Executive `formattingGuidance`** (lines 28-31) — remove the restrictions on tables/numbered lists. Replace with unified format rules, just noting brevity appropriate for the word count.

## No changes needed:
- `promptUtils.ts` `prepareContentBlock()` — already preserves markdown structure, `>` markers will pass through to the image model fine (Gemini understands markdown blockquotes natively).
- `buildPlannerPrompt()` — unchanged, it consumes whatever content format is produced.
- Image generation prompts — unchanged, they render content as-is.
