import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ─── Constants ───
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;
const CLAUDE_MODEL = 'claude-sonnet-4-6';
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey',
};

const sseHeaders = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  'Connection': 'keep-alive',
  ...corsHeaders,
};

// ─── LOD Config ───
interface LodConfig { label: string; wordCountMin: number; wordCountMax: number; midpoint: number; detailLevel: string; }
const AUTO_DECK_LOD_LEVELS: Record<string, LodConfig> = {
  executive: { label: 'Executive', wordCountMin: 70, wordCountMax: 100, midpoint: 85, detailLevel: 'Executive' },
  standard: { label: 'Standard', wordCountMin: 200, wordCountMax: 250, midpoint: 225, detailLevel: 'Standard' },
  detailed: { label: 'Detailed', wordCountMin: 450, wordCountMax: 500, midpoint: 475, detailLevel: 'Detailed' },
};

function countWords(text: string): number { return text.trim().split(/\s+/).filter(Boolean).length; }

function buildExpertPriming(subject?: string): string {
  if (!subject || !subject.trim()) return '';
  return `You are a subject-matter expert in ${subject.trim()}.`;
}

function buildQualityWarningsBlock(report?: any): string | null {
  if (!report || report.status !== 'red' || !report.dismissed) return null;
  const issues: string[] = [];
  if ((report.clusters || []).filter((c: any) => c.isolated).length > 0)
    issues.push(`${(report.clusters || []).filter((c: any) => c.isolated).length} unrelated document cluster(s)`);
  if ((report.conflicts || []).length > 0)
    issues.push(`${report.conflicts.length} conflict(s)`);
  if (issues.length === 0) return null;
  return `The document quality check found ${issues.join(' and ')}. When relevant, add a brief footnote formatted exactly as: <i class="qn">See Quality Check panel for details.</i>`;
}

// ─── Planner Prompts ───
const PLANNER_ROLE = `You are a senior information architect specializing in document decomposition for visual communication. You analyze source documents and produce structured card plans.

CRITICAL CONTEXT: Your plan will be consumed by a separate AI content writer. The writer:
- Cannot see your reasoning, only your plan output
- Must locate exact source sections from your references
- Needs unambiguous guidance to produce correct content
- Has strict word count limits per card

Your plan must be precise enough that the writer can execute it without guessing.

Your plan must reference ONLY content that exists in the provided source documents — do not invent topics, infer data, or suggest content the sources do not contain.

Your output MUST be a single valid JSON object. Do not include any text before or after the JSON.`;

const PLANNER_INSTRUCTIONS = `Follow these steps in order:

1. CONFLICT CHECK (always first):
   Scan all documents for contradictory data, claims, or positions. A conflict is when two sources state incompatible facts about the same topic (e.g., different numbers for the same metric, opposing conclusions about the same subject). Differences in emphasis, perspective, or scope are NOT conflicts.
   If conflicts are found, output ONLY a conflict report (see output format) and stop.

2. DOCUMENT RELATIONSHIP ANALYSIS:
   Identify how the documents relate and choose a document strategy:
   - "dissolve": Sources cover the same broad topic — blend freely across cards.
   - "preserve": Sources are distinct sub-topics — keep document boundaries.
   - "hybrid": Some overlap, some distinct — merge overlapping, preserve distinct.

3. CONTENT INVENTORY (do this mentally before deciding card count):
   - List every major topic and section across all documents.
   - For each topic, note which document(s) cover it.
   - Flag topics covered by MULTIPLE documents — these are MERGE candidates. You must NOT plan separate cards for overlapping content. Consolidate into ONE card.
   - Flag topics that are sub-points of a larger topic — NEST under the parent card.

4. CARD COUNT DETERMINATION:
   Determine the optimal number of cards based on the source content and the user's briefing. Consider:
   - The volume and structure of content in the source documents
   - How the material naturally divides into distinct topics
   - The user's audience, objective, and presentation type
   - The LOD word count range per card
   - Logical breakpoints — never split a cohesive idea across cards
   - Minimum 3 content cards, maximum 40 content cards.

5. CARD PLANNING — for each card produce:
   - title: 5 words max, specific to the card's content
   - description: One sentence summarizing what this card covers
   - wordTarget: A specific word count target within the LOD range
   - sources: Reference the specific location within the source document
   - guidance: { emphasis, tone, exclude }
   - crossReferences: How this card relates to other cards in the plan

6. DEDUPLICATION CHECK (do this after planning all cards):
   Review your complete plan. For every pair of cards, verify no two cards cover the same topic.

7. DECISION QUESTIONS (generate 3-5 questions):
   Review your plan and identify critical decision points where the user's choice would meaningfully change the produced content.`;

