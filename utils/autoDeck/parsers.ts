import { ParsedPlan, PlanQuestion, ConflictItem, AutoDeckLod, BriefingSuggestions, BriefingSuggestionOption, BriefingFieldName } from '../../types';
import { createLogger } from '../logger';

const log = createLogger('AutoDeckParser');

// ── JSON extraction helper ──

/**
 * Extract a JSON object from a response string.
 * Handles: raw JSON, markdown code fences (```json ... ```), and leading/trailing text.
 */
function extractJson(raw: string): string {
  let text = raw.trim();

  // Strip markdown code fences
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }

  // Find the outermost JSON object
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    text = text.substring(firstBrace, lastBrace + 1);
  }

  return text;
}

/**
 * Repair common LLM JSON issues: escape literal control characters inside string values.
 * Walks the JSON character-by-character, tracking string boundaries, and escapes
 * literal newlines/tabs/etc. that the LLM forgot to escape.
 */
function repairJsonControlChars(raw: string): string {
  let result = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];

    if (escaped) {
      result += ch;
      escaped = false;
      continue;
    }

    if (ch === '\\' && inString) {
      result += ch;
      escaped = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      result += ch;
      continue;
    }

    if (inString) {
      if (ch === '\n') { result += '\\n'; continue; }
      if (ch === '\r') { result += '\\r'; continue; }
      if (ch === '\t') { result += '\\t'; continue; }
    }

    result += ch;
  }

  return result;
}

// ── Planner response parser ──

type PlannerResult =
  | { status: 'ok'; plan: ParsedPlan }
  | { status: 'conflict'; conflicts: ConflictItem[] }
  | { status: 'error'; error: string };

export function parsePlannerResponse(raw: string): PlannerResult {
  try {
    const json = JSON.parse(extractJson(raw));

    if (json.status === 'conflict') {
      if (!Array.isArray(json.conflicts) || json.conflicts.length === 0) {
        return { status: 'error', error: 'Planner returned conflict status but no conflicts array.' };
      }
      const conflicts: ConflictItem[] = json.conflicts.map((c: any) => ({
        description: String(c.description || ''),
        sourceA: {
          document: String(c.sourceA?.document || c.source_a?.document || ''),
          section: String(c.sourceA?.section || c.source_a?.section || ''),
        },
        sourceB: {
          document: String(c.sourceB?.document || c.source_b?.document || ''),
          section: String(c.sourceB?.section || c.source_b?.section || ''),
        },
        severity: (['high', 'medium', 'low'].includes(c.severity) ? c.severity : 'medium') as ConflictItem['severity'],
      }));
      return { status: 'conflict', conflicts };
    }

    if (json.status === 'ok') {
      const meta = json.metadata;
      if (!meta || !Array.isArray(json.cards)) {
        return { status: 'error', error: 'Planner response missing metadata or cards array.' };
      }

      const parsedPlan: ParsedPlan = {
        metadata: {
          category: String(meta.category || ''),
          lod: String(meta.lod || '') as AutoDeckLod,
          sourceWordCount: Number(meta.sourceWordCount || meta.source_word_count || 0),
          cardCount: Number(meta.cardCount || meta.card_count || json.cards.length),
          documentStrategy: (['dissolve', 'preserve', 'hybrid'].includes(
            meta.documentStrategy || meta.document_strategy,
          )
            ? meta.documentStrategy || meta.document_strategy
            : 'dissolve') as ParsedPlan['metadata']['documentStrategy'],
          documentRelationships: String(meta.documentRelationships || meta.document_relationships || ''),
        },
        cards: json.cards.map((c: any) => ({
          number: Number(c.number || 0),
          title: String(c.title || ''),
          description: String(c.description || ''),
          sources: Array.isArray(c.sources)
            ? c.sources.map((s: any) => ({
                document: String(s.document || ''),
                // Support both new (heading/fallbackDescription) and legacy (section) formats
                ...(s.section ? { section: String(s.section) } : {}),
                ...(s.heading ? { heading: String(s.heading) } : {}),
                ...(s.fallbackDescription ? { fallbackDescription: String(s.fallbackDescription) } : {}),
              }))
            : [],
          // Support wordTarget (per-card word count)
          ...(c.wordTarget != null ? { wordTarget: Number(c.wordTarget) } : {}),
          // Support keyDataPoints (new format)
          ...(Array.isArray(c.keyDataPoints) ? { keyDataPoints: c.keyDataPoints.map(String) } : {}),
          // Support both structured guidance (new) and string guidance (legacy)
          guidance:
            typeof c.guidance === 'object' && c.guidance !== null
              ? {
                  emphasis: String(c.guidance.emphasis || ''),
                  tone: String(c.guidance.tone || ''),
                  exclude: String(c.guidance.exclude || ''),
                }
              : String(c.guidance || ''),
          // Support crossReferences (new format)
          ...(c.crossReferences != null
            ? { crossReferences: c.crossReferences === null ? null : String(c.crossReferences) }
            : {}),
        })),
        // Parse planner-generated decision questions (optional — backward compatible)
        ...(Array.isArray(json.questions) && json.questions.length > 0
          ? {
              questions: json.questions.map(
                (q: any): PlanQuestion => ({
                  id: String(q.id || ''),
                  question: String(q.question || ''),
                  options: Array.isArray(q.options)
                    ? q.options.map((o: any) => ({
                        key: String(o.key || ''),
                        label: String(o.label || ''),
                        producerInstruction: String(o.producerInstruction || ''),
                      }))
                    : [],
                  recommendedKey: String(q.recommendedKey || ''),
                  ...(q.context ? { context: String(q.context) } : {}),
                }),
              ),
            }
          : {}),
      };

      if (parsedPlan.cards.length === 0) {
        return { status: 'error', error: 'Planner returned ok status but no cards.' };
      }

      return { status: 'ok', plan: parsedPlan };
    }

    return { status: 'error', error: `Unexpected planner status: ${json.status}` };
  } catch (err: any) {
    return { status: 'error', error: `Failed to parse planner response: ${err.message}` };
  }
}

