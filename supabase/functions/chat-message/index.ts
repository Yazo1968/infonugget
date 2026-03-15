import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

// ─── Constants ───
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;
const CLAUDE_MODEL = 'claude-sonnet-4-6';
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

const CARD_TOKEN_LIMITS: Record<string, number> = {
  TitleCard: 150, TakeawayCard: 350, Executive: 95, Standard: 203, Detailed: 405,
};
const COVER_TOKEN_LIMIT = 256;
const CHAT_MAX_TOKENS = 8192;
const INITIATE_CHAT_MAX_TOKENS = 512;
const COMPACT_MAX_TOKENS = 1024;

const MODEL_CONTEXT_WINDOW = 200_000;
const SAFETY_MARGIN_TOKENS = 2_000;
const CHARS_PER_TOKEN = 4;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey',
};

const PROHIBITED_CHARS_INSTRUCTION = 'PROHIBITED CHARACTERS: No em dashes (\u2014), en dashes (\u2013), arrows (\u2192), check/cross marks (\u2713\u2717), blockquote markers (>), square bracket annotations, tilde (~), pipe characters (|), or asterisks (*). Use colons, periods, commas, semicolons, hyphens, parentheses, and plain subheadings instead. If the source document contains any of these characters, replace them with their allowed equivalents in your output.';

// ─── Type helpers ───
function isCoverLevel(level: string): boolean {
  return level === 'TitleCard' || level === 'TakeawayCard';
}

// ─── Token estimation ───
function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function computeMessageBudget(
  systemBlocks: Array<{ text: string }>,
  maxOutputTokens: number,
): number {
  const systemTokens = systemBlocks.reduce((sum, b) => sum + estimateTokens(b.text), 0);
  return MODEL_CONTEXT_WINDOW - SAFETY_MARGIN_TOKENS - systemTokens - maxOutputTokens;
}

interface HistoryMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  isCardContent?: boolean;
}

interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string | any[];
}

function pruneMessages(
  history: HistoryMessage[],
  currentUserText: string,
  tokenBudget: number,
): { claudeMessages: ClaudeMessage[]; dropped: number } {
  const filtered = history.filter((m) => !(m.isCardContent && m.role === 'assistant'));

  const allMessages: ClaudeMessage[] = [];
  for (let i = 0; i < filtered.length; i++) {
    const msg = filtered[i];
    if (msg.role === 'system') {
      let merged = msg.content;
      while (i + 1 < filtered.length && filtered[i + 1].role === 'system') {
        i++;
        merged += '\n\n' + filtered[i].content;
      }
      allMessages.push({ role: 'user', content: merged });
      allMessages.push({ role: 'assistant', content: 'Noted.' });
      continue;
    }
    allMessages.push({ role: msg.role as 'user' | 'assistant', content: msg.content });
  }

  const newUserMsg: ClaudeMessage = { role: 'user', content: currentUserText };
  let remaining = tokenBudget - estimateTokens(currentUserText);

  if (remaining <= 0) {
    return { claudeMessages: [newUserMsg], dropped: allMessages.length };
  }

  const kept: ClaudeMessage[] = [];
  let dropped = 0;

  for (let i = allMessages.length - 1; i >= 0; i--) {
    const msg = allMessages[i];
    const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
    const cost = estimateTokens(content);
    if (cost <= remaining) {
      kept.unshift(msg);
      remaining -= cost;
    } else {
      dropped++;
    }
  }

  if (dropped > 0) {
    const notice: ClaudeMessage = {
      role: 'user',
      content: `[Note: ${dropped} earlier messages were trimmed to fit the context window. The conversation continues from the remaining messages below.]`,
    };
    const ack: ClaudeMessage = {
      role: 'assistant',
      content: "Understood. I'll continue based on the available conversation context and the source documents.",
    };
    const noticeCost = estimateTokens(notice.content as string) + estimateTokens(ack.content as string);
    if (noticeCost <= remaining) {
      kept.unshift(notice, ack);
    }
  }

  kept.push(newUserMsg);
  return { claudeMessages: kept, dropped };
}

// ─── Prompt builders ───

