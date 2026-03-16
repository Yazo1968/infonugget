import { BriefingFieldName, BriefingSuggestionOption, BriefingSuggestions } from '../../types';
import { createLogger } from '../logger';

const log = createLogger('DeckParser');

// ── JSON extraction helper ──

function extractJson(raw: string): string {
  let text = raw.trim();
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }
  const firstBracket = text.indexOf('[');
  const firstBrace = text.indexOf('{');
  if (firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace)) {
    const lastBracket = text.lastIndexOf(']');
    if (lastBracket > firstBracket) {
      text = text.substring(firstBracket, lastBracket + 1);
    }
  } else if (firstBrace !== -1) {
    const lastBrace = text.lastIndexOf('}');
    if (lastBrace > firstBrace) {
      text = text.substring(firstBrace, lastBrace + 1);
    }
  }
  return text;
}

function repairJsonControlChars(raw: string): string {
  let result = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (escaped) { result += ch; escaped = false; continue; }
    if (ch === '\\' && inString) { result += ch; escaped = true; continue; }
    if (ch === '"') { inString = !inString; result += ch; continue; }
    if (inString) {
      if (ch === '\n') { result += '\\n'; continue; }
      if (ch === '\r') { result += '\\r'; continue; }
      if (ch === '\t') { result += '\\t'; continue; }
    }
    result += ch;
  }
  return result;
}

function repairJsonAggressive(raw: string): string {
  let result = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (escaped) { result += ch; escaped = false; continue; }
    if (ch === '\\' && inString) {
      const nextCh = i + 1 < raw.length ? raw[i + 1] : '';
      const validEscapes = '"\\\/bfnrtu';
      if (nextCh && !validEscapes.includes(nextCh)) {
        result += '\\\\';
        continue;
      }
      result += ch;
      escaped = true;
      continue;
    }
    if (ch === '"') {
      if (!inString) {
        inString = true;
        result += ch;
      } else {
        let j = i + 1;
        while (j < raw.length && (raw[j] === ' ' || raw[j] === '\n' || raw[j] === '\r' || raw[j] === '\t')) j++;
        const next = j < raw.length ? raw[j] : '';
        if (next === '' || next === ',' || next === '}' || next === ']' || next === ':') {
          inString = false;
          result += ch;
        } else {
          result += '\\"';
        }
      }
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

// ── Producer response parser ──

export interface ProducedCard {
  number: number;
  title: string;
  content: string;
  wordCount: number;
}

type ProducerResult = { status: 'ok'; cards: ProducedCard[] } | { status: 'error'; error: string };

export function parseProducerResponse(raw: string): ProducerResult {
  const extracted = extractJson(raw);
  const attempts: { label: string; text: string }[] = [
    { label: 'strict', text: extracted },
    { label: 'repaired', text: repairJsonControlChars(extracted) },
    { label: 'aggressive', text: repairJsonAggressive(extracted) },
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

// ── Briefing suggestions parser ──

export type SuggestBriefingResult =
  | { status: 'ok'; suggestions: BriefingSuggestions }
  | { status: 'error'; error: string };

const BRIEFING_FIELDS: BriefingFieldName[] = ['objective', 'audience', 'type', 'focus', 'tone'];

/**
 * Parse a markdown-formatted briefing suggestions response.
 * Expected format:
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