// ── Finalizer response parser ──

/**
 * Parse the finalizer response. The finalizer outputs the same plan format
 * as the planner, but should NOT contain questions. If any slip through,
 * we strip them so the producer receives a clean, self-contained plan.
 */
export function parseFinalizerResponse(raw: string): PlannerResult {
  const result = parsePlannerResponse(raw);
  if (result.status === 'ok' && result.plan.questions) {
    result.plan.questions = undefined;
  }
  return result;
}

// ── Producer response parser ──

export interface ProducedCard {
  number: number;
  title: string;
  content: string;
  wordCount: number;
}

type ProducerResult = { status: 'ok'; cards: ProducedCard[] } | { status: 'error'; error: string };

// ── Briefing suggestions parser ──

export type SuggestBriefingResult =
  | { status: 'ok'; suggestions: BriefingSuggestions }
  | { status: 'error'; error: string };

const BRIEFING_FIELDS: BriefingFieldName[] = ['objective', 'audience', 'type', 'focus', 'tone'];

export function parseSuggestBriefingResponse(raw: string): SuggestBriefingResult {
  const extracted = extractJson(raw);
  const attempts: { label: string; text: string }[] = [
    { label: 'strict', text: extracted },
    { label: 'repaired', text: repairJsonControlChars(extracted) },
  ];

  let lastError = '';
  for (const attempt of attempts) {
    try {
      const json = JSON.parse(attempt.text);

      const suggestions: BriefingSuggestions = {
        objective: [], audience: [], type: [], focus: [], tone: [],
      };

      for (const field of BRIEFING_FIELDS) {
        const arr = json[field];
        if (!Array.isArray(arr) || arr.length === 0) {
          lastError = `Field "${field}" missing or empty in response.`;
          continue;
        }
        suggestions[field] = arr
          .map((item: any): BriefingSuggestionOption => ({
            label: String(item.label || '').trim(),
            text: String(item.text || '').trim(),
          }))
          .filter((opt) => opt.label && opt.text);
      }

      const filledFields = BRIEFING_FIELDS.filter((f) => suggestions[f].length > 0);
      if (filledFields.length < 3) {
        lastError = `Only ${filledFields.length}/5 fields had valid options.`;
        continue;
      }

      if (attempt.label !== 'strict') {
        log.warn(`Briefing suggestions JSON recovered via ${attempt.label} parse`);
      }

      return { status: 'ok', suggestions };
    } catch (err: any) {
      lastError = err.message;
    }
  }

  return { status: 'error', error: `Failed to parse briefing suggestions: ${lastError}` };
}