function buildExpertPriming(domain?: string): string {
  if (!domain || !domain.trim()) return '';
  return `You are a subject-matter expert in ${domain.trim()}.`;
}

const SUGGESTION_SPEC = `**Card Suggestions:**
At the end of every response, include 2-4 suggested follow-up prompts in a fenced block.

GROUNDING (mandatory):
- Every suggestion MUST be answerable from the provided source documents. Never suggest topics, facts, or angles not present in the sources.

RELEVANCE:
- Align with the engagement purpose and the user's stated interests and persona.
- Maintain logical continuity with the conversation thread — each suggestion should feel like a natural next step.

COVERAGE:
- Surface document topics not yet explored in the conversation.
- Suggest cross-document connections when multiple sources exist.
- If conversation has been broad, suggest depth; if deep, suggest breadth.

VARIETY:
- Mix action types: generate a card, compare, contrast, summarize, analyze risks or implications.
- Match the user's preferred detail level.
- When enough cards exist, suggest structural cards (cover, closing, summary).

ANTI-PATTERNS:
- Never repeat or closely rephrase a suggestion already used, answered, or that produced a card.
- Never suggest what the user just rejected or skipped.
- Never parrot the user's words — rephrase and extend.
- Escalate complexity gradually over the conversation.

Format:
\`\`\`card-suggestions
Generate a card summarizing the key findings
Create a comparison card of the main themes across documents
\`\`\`

Each suggestion: concise, actionable, under 15 words. Tailor to the specific conversation context — reference actual topics, themes, or data from the documents.`;

function buildInsightsSystemPrompt(domain?: string): string {
  const expertPriming = buildExpertPriming(domain);
  const roleStatement = expertPriming
    ? `${expertPriming} You also serve as an expert document analyst and content strategist.`
    : 'You are an expert document analyst and content strategist.';

  return `${roleStatement} The user has uploaded one or more documents for you to analyze. You have access to the full content of these documents.

**Your role:**
- Answer questions about the documents accurately and thoroughly
- Help the user explore and understand their source material
- When asked to generate card content, produce structured, infographic-ready text

**Conversation style:**
- Always start your response with a single # heading that summarizes the answer
- Structure every response clearly: use ## subheadings for distinct sections, paragraphs for narrative, bullet points for lists of items, numbered lists for sequences or ranked items, tables for comparisons, and blockquotes for notable callouts
- Be direct and substantive \u2014 avoid filler
- Reference specific content from the documents when answering
- Keep paragraphs short (2-4 sentences) with clear separation between ideas
- When comparing across documents, clearly attribute information to its source
- Never use emojis or emoticons

**Document context:**
- The documents provided in the system context are always the current, authoritative set
- If the conversation history references documents that are not in the current system context, those documents have been removed or deactivated \u2014 do not reference them
- If you see a [Document Update] system message, it means the document set changed at that point in the conversation \u2014 adjust your understanding accordingly
- When documents change, base all subsequent answers solely on the current document set

**Important:**
- Never fabricate information not present in the documents
- If something isn't covered in the documents, say so clearly
- Preserve all data points, statistics, and specific terms exactly as they appear in the source material

${SUGGESTION_SPEC}`;
}