const REVISION_INSTRUCTIONS = `This is a REVISION request. You previously produced a plan and the user has provided feedback.

Rules for revision:
- Honor all user feedback (general comment and question answers)
- If question answers are provided, incorporate them into the revised plan's guidance fields
- Preserve card numbering for unchanged cards
- If cards were unchecked (excluded), do NOT reintroduce them
- New cards get new numbers appended at the end
- Generate NEW questions only for decisions introduced by the revision
- Include a "revisionNotes" field describing what changed and why`;

function buildOutputSchema(isRevision: boolean): string {
  const revisionField = isRevision ? `\n    "revisionNotes": "string — describe what changed"` : '';
  return `Output format — respond with EXACTLY one of these JSON structures:

CONFLICT RESPONSE (if conflicts found):
{
  "status": "conflict",
  "conflicts": [
    {
      "description": "string",
      "sourceA": { "document": "string", "section": "string" },
      "sourceB": { "document": "string", "section": "string" },
      "severity": "high | medium | low"
    }
  ]
}

SUCCESSFUL PLAN RESPONSE (if no conflicts):
{
  "status": "ok",
  "metadata": {
    "category": "string", "lod": "string", "sourceWordCount": "number",
    "cardCount": "number", "documentStrategy": "dissolve | preserve | hybrid",
    "documentRelationships": "string"
  },
  "cards": [
    {
      "number": "number", "title": "string", "description": "string",
      "sources": [{ "document": "string", "heading": "string", "fallbackDescription": "string" }],
      "wordTarget": "number",
      "guidance": { "emphasis": "string", "tone": "string", "exclude": "string" },
      "crossReferences": "string | null"
    }
  ],
  "questions": [
    {
      "id": "string", "question": "string",
      "options": [{ "key": "string", "label": "string", "producerInstruction": "string" }],
      "recommendedKey": "string", "context": "string"
    }
  ]${revisionField}
}

Rules:
- Do NOT add extra fields. Do NOT omit required fields.
- guidance must be the structured object format, not a plain string.
- questions array must contain 3-5 questions with 2-4 options each.`;
}

function buildBriefingContext(briefing: any): string {
  const lines = [
    `Audience: ${briefing.audience}`,
    `Presentation type: ${briefing.type}`,
    `Objective: ${briefing.objective}`,
  ];
  if (briefing.tone) lines.push(`Tone: ${briefing.tone}`);
  if (briefing.focus) lines.push(`Focus: ${briefing.focus}`);
  if (briefing.minCards != null && briefing.maxCards != null) {
    lines.push(`Card count: between ${briefing.minCards} and ${briefing.maxCards} cards`);
  } else if (briefing.minCards != null) {
    lines.push(`Card count: at least ${briefing.minCards} cards`);
  } else if (briefing.maxCards != null) {
    lines.push(`Card count: at most ${briefing.maxCards} cards`);
  }
  const deckOptions: string[] = [];
  if (briefing.includeCover) deckOptions.push('Include a cover card');
  if (briefing.includeSectionTitles) deckOptions.push('Include section title cards');
  if (briefing.includeClosing) deckOptions.push('Include a closing card');
  if (deckOptions.length > 0) lines.push(`Deck structure:\n${deckOptions.map((o: string) => `- ${o}`).join('\n')}`);
  return lines.join('\n');
}

