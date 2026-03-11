/**
 * Opening prompt for the Guided Deck conversation.
 *
 * Sent as `userText` via chatMessageApi to kick off a structured Q&A
 * that helps the user plan a card deck from their documents.
 */

export function buildGuidedDeckOpeningPrompt(
  subject?: string,
  documentNames?: string[],
): string {
  const docContext = documentNames?.length
    ? `\nAvailable documents: ${documentNames.join(', ')}`
    : '';
  const subjectContext = subject
    ? `\nDocument subject: ${subject}`
    : '';

  return `I want to plan a card deck from my documents. Guide me through it by asking me questions about what I want — one question at a time.

Here is how this conversation must work:

1. You ask me ONE question.
2. Below your question, include clickable options. Use one of two formats depending on the question:
   - For single-choice questions (pick exactly one), use:
\`\`\`card-suggestions
Option A
Option B
Option C
\`\`\`
   - For questions where I might pick several answers, use:
\`\`\`card-suggestions multi
Option A
Option B
Option C
\`\`\`
3. Below the suggestions, add a short note: "Or type your own answer." For multi-select questions, also mention that I can select multiple options.
4. Then STOP. Do not ask another question. Do not continue. Wait for my reply.
5. After I reply, ask the NEXT question in the same format. Repeat until done.

Questions to ask me (one per message, in this order):
- Purpose of the deck (single)
- Target audience (single)
- Type of deck (single — educational, persuasive, analytical, etc.)
- Which aspects to focus on (multi)
- Tone (single — professional, casual, technical, etc.)
- Default level of detail (single). The options must include these word counts: Executive (70–100 words per card), Standard (200–250 words), Detailed (450–500 words). This sets the general preference — you may adjust individual cards in the outline based on their purpose.
- Number of cards (single)
- Key topics to include (multi)
- Anything to exclude (multi)
- How to allocate content across cards (single)
- Any specific data or findings to highlight (multi)

Skip questions that don't apply based on my earlier answers, but ask at least 8 total.

After all questions are answered, present a deck outline. Assign each card a detail level (Executive, Standard, or Detailed) based on the user's default preference and the card's purpose — not every card needs the same level. Wrap the outline in this exact format:
\`\`\`deck-outline
1. Card Title | Brief description | Executive
2. Card Title | Brief description | Standard
3. Card Title | Brief description | Detailed
...
\`\`\`

The third field must be exactly one of: Executive, Standard, or Detailed.

Then ask me to approve or revise it. If I ask for revisions, present the updated outline in the same \`\`\`deck-outline format.

Stop at the approved outline unless I explicitly ask you to generate the card content.

If I ask you to generate card content, wrap ALL cards in a single block using this exact format:
\`\`\`deck-content
# Card Title 1
Card content here (paragraphs, bullets, tables, etc.)

# Card Title 2
Card content here...
\`\`\`

Each card MUST start with a single # heading (the card title). Separate cards with a blank line. Keep to the word count for each card's assigned detail level.

Include as many suggestion options per question as make sense (up to 10). Keep each option under 60 characters. Tailor options to my actual documents.
${subjectContext}${docContext}

Now ask me your first question. Just the one question, the suggestions, and the reminder to type my own answer. Nothing else.`;
}