function buildCardContentInstruction(detailLevel: string): string {
  let wordCountRange = '120-150';
  let scopeGuidance = '';
  let formattingGuidance = '';

  if (detailLevel === 'Executive') {
    wordCountRange = '50-70';
    scopeGuidance = 'This is an EXECUTIVE SUMMARY. Prioritize ruthlessly - include only the single most important insight, conclusion, or finding. Omit supporting details, examples, breakdowns, and secondary points. No tables. No sub-sections. Use at most 2-3 bullet points or a single short paragraph under one ## heading. Think: what would a CEO need to see in a 10-second glance?';
    formattingGuidance = `- Use bold for 1-2 key metrics or terms only
- Maximum one ## heading below the title
- No tables, no ###, no blockquotes
- Prefer a tight paragraph or 2-3 bullets - nothing more`;
  } else if (detailLevel === 'Detailed') {
    wordCountRange = '250-300';
    scopeGuidance = 'This is a DETAILED analysis. Include comprehensive data, supporting evidence, comparisons, and relationships. Use the full markdown range including tables where data warrants it. Cover all relevant dimensions of the topic.';
    formattingGuidance = `- Use bullet points for lists of features, attributes, or non-sequential items
- Use numbered lists for sequential steps, ranked items, or ordered processes
- Use tables when comparing items across multiple dimensions or presenting structured data
- Use bold for key terms, metrics, and important phrases
- Choose the format that best represents the data`;
  } else {
    scopeGuidance = 'This is a STANDARD summary. Cover the key points, important data, and primary relationships. Include enough detail to be informative but stay concise.';
    formattingGuidance = `- Use bullet points for lists of features, attributes, or non-sequential items
- Use numbered lists for sequential steps, ranked items, or ordered processes
- Use tables only when comparing 3+ items across multiple dimensions
- Use bold for key terms, metrics, and important phrases
- Choose the format that best represents the data`;
  }

  return `CARD CONTENT GENERATION MODE - THIS OVERRIDES ALL OTHER INSTRUCTIONS.

CRITICAL: Your response MUST begin with a single # heading as the card title. This is mandatory - every card needs a title. The heading should be concise and descriptive (2-8 words). Never omit the # title heading.

WORD COUNT: EXACTLY ${wordCountRange} words. This is a hard limit. Count your output words before responding. If over, cut. If under, you may add - but NEVER exceed the upper bound. The # title heading does NOT count toward the word limit.

**Scope:** ${scopeGuidance}

**Analysis task:**
1. Re-read the source documents in full - do not rely on conversation memory
2. Identify content relevant to the user's request
3. Extract and restructure into infographic-ready text within the word limit

**Content rules:**
- Make the topic's hierarchy and connections immediately clear without referring back to the source
- Make implicit relationships explicit (cause-effect, sequence, hierarchy, comparison)
- Concise, direct phrasing - no filler, no repetition
- Preserve data points and statistics exactly as written in the documents
- Do not invent information not present in the documents

**Heading hierarchy:**
- Start with a single # heading as the card title (concise, descriptive)
- Use ## for sections, ### for subsections (if word count permits)
- Never skip heading levels

**Formatting:**
${formattingGuidance}

${PROHIBITED_CHARS_INSTRUCTION}

**Output:**
Return the card content starting with #, then on a new line after the card content, include a card-suggestions block with 2-4 follow-up suggestions.

The suggestions must follow the same grounding and anti-pattern rules: only suggest what the source documents can answer, never repeat topics already covered by generated cards, and vary action types.

REMINDER: Always start with # [Title]. ${wordCountRange} words maximum (excluding suggestions block). Count before responding.`.trim();
}