function buildPlannerPrompt(params: any): { systemBlocks: any[]; messages: any[] } {
  const { briefing, lod, documents, totalWordCount, subject, revision } = params;
  const lodConfig = AUTO_DECK_LOD_LEVELS[lod] || AUTO_DECK_LOD_LEVELS.standard;
  const isRevision = !!revision;
  const expertPriming = buildExpertPriming(subject);

  const systemBlocks: any[] = [{
    text: [
      expertPriming ? `${expertPriming}\n\n${PLANNER_ROLE}` : PLANNER_ROLE,
      '', PLANNER_INSTRUCTIONS, '',
      isRevision ? REVISION_INSTRUCTIONS : '', '',
      buildOutputSchema(isRevision),
    ].filter(Boolean).join('\n'),
    cache: false,
  }];

  const inlineDocuments = documents.filter((d: any) => d.content);
  if (inlineDocuments.length > 0) {
    const docContext = 'Source documents are provided in <document> tags. Reference them by their id attribute.\n\n' +
      inlineDocuments.map((d: any) => `<document id="${d.id}" name="${d.name}" wordCount="${d.wordCount}">\n${d.content}\n</document>`).join('\n\n');
    systemBlocks.push({ text: docContext, cache: true });
  }

  const briefingContext = buildBriefingContext(briefing);

  let userMessage: string;
  if (revision) {
    const excludedLine = revision.excludedCards?.length > 0
      ? `\nExcluded cards (do NOT reintroduce): ${revision.excludedCards.join(', ')}` : '';
    const qaLines = revision.questionAnswers
      ? Object.entries(revision.questionAnswers).filter(([, key]) => key).map(([qId, optionKey]) => `  ${qId}: ${optionKey}`).join('\n') : '';
    const cardCommentLines = Object.entries(revision.cardComments || {})
      .filter(([, comment]) => (comment as string).trim())
      .map(([num, comment]) => `  Card ${num}: ${comment}`).join('\n');

    userMessage = `This is a REVISION of the previous plan.\n\nPrevious plan:\n${JSON.stringify(revision.previousPlan, null, 2)}\n\nUser feedback:\nGeneral comment: ${revision.generalComment || '(none)'}\n${qaLines ? `Question answers:\n${qaLines}` : 'Question answers: (none)'}\n${cardCommentLines ? `Per-card comments:\n${cardCommentLines}` : ''}${excludedLine}\n\n${briefingContext}\n\nLevel of Detail: ${lodConfig.label}\nWord count range per card: ${lodConfig.wordCountMin}\u2013${lodConfig.wordCountMax} words\n\nRevise the plan based on the feedback above.`;
  } else {
    userMessage = `${briefingContext}\n\nLevel of Detail: ${lodConfig.label}\nWord count range per card: ${lodConfig.wordCountMin}\u2013${lodConfig.wordCountMax} words\n\nSource metadata:\n- Total word count: ${totalWordCount}\n- Document count: ${documents.length}\n- Documents (listed in user-specified priority order):\n${documents.map((d: any, i: number) => `  ${i + 1}. ${d.name} (${d.id}, ${d.wordCount} words)`).join('\n')}\n\nABSOLUTE CONSTRAINT: All content must originate exclusively from the provided source documents.\n\nProduce the card plan now.`;
  }

  return { systemBlocks, messages: [{ role: 'user', content: userMessage }] };
}