/**
 * Parse a markdown chat response containing briefing suggestion tables
 * into the structured BriefingSuggestions format.
 *
 * Expects sections like:
 *   ## 1. Objective — ...
 *   | Label | Brief |
 *   |---|---|
 *   | **Capital Raise** | Secure funding by... |
 */
export function parseBriefingMarkdownResponse(raw: string): SuggestBriefingResult {
  const suggestions: BriefingSuggestions = {
    objective: [], audience: [], type: [], focus: [], tone: [],
  };

  // Field name mapping — match common variations in headings
  const fieldMap: Record<string, BriefingFieldName> = {
    objective: 'objective', audience: 'audience', type: 'type',
    focus: 'focus', tone: 'tone', format: 'type',
  };

  // Split into sections by ## headings
  const sections = raw.split(/^##\s+/m).filter(Boolean);

  for (const section of sections) {
    // Extract field name from the heading line (e.g. "1. Objective — Why are we making this deck?")
    const headingLine = section.split('\n')[0].toLowerCase();
    const matchedField = BRIEFING_FIELDS.find((f) => headingLine.includes(f))
      || Object.entries(fieldMap).find(([key]) => headingLine.includes(key))?.[1];

    if (!matchedField) continue;

    // Parse table rows: | **Label** | Brief text |
    const rows = section.split('\n').filter((line) => {
      const trimmed = line.trim();
      // Must start with | and contain at least 2 pipes, skip header/separator rows
      return trimmed.startsWith('|') && trimmed.split('|').length >= 3
        && !trimmed.match(/^\|\s*-+\s*\|/) && !trimmed.match(/^\|\s*Label\s*\|/i);
    });

    for (const row of rows) {
      const cells = row.split('|').map((c) => c.trim()).filter(Boolean);
      if (cells.length >= 2) {
        // Strip bold markers from label
        const label = cells[0].replace(/\*\*/g, '').trim();
        const text = cells.slice(1).join(' | ').trim();
        if (label && text) {
          suggestions[matchedField].push({ label, text });
        }
      }
    }
  }

  const filledFields = BRIEFING_FIELDS.filter((f) => suggestions[f].length > 0);
  if (filledFields.length < 3) {
    return {
      status: 'error',
      error: `Only ${filledFields.length}/5 briefing fields found in response. Expected markdown tables with ## headings.`,
    };
  }

  return { status: 'ok', suggestions };
}

// ── Producer response parser ──

export function parseProducerResponse(raw: string): ProducerResult {
  const extracted = extractJson(raw);

  // Step 1: Try strict JSON parse
  // Step 2: Repair unescaped control characters (common LLM issue — literal newlines in content strings)
  const attempts: { label: string; text: string }[] = [
    { label: 'strict', text: extracted },
    { label: 'repaired', text: repairJsonControlChars(extracted) },
  ];

  let lastError = '';
  for (const attempt of attempts) {
    try {
      const json = JSON.parse(attempt.text);
      const cardsArray = Array.isArray(json) ? json : json.cards;

      if (!Array.isArray(cardsArray) || cardsArray.length === 0) {
        lastError = 'Producer response missing cards array.';
        continue;
      }

      const cards: ProducedCard[] = cardsArray.map((c: any) => ({
        number: Number(c.number || 0),
        title: String(c.title || ''),
        content: String(c.content || ''),
        wordCount: Number(c.wordCount || c.word_count || 0),
      }));

      if (attempt.label !== 'strict') {
        log.warn(`Producer JSON recovered via ${attempt.label} parse (${cards.length} cards)`);
      }

      return { status: 'ok', cards };
    } catch (err: any) {
      lastError = err.message;
    }
  }

  return { status: 'error', error: `Failed to parse producer response: ${lastError}` };
}