function buildCoverContentInstruction(coverType: string): string {
  if (coverType === 'TitleCard') {
    return `COVER SLIDE GENERATION MODE - THIS OVERRIDES ALL OTHER INSTRUCTIONS.

You are generating content for a TITLE CARD SLIDE - a bold, visual-first opener, not a data infographic.

**Output format (strict):**
\`\`\`
# [Title - bold, concise, impactful, 2-8 words]
## [Subtitle - one line that adds context or scope, 5-12 words]
[Tagline - optional short phrase for branding, attribution, or date, 3-8 words]
\`\`\`

**WORD COUNT:** 15-25 words total across all three lines. This is a hard limit.

**Rules:**
- The title is the hero - make it bold, memorable, and instantly clear
- The subtitle provides scope, context, or framing (e.g., "Annual Performance Review 2024", "A Deep Dive into Market Trends")
- The tagline is optional - use it for attribution, dates, division names, or a short brand phrase
- Do NOT include body text, bullet points, data, statistics, tables, or sections
- Do NOT include any markdown formatting beyond the # and ## heading markers
- Re-read the source documents to extract the most fitting title and context
- Base the title on the user's prompt and the document content

${PROHIBITED_CHARS_INSTRUCTION}

**Output:** Return the cover content starting with #, then on a new line include a card-suggestions block with 2-4 follow-up suggestions.

REMINDER: 15-25 words maximum (excluding suggestions block). This is a cover slide, not a content card.`.trim();
  }

  return `COVER SLIDE GENERATION MODE - THIS OVERRIDES ALL OTHER INSTRUCTIONS.

You are generating content for a TAKEAWAY CARD SLIDE - a bold title paired with the key takeaways as bullet points.

**Output format (strict):**
\`\`\`
# [Title - bold, concise, impactful, 2-8 words]
- [Takeaway bullet 1 - a key finding, insight, or conclusion]
- [Takeaway bullet 2 - another key finding]
- [Takeaway bullet 3 - another key finding (optional)]
- [Takeaway bullet 4 - another key finding (optional)]
\`\`\`

**WORD COUNT:** 40-60 words total (title + all bullets combined). This is a hard limit.

**Rules:**
- The title is the hero - make it bold, memorable, and instantly clear
- Include 2-4 bullet points capturing the most important takeaways from the documents
- Each bullet should be a concise, self-contained insight - specific and data-informed where possible
- Include key metrics, statistics, or concrete findings in the bullets
- Use markdown bullet points (- ) for each takeaway
- Do NOT include body text, tables, numbered lists, multiple paragraphs, or sub-sections
- Do NOT include any markdown formatting beyond the # heading marker and bullet dashes
- Re-read the source documents to extract the most impactful findings relevant to the user's prompt

${PROHIBITED_CHARS_INSTRUCTION}

**Output:** Return the cover content starting with #, then on a new line include a card-suggestions block with 2-4 follow-up suggestions.

REMINDER: 40-60 words maximum (excluding suggestions block). This is a cover slide, not a content card.`.trim();
}

function buildInitiateChatPrompt(domain?: string): string {
  const expertPriming = buildExpertPriming(domain);
  const roleStatement = expertPriming
    ? `${expertPriming} You are performing an initial review of the uploaded documents.`
    : 'You are a document analyst performing an initial review of uploaded documents.';

  return `${roleStatement}

Produce a brief overview of each document and suggest exploration prompts. Respond with ONLY the two fenced blocks below - no other text before, between, or after them.

\`\`\`document-log
- **Annual Report 2024** (PDF) - Revenue grew 12% driven by cloud services expansion
- **Market Analysis** (Markdown) - Competitive landscape across five regional segments
\`\`\`

Follow this exact format for every document. Each brief must be specific to the actual content (mention key topics, entities, or findings) - never generic. Maximum 12 words per brief.

\`\`\`card-suggestions
Compare revenue trends across the two reporting periods
Summarize the competitive positioning in the APAC segment
\`\`\`

Include 2-4 exploration prompts tailored to the documents, under 15 words each. Suggestions should help explore relationships, insights, or comparisons across documents.`;
}

function buildCompactPrompt(): string {
  return `You are a conversation summarizer. Produce a structured summary of the conversation history in the exact format below. Be precise and factual — only include what actually occurred.

Output ONLY the fenced block — no other text.

\`\`\`chat-context
Discussion:
- [topic user asked about] → [brief answer given, 10-15 words max]

Cards generated:
- "[exact card title]" ([detail level]) — [angle/focus, 5-10 words]

User profile: [observed preferences: detail level, topics of interest, style]
Skipped: [suggestions offered but not picked, if any]
Unexplored in sources: [document topics not yet discussed, if identifiable]
\`\`\`

Rules:
- Discussion entries: one line per user question, include the gist of the answer
- Cards generated: distinguish from discussion — only list messages that were card content generation
- User profile: infer from their choices and questions, not from what they said about themselves
- Skipped: only include suggestions that were visibly offered and not acted upon
- Unexplored: only mention topics you can confirm exist in the source documents
- If a section has no entries, write "None" on that line`;
}

function buildTocSystemPrompt(bookmarks: any[], docName: string): string {
  if (!bookmarks || bookmarks.length === 0) return '';

  const lines: string[] = [];
  lines.push(`Table of Contents for "${docName}":`);
  lines.push('');

  const walk = (nodes: any[], indent: number) => {
    for (const node of nodes) {
      const prefix = '  '.repeat(indent);
      lines.push(`${prefix}- ${node.title} (page ${node.page})`);
      if (node.children && node.children.length > 0) walk(node.children, indent + 1);
    }
  };
  walk(bookmarks, 0);

  return lines.join('\n');
}