// ─── Finalizer Prompts ───
const FINALIZER_INSTRUCTIONS = `You are receiving a card plan that was reviewed by the user. The user has:
1. Toggled cards on/off (excluded cards have been removed)
2. Answered multiple-choice decision questions
3. Optionally provided general feedback

Your job is to produce the FINALIZED version of this plan by:
- Incorporating each resolved decision directive into the relevant card(s)' guidance fields
- Incorporating general feedback if provided
- Re-running the deduplication check across the finalized plan
- Outputting the finalized plan with NO questions array

The output plan must be self-contained. The content writer will NOT see the original questions or answers.

IMPORTANT: You are NOT writing content — you are restructuring a plan.

Your output MUST be a single valid JSON object. Do not include any text before or after the JSON.`;

function buildFinalizerSchema(): string {
  return `Output format — respond with EXACTLY this JSON structure:

{
  "status": "ok",
  "metadata": { "category": "string", "lod": "string", "sourceWordCount": "number", "cardCount": "number", "documentStrategy": "string", "documentRelationships": "string" },
  "cards": [
    {
      "number": "number", "title": "string", "description": "string",
      "sources": [{ "document": "string", "heading": "string", "fallbackDescription": "string" }],
      "wordTarget": "number", "keyDataPoints": ["string"],
      "guidance": { "emphasis": "string", "tone": "string", "exclude": "string" },
      "crossReferences": "string | null"
    }
  ]
}

Rules:\n- Do NOT include a questions array.\n- All resolved decisions must be incorporated into the relevant card(s)' guidance fields.`;
}

function buildFinalizerPrompt(params: any): { systemBlocks: any[]; messages: any[] } {
  const { briefing, lod, subject, plan, questions, questionAnswers, generalComment } = params;
  const lodConfig = AUTO_DECK_LOD_LEVELS[lod] || AUTO_DECK_LOD_LEVELS.standard;
  const expertPriming = buildExpertPriming(subject);

  const systemBlocks: any[] = [{
    text: [
      expertPriming ? `${expertPriming}\n\n${FINALIZER_INSTRUCTIONS}` : FINALIZER_INSTRUCTIONS,
      '', buildFinalizerSchema(),
    ].join('\n'),
    cache: false,
  }];

  const resolvedLines: string[] = [];
  (questions || []).forEach((q: any) => {
    const selectedKey = questionAnswers?.[q.id];
    if (selectedKey) {
      const option = q.options.find((o: any) => o.key === selectedKey);
      if (option) resolvedLines.push(`  ${q.id}: ${selectedKey} \u2192 "${option.producerInstruction}"`);
    }
  });

  const briefingContext = buildBriefingContext(briefing);
  const userMessage = `${briefingContext}\n\nLevel of Detail: ${lodConfig.label}\nWord count range per card: ${lodConfig.wordCountMin}\u2013${lodConfig.wordCountMax} words\n\nDraft plan to finalize:\n${JSON.stringify(plan, null, 2)}\n\n${resolvedLines.length > 0 ? `Resolved decisions:\n${resolvedLines.join('\n')}` : 'Resolved decisions: (none)'}\n\nGeneral feedback: ${generalComment?.trim() || '(none)'}\n\nFinalize this plan now.`;

  return { systemBlocks, messages: [{ role: 'user', content: userMessage }] };
}

// ─── Producer Prompts ───
const PRODUCER_ROLE = `You are a presentation content writer. You receive a card plan with source references and you write content for each card.

CRITICAL RULES:
- You write ONLY what the plan specifies.
- Every sentence you write must be directly traceable to the source documents.
- Do NOT infer, extrapolate, assume, or add ANY information beyond what the source documents contain.
- If keyDataPoints are provided, those exact figures/quotes MUST appear in your output.
- If a source reference doesn't match any content, write "[SOURCE NOT FOUND]".
- Do NOT use general knowledge to fill gaps.

Your output MUST be a single valid JSON object.`;

const PRODUCER_INSTRUCTIONS = `Follow this process for each card:

1. LOCATE SOURCES: Find the sections referenced by matching heading text or fallback description.
2. EXTRACT KEY DATA: Identify relevant passages from the source documents.
3. WRITE CONTENT: Using ONLY the located sources and plan guidance:
   - Follow the emphasis specified
   - Match the tone specified
   - Respect the exclusions
   - Make explicit any relationships that are implied in the original (cause-effect, sequence, hierarchy, comparison, part-to-whole)
   - Preserve key data points, statistics, and specific terms exactly as written
   - Use concise, direct phrasing
4. CROSS-CARD DEDUPLICATION: Check that no card repeats content from another.

Allowed content types (use ONLY these - nothing else):
a. Headings (## and ###) for structure
b. Very short statements - concise and direct, never long or compound. NEVER use inline itemization (e.g. "x, y, z and w") - break itemized concepts into bullet points instead
c. Bullet points for unordered sets of items, features, or attributes
d. Numbered lists for sequential steps, ranked items, or ordered processes
e. Tables when comparing items across dimensions or presenting structured data
f. Quotes (>) for key quotes, definitions, or highlighted excerpts from the source

PROHIBITED CHARACTERS: No em dashes, en dashes, arrows, check/cross marks, square bracket annotations, tilde (~), pipe characters (|), or asterisks (*). Use colons, periods, commas, semicolons, hyphens, parentheses, and plain subheadings instead. If the source document contains any of these characters, replace them with their allowed equivalents in your output.`;

function buildFormattingRules(lod: string): string {
  const headingRules = `\n   Heading hierarchy:\n   - Do NOT include a # Card Title heading - just write the body content\n   - Use ## for main sections, ### for subsections\n   - Never skip heading levels\n   - Never use # (H1)\n   - Only number headings when the content has inherent sequential order (steps, phases, stages, ranked items). For thematic, categorical, or parallel content use descriptive headings without numbers`;

  if (lod === 'executive') {
    return `5. FORMAT (Executive level):\n   WORD COUNT: EXACTLY 70-100 words per card. This is a hard limit. Count your output words. If over, cut. If under, add - but NEVER exceed the upper bound.\n   Scope: EXECUTIVE SUMMARY. Prioritize ruthlessly - include only the single most important insight, conclusion, or finding. Omit supporting details, examples, breakdowns, and secondary points.\n   - Maximum one ## heading\n   - No tables, no ###, no blockquotes\n   - Keep content extremely brief given the word limit\n   - Use whichever allowed format best presents each piece of information${headingRules}`;
  }
  if (lod === 'detailed') {
    return `5. FORMAT (Detailed level):\n   WORD COUNT: EXACTLY 450-500 words per card. This is a hard limit. Count your output words. If over, cut. If under, add - but NEVER exceed the upper bound.\n   Scope: DETAILED analysis. Include comprehensive data, supporting evidence, comparisons, and relationships. Cover all relevant dimensions of the topic.\n   - Prefer bullet points, numbered lists, and tables over prose wherever possible\n   - Use tables when comparing items across multiple dimensions or presenting structured data\n   - Use whichever allowed format best presents each piece of information${headingRules}`;
  }
  return `5. FORMAT (Standard level):\n   WORD COUNT: EXACTLY 200-250 words per card. This is a hard limit. Count your output words. If over, cut. If under, add - but NEVER exceed the upper bound.\n   Scope: STANDARD summary. Cover the key points, important data, and primary relationships. Include enough detail to be informative but stay concise.\n   - Prefer bullet points, numbered lists, and tables over prose wherever possible\n   - Use tables when comparing items across multiple dimensions or presenting structured data\n   - Use whichever allowed format best presents each piece of information${headingRules}`;
}

function buildProducerOutputSchema(): string {
  return `Output format:\n{\n  "status": "ok",\n  "cards": [\n    { "number": "number", "title": "string", "content": "string", "wordCount": "number" }\n  ]\n}\n\nDo NOT add extra fields. Do NOT omit cards. Do NOT change titles.`;
}