// ─── Claude API call ───
async function callClaudeAPI(
  systemBlocks: Array<{ text: string; cache: boolean }>,
  messages: ClaudeMessage[],
  maxTokens: number,
  temperature?: number,
): Promise<{ text: string; usage: any }> {
  const system = systemBlocks.map((b) => {
    const block: any = { type: 'text', text: b.text };
    if (b.cache) block.cache_control = { type: 'ephemeral' };
    return block;
  });

  const processedMessages = messages.map((m) => ({ ...m }));
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

  const body: any = {
    model: CLAUDE_MODEL,
    system,
    messages: processedMessages,
    max_tokens: maxTokens,
  };
  if (temperature !== undefined) body.temperature = temperature;

  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'prompt-caching-2024-07-31,files-api-2025-04-14',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({ error: { message: `HTTP ${res.status}` } }));
    throw new Error(errBody.error?.message || `Claude API failed: ${res.status}`);
  }

  const data = await res.json();
  const textBlock = data.content?.find((b: any) => b.type === 'text');
  return {
    text: textBlock?.text || '',
    usage: data.usage || {},
  };
}

// ─── Main handler ───
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const {
      action,
      userText,
      isCardRequest = false,
      detailLevel,
      conversationHistory = [],
      domain,
      documents = [],
    } = body;

    const fileApiDocs = documents.filter((d: any) => d.fileId);
    const inlineDocs = documents.filter((d: any) => !d.fileId && d.content);

    if (action === 'initiate_chat') {
      if (documents.length === 0) throw new Error('No documents provided');

      const systemBlocks: Array<{ text: string; cache: boolean }> = [
        { text: buildInitiateChatPrompt(domain), cache: false },
      ];

      if (inlineDocs.length > 0) {
        const docContext = inlineDocs
          .map((d: any) => `--- Document: ${d.name} ---\n${d.content}\n--- End Document ---`)
          .join('\n\n');
        systemBlocks.push({ text: `Current documents:\n\n${docContext}`, cache: false });
      }

      for (const d of fileApiDocs) {
        if (d.sourceType === 'native-pdf' && d.bookmarks?.length) {
          const tocPrompt = buildTocSystemPrompt(d.bookmarks, d.name);
          if (tocPrompt) systemBlocks.push({ text: tocPrompt, cache: false });
        }
      }

      const docList = documents.map((d: any) => d.name).join(', ');
      const syntheticText = `Review these documents: ${docList}`;

      const claudeMessages: ClaudeMessage[] = [];
      if (fileApiDocs.length > 0) {
        const docBlocks = fileApiDocs.map((d: any) => ({
          type: 'document',
          source: { type: 'file', file_id: d.fileId },
          title: d.name,
        }));
        claudeMessages.push({
          role: 'user',
          content: [...docBlocks, { type: 'text', text: syntheticText }],
        });
      } else {
        claudeMessages.push({ role: 'user', content: syntheticText });
      }

      const { text: responseText, usage } = await callClaudeAPI(
        systemBlocks,
        claudeMessages,
        INITIATE_CHAT_MAX_TOKENS,
        0.5,
      );

      return new Response(JSON.stringify({
        success: true,
        responseText,
        usage: {
          inputTokens: usage.input_tokens ?? 0,
          outputTokens: usage.output_tokens ?? 0,
          cacheReadTokens: usage.cache_read_input_tokens ?? 0,
          cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
        },
      }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    if (action === 'send_message') {
      if (!userText?.trim()) throw new Error('Missing userText');

      const systemBlocks: Array<{ text: string; cache: boolean }> = [
        { text: buildInsightsSystemPrompt(domain), cache: false },
      ];

      if (inlineDocs.length > 0) {
        const docContext = inlineDocs
          .map((d: any) => `--- Document: ${d.name} ---\n${d.content}\n--- End Document ---`)
          .join('\n\n');
        systemBlocks.push({ text: `Current documents:\n\n${docContext}`, cache: true });
      }

      if (isCardRequest && detailLevel) {
        if (isCoverLevel(detailLevel)) {
          systemBlocks.push({ text: buildCoverContentInstruction(detailLevel), cache: false });
        } else {
          systemBlocks.push({ text: buildCardContentInstruction(detailLevel), cache: false });
        }
      }

      let maxTokens = CHAT_MAX_TOKENS;
      if (isCardRequest && detailLevel) {
        maxTokens = isCoverLevel(detailLevel)
          ? (CARD_TOKEN_LIMITS[detailLevel] ?? COVER_TOKEN_LIMIT)
          : (CARD_TOKEN_LIMITS[detailLevel] ?? CARD_TOKEN_LIMITS.Detailed);
      }

      const messageBudget = computeMessageBudget(systemBlocks, maxTokens);
      if (messageBudget <= 0) {
        return new Response(JSON.stringify({
          success: true,
          responseText: 'Your documents are too large to fit in the context window. Try disabling some documents or removing large ones to free up space.',
          budgetExceeded: true,
          usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
        }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      const { claudeMessages, dropped } = pruneMessages(
        conversationHistory,
        userText.trim(),
        messageBudget,
      );

      for (const d of fileApiDocs) {
        if (d.sourceType === 'native-pdf' && d.bookmarks?.length) {
          const tocPrompt = buildTocSystemPrompt(d.bookmarks, d.name);
          if (tocPrompt) systemBlocks.push({ text: tocPrompt, cache: true });
        }
      }

      if (fileApiDocs.length > 0) {
        const docBlocks = fileApiDocs.map((d: any) => ({
          type: 'document',
          source: { type: 'file', file_id: d.fileId },
          title: d.name,
        }));

        if (claudeMessages.length > 0 && claudeMessages[0].role === 'user') {
          const firstMsg = claudeMessages[0];
          const existingBlocks =
            typeof firstMsg.content === 'string'
              ? [{ type: 'text', text: firstMsg.content }]
              : [...(firstMsg.content as any[])];
          claudeMessages[0] = { role: 'user', content: [...docBlocks, ...existingBlocks] };
        } else {
          claudeMessages.unshift({
            role: 'user',
            content: [...docBlocks, { type: 'text', text: 'Please analyze the documents provided above.' }],
          });
        }
      }

      const { text: responseText, usage } = await callClaudeAPI(
        systemBlocks,
        claudeMessages,
        maxTokens,
      );

      return new Response(JSON.stringify({
        success: true,
        responseText,
        messagesPruned: dropped,
        usage: {
          inputTokens: usage.input_tokens ?? 0,
          outputTokens: usage.output_tokens ?? 0,
          cacheReadTokens: usage.cache_read_input_tokens ?? 0,
          cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
        },
      }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    if (action === 'compact') {
      if (conversationHistory.length === 0) throw new Error('No conversation history to compact');

      const systemBlocks: Array<{ text: string; cache: boolean }> = [
        { text: buildCompactPrompt(), cache: false },
      ];

      // Build the conversation as a single user message for summarization
      const transcript = conversationHistory
        .map((m: HistoryMessage) => {
          const prefix = m.isCardContent ? `[${m.role} — card content]` : `[${m.role}]`;
          return `${prefix} ${m.content}`;
        })
        .join('\n\n');

      const claudeMessages: ClaudeMessage[] = [
        { role: 'user', content: `Summarize this conversation:\n\n${transcript}` },
      ];

      const { text: responseText, usage } = await callClaudeAPI(
        systemBlocks,
        claudeMessages,
        COMPACT_MAX_TOKENS,
        0.2,
      );

      return new Response(JSON.stringify({
        success: true,
        responseText,
        usage: {
          inputTokens: usage.input_tokens ?? 0,
          outputTokens: usage.output_tokens ?? 0,
          cacheReadTokens: usage.cache_read_input_tokens ?? 0,
          cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
        },
      }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (err: any) {
    console.error('chat-message error:', err.message || err);
    return new Response(
      JSON.stringify({ error: err.message || 'Internal error' }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
    );
  }
});