function formatPlanForProducer(plan: any[]): string {
  return plan.map((card: any) => {
    const sources = (card.sources || []).map((s: any) => {
      const ref = s.heading || s.fallbackDescription || s.section || 'unspecified';
      return `    - ${ref} (from document: ${s.document})`;
    }).join('\n');
    const keyData = (card.keyDataPoints || []).map((d: string) => `    - "${d}"`).join('\n');
    let guidanceText: string;
    if (typeof card.guidance === 'object' && card.guidance !== null) {
      guidanceText = `    Emphasis: ${card.guidance.emphasis}\n    Tone: ${card.guidance.tone}\n    Exclude: ${card.guidance.exclude}`;
    } else {
      guidanceText = `    ${card.guidance}`;
    }
    const wordTargetLine = card.wordTarget ? `\n  Word target: ~${card.wordTarget} words` : '';
    return `Card ${card.number}: ${card.title}\n  Description: ${card.description}${wordTargetLine}\n  Sources:\n${sources}\n  Key data points:\n${keyData || '    (none)'}\n  Guidance:\n${guidanceText}\n  Cross-references: ${card.crossReferences || 'none'}`;
  }).join('\n\n');
}

function buildProducerPrompt(params: any): { systemBlocks: any[]; messages: any[] } {
  const { briefing, lod, subject, plan, documents, batchContext } = params;
  const lodConfig = AUTO_DECK_LOD_LEVELS[lod] || AUTO_DECK_LOD_LEVELS.standard;
  const expertPriming = buildExpertPriming(subject);

  const fullInstructions = [PRODUCER_INSTRUCTIONS, '', buildFormattingRules(lod), '', '6. OUTPUT in the exact JSON format specified.'].join('\n');

  const systemBlocks: any[] = [{
    text: [expertPriming ? `${expertPriming}\n\n${PRODUCER_ROLE}` : PRODUCER_ROLE, '', fullInstructions, '', buildProducerOutputSchema()].join('\n'),
    cache: false,
  }];

  const inlineDocuments = (documents || []).filter((d: any) => d.content);
  if (inlineDocuments.length > 0) {
    const docContext = 'Source documents are provided in <document> tags.\n\n' +
      inlineDocuments.map((d: any) => `<document id="${d.id}" name="${d.name}">\n${d.content}\n</document>`).join('\n\n');
    systemBlocks.push({ text: docContext, cache: true });
  }

  const briefingLines = [`Audience: ${briefing.audience}`, `Presentation type: ${briefing.type}`, `Objective: ${briefing.objective}`];
  if (briefing.tone) briefingLines.push(`Tone: ${briefing.tone}`);
  if (briefing.focus) briefingLines.push(`Focus: ${briefing.focus}`);
  const briefingContext = briefingLines.join('\n');
  const planText = formatPlanForProducer(plan);

  const userMessage = `${briefingContext}\n\nLevel of Detail: ${lodConfig.label}\nWord count range per card: ${lodConfig.wordCountMin}\u2013${lodConfig.wordCountMax} words (STRICT)\n${batchContext ? `\n${batchContext}\n` : ''}\nCard plan to execute:\n\n${planText}\n\nABSOLUTE CONSTRAINT: All content must originate exclusively from the provided source documents.\n\nWrite the content for each card now.`;

  return { systemBlocks, messages: [{ role: 'user', content: userMessage }] };
}

// ─── Streaming Claude API call ───
function callClaudeStreaming(
  systemBlocks: Array<{ text: string; cache: boolean }>,
  messages: any[],
  maxTokens: number,
  temperature?: number,
  fileApiDocs?: Array<{ fileId: string; name: string }>,
): ReadableStream {
  const system = systemBlocks.map((b) => {
    const block: any = { type: 'text', text: b.text };
    if (b.cache) block.cache_control = { type: 'ephemeral' };
    return block;
  });

  const processedMessages = messages.map((m: any) => ({ ...m }));
  if (fileApiDocs && fileApiDocs.length > 0) {
    const docBlocks = fileApiDocs.map((d) => ({
      type: 'document', source: { type: 'file', file_id: d.fileId }, title: d.name,
    }));
    if (processedMessages.length > 0 && processedMessages[0].role === 'user') {
      const firstMsg = processedMessages[0];
      const existingBlocks = typeof firstMsg.content === 'string'
        ? [{ type: 'text', text: firstMsg.content }]
        : [...firstMsg.content];
      processedMessages[0] = { role: 'user', content: [...docBlocks, ...existingBlocks] };
    }
  }

  for (let i = processedMessages.length - 1; i >= 0; i--) {
    if (processedMessages[i].role === 'user') {
      const msg = processedMessages[i];
      if (typeof msg.content === 'string') {
        processedMessages[i] = {
          role: 'user',
          content: [{ type: 'text', text: msg.content, cache_control: { type: 'ephemeral' } }],
        };
      }
      break;
    }
  }

  const body: any = { model: CLAUDE_MODEL, system, messages: processedMessages, max_tokens: maxTokens, stream: true };
  if (temperature !== undefined) body.temperature = temperature;

  const betaFeatures = ['prompt-caching-2024-07-31'];
  if (fileApiDocs && fileApiDocs.length > 0) {
    betaFeatures.push('files-api-2025-04-14');
  }

  return new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      function sendSSE(event: string, data: Record<string, unknown>) {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      }

      try {
        const res = await fetch(ANTHROPIC_API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
            'anthropic-beta': betaFeatures.join(','),
          },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const errBody = await res.json().catch(() => ({ error: { message: `HTTP ${res.status}` } }));
          sendSSE('error', { error: errBody.error?.message || `Claude API failed: ${res.status}` });
          controller.close();
          return;
        }

        const reader = res.body!.getReader();
        const decoder = new TextDecoder();

        let buf = '';
        let fullText = '';
        let outputTokensSoFar = 0;
        let lastReportedTokens = 0;
        const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
        const PROGRESS_INTERVAL = 20;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() || '';

          let currentEvent = '';

          for (const line of lines) {
            if (line.startsWith('event: ')) {
              currentEvent = line.slice(7).trim();
              continue;
            }

            if (line.startsWith('data: ') && currentEvent) {
              const dataStr = line.slice(6);
              if (dataStr === '[DONE]') continue;

              let parsed: any;
              try { parsed = JSON.parse(dataStr); } catch { continue; }

              switch (currentEvent) {
                case 'message_start': {
                  const msgUsage = parsed.message?.usage;
                  if (msgUsage) {
                    usage.input_tokens = msgUsage.input_tokens ?? 0;
                    usage.cache_read_input_tokens = msgUsage.cache_read_input_tokens ?? 0;
                    usage.cache_creation_input_tokens = msgUsage.cache_creation_input_tokens ?? 0;
                  }
                  // Send first progress event immediately to satisfy idle timeout
                  sendSSE('progress', { tokens: 0 });
                  break;
                }

                case 'content_block_delta': {
                  const delta = parsed.delta;
                  if (delta?.type === 'text_delta' && delta.text) {
                    fullText += delta.text;
                    outputTokensSoFar = Math.ceil(fullText.length / 4);
                    // Stream the actual text delta to the client
                    sendSSE('delta', { text: delta.text });
                    if (outputTokensSoFar - lastReportedTokens >= PROGRESS_INTERVAL) {
                      lastReportedTokens = outputTokensSoFar;
                      sendSSE('progress', { tokens: outputTokensSoFar });
                    }
                  }
                  break;
                }

                case 'message_delta': {
                  const deltaUsage = parsed.usage;
                  if (deltaUsage) {
                    usage.output_tokens = deltaUsage.output_tokens ?? 0;
                  }
                  break;
                }

                case 'error': {
                  sendSSE('error', { error: parsed.error?.message || 'Claude streaming error' });
                  controller.close();
                  return;
                }
              }

              currentEvent = '';
            }
          }
        }

        // Stream complete — send done with usage only (client accumulated text from delta events)
        sendSSE('done', {
          success: true,
          usage: {
            inputTokens: usage.input_tokens,
            outputTokens: usage.output_tokens,
            cacheReadTokens: usage.cache_read_input_tokens,
            cacheWriteTokens: usage.cache_creation_input_tokens,
          },
        });
        controller.close();
      } catch (err: any) {
        try { sendSSE('error', { error: err.message || 'Unexpected streaming error' }); } catch { /* closed */ }
        try { controller.close(); } catch { /* closed */ }
      }
    },
  });
}

// ─── Main handler ───
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Missing Authorization header');

    const anonKey = req.headers.get('apikey') || Deno.env.get('SUPABASE_ANON_KEY');
    if (!anonKey) throw new Error('Missing API key');
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL')!, anonKey,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) throw new Error('Unauthorized');

    const body = await req.json();
    const { action } = body;

    if (action === 'plan' || action === 'revise') {
      const { briefing, lod, subject, documents = [], totalWordCount = 0, revision, qualityReport } = body;

      const fileApiDocs = documents.filter((d: any) => d.fileId).map((d: any) => ({ fileId: d.fileId, name: d.name }));

      const allDocsMeta = documents.map((d: any) => ({
        id: d.id,
        name: d.name,
        wordCount: d.content ? countWords(d.content) : (d.structure || []).reduce((sum: number, h: any) => sum + (h.wordCount ?? 0), 0),
        content: d.fileId ? '' : (d.content || ''),
      }));

      const params: any = { briefing, lod, subject, documents: allDocsMeta, totalWordCount };
      if (action === 'revise') params.revision = revision;

      const { systemBlocks, messages } = buildPlannerPrompt(params);

      const qw = buildQualityWarningsBlock(qualityReport);
      if (qw) systemBlocks.push({ text: qw, cache: false });

      const stream = callClaudeStreaming(
        systemBlocks, messages, 8192, 0.1,
        fileApiDocs.length > 0 ? fileApiDocs : undefined,
      );

      return new Response(stream, { headers: sseHeaders });
    }

    if (action === 'finalize') {
      const { briefing, lod, subject, plan, questions, questionAnswers, generalComment } = body;

      const { systemBlocks, messages } = buildFinalizerPrompt({ briefing, lod, subject, plan, questions, questionAnswers, generalComment });

      const stream = callClaudeStreaming(systemBlocks, messages, 16384, 0.1);

      return new Response(stream, { headers: sseHeaders });
    }

    if (action === 'produce') {
      const { briefing, lod, subject, planCards, documents = [], batchContext, qualityReport, maxTokens = 16384 } = body;

      const fileApiDocs = documents.filter((d: any) => d.fileId).map((d: any) => ({ fileId: d.fileId, name: d.name }));
      const producerDocs = documents.map((d: any) => ({ id: d.id, name: d.name, content: d.fileId ? '' : (d.content || '') }));

      const { systemBlocks, messages } = buildProducerPrompt({ briefing, lod, subject, plan: planCards, documents: producerDocs, batchContext });

      const qw = buildQualityWarningsBlock(qualityReport);
      if (qw) systemBlocks.push({ text: qw, cache: false });

      const stream = callClaudeStreaming(
        systemBlocks, messages, maxTokens, undefined,
        fileApiDocs.length > 0 ? fileApiDocs : undefined,
      );

      return new Response(stream, { headers: sseHeaders });
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (err: any) {
    console.error('auto-deck error:', err);
    const status = err.message === 'Unauthorized' ? 401 : 400;
    return new Response(
      JSON.stringify({ error: err.message || 'Internal error' }),
      { status, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
    );
  }
});
