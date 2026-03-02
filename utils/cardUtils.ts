import { Card, CardFolder, CardItem, DetailLevel, UploadedFile, isCardFolder } from '../types';

/**
 * Flatten a CardItem[] into a flat Card[] (folders dissolved).
 * Use when you need all cards regardless of grouping.
 */
export function flattenCards(items: CardItem[]): Card[] {
  const result: Card[] = [];
  for (const item of items) {
    if (isCardFolder(item)) {
      result.push(...item.cards);
    } else {
      result.push(item);
    }
  }
  return result;
}

/**
 * Find a card by ID anywhere in the tree (root or inside folders).
 */
export function findCard(items: CardItem[], cardId: string): Card | undefined {
  for (const item of items) {
    if (isCardFolder(item)) {
      const found = item.cards.find((c) => c.id === cardId);
      if (found) return found;
    } else if (item.id === cardId) {
      return item;
    }
  }
  return undefined;
}

/**
 * Find a folder by ID.
 */
export function findFolder(items: CardItem[], folderId: string): CardFolder | undefined {
  return items.find((item): item is CardFolder => isCardFolder(item) && item.id === folderId);
}

/**
 * Find the folder that contains a card (by card ID). Returns undefined if at root.
 */
export function findParentFolder(items: CardItem[], cardId: string): CardFolder | undefined {
  return items.find((item): item is CardFolder => isCardFolder(item) && item.cards.some((c) => c.id === cardId));
}

/**
 * Map over all cards (including inside folders), preserving structure.
 * Folders are preserved; only cards are transformed.
 */
export function mapCards(items: CardItem[], fn: (c: Card) => Card): CardItem[] {
  return items.map((item) => {
    if (isCardFolder(item)) {
      return { ...item, cards: item.cards.map(fn) };
    }
    return fn(item);
  });
}

/**
 * Map a single card by ID, searching inside folders.
 */
export function mapCardById(items: CardItem[], cardId: string, fn: (c: Card) => Card): CardItem[] {
  return items.map((item) => {
    if (isCardFolder(item)) {
      const hasCard = item.cards.some((c) => c.id === cardId);
      if (hasCard) {
        return { ...item, cards: item.cards.map((c) => (c.id === cardId ? fn(c) : c)) };
      }
      return item;
    }
    return item.id === cardId ? fn(item) : item;
  });
}

/**
 * Remove a card by ID from anywhere in the tree.
 * Returns the new items array. Empty folders are NOT auto-removed.
 */
export function removeCard(items: CardItem[], cardId: string): CardItem[] {
  return items
    .map((item) => {
      if (isCardFolder(item)) {
        return { ...item, cards: item.cards.filter((c) => c.id !== cardId) };
      }
      return item;
    })
    .filter((item) => !(!isCardFolder(item) && item.id === cardId));
}

/**
 * Remove cards matching a predicate from anywhere in the tree.
 */
export function removeCardsWhere(items: CardItem[], pred: (c: Card) => boolean): CardItem[] {
  return items
    .map((item) => {
      if (isCardFolder(item)) {
        return { ...item, cards: item.cards.filter((c) => !pred(c)) };
      }
      return item;
    })
    .filter((item) => !((!isCardFolder(item)) && pred(item)));
}

/**
 * Remove a folder and all its cards.
 */
export function removeFolder(items: CardItem[], folderId: string): CardItem[] {
  return items.filter((item) => !(isCardFolder(item) && item.id === folderId));
}

/**
 * Get all card names for uniqueness checking (flat).
 */
export function allCardNames(items: CardItem[]): string[] {
  return flattenCards(items).map((c) => c.text);
}

/**
 * Get card names scoped to a specific folder or root level.
 * Uniqueness is per-folder: cards in different folders may share names.
 * - folderId provided → names of cards inside that folder
 * - no folderId → names of root-level cards (not inside any folder)
 */
export function cardNamesInScope(items: CardItem[], folderId?: string): string[] {
  if (folderId) {
    const folder = findFolder(items, folderId);
    return folder ? folder.cards.map((c) => c.text) : [];
  }
  // Root level: only cards not inside any folder
  const result: string[] = [];
  for (const item of items) {
    if (!isCardFolder(item)) result.push(item.text);
  }
  return result;
}

/**
 * Get all folder names for uniqueness checking.
 */
export function allFolderNames(items: CardItem[]): string[] {
  return items.filter(isCardFolder).map((f) => f.name);
}

// ─────────────────────────────────────────────────────────────────
// MD Section Word Count + LOD Eligibility
// ─────────────────────────────────────────────────────────────────

/**
 * Extract the raw markdown text for a section (heading + all nested content).
 * Uses the same regex boundary approach as DirectContent in useDocumentOperations.
 * Returns '' for native PDFs or docs without content.
 */
export function extractMdSectionText(cardTitle: string, doc: UploadedFile): string {
  if (doc.sourceType === 'native-pdf' || !doc.content) return '';

  if (cardTitle === '__whole_document__') return doc.content;

  // Scan heading lines and strip inline markdown to match plain-text cardTitle
  // (DOM textContent strips formatting like **bold**, *italic*, etc.)
  const headingLineRegex = /^(#{1,6})\s+(.+)$/gm;
  let lineMatch: RegExpExecArray | null;
  let foundMatch: { index: number; fullLength: number; level: number } | null = null;
  while ((lineMatch = headingLineRegex.exec(doc.content)) !== null) {
    const plainText = lineMatch[2]
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/__(.+?)__/g, '$1')
      .replace(/\*(.+?)\*/g, '$1')
      .replace(/_(.+?)_/g, '$1')
      .replace(/`(.+?)`/g, '$1')
      .replace(/~~(.+?)~~/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .trim();
    if (plainText === cardTitle) {
      foundMatch = { index: lineMatch.index, fullLength: lineMatch[0].length, level: lineMatch[1].length };
      break;
    }
  }
  if (!foundMatch) return '';

  const startOffset = foundMatch.index;
  const headingLevel = foundMatch.level;
  const nextHeadingRegex = new RegExp(`^#{1,${headingLevel}}\\s+`, 'gm');
  nextHeadingRegex.lastIndex = startOffset + foundMatch.fullLength;
  const nextMatch = nextHeadingRegex.exec(doc.content);

  return doc.content.substring(startOffset, nextMatch ? nextMatch.index : doc.content.length).trim();
}

/**
 * Compute word count for a document section.
 * - Markdown: extracts section text and counts words via regex.
 * - Native PDF: reads Gemini-extracted `wordCount` from structure headings,
 *   summing the heading's own count plus all descendant headings (matching
 *   the MD behavior where section text includes nested content).
 * Returns null if word count data is unavailable (all LOD levels unlocked).
 */
export function computeMdSectionWordCount(cardTitle: string, doc: UploadedFile): number | null {
  // Native PDFs: use structure[].wordCount from Gemini extraction
  if (doc.sourceType === 'native-pdf') {
    if (!doc.structure || doc.structure.length === 0) return null;

    if (cardTitle === '__whole_document__') {
      let total = 0;
      let hasAny = false;
      for (const h of doc.structure) {
        if (typeof h.wordCount === 'number') {
          total += h.wordCount;
          hasAny = true;
        }
      }
      return hasAny ? total : null;
    }

    // Find heading by title match
    const idx = doc.structure.findIndex((h) => h.text === cardTitle);
    if (idx < 0) return null;

    const heading = doc.structure[idx];
    if (typeof heading.wordCount !== 'number') return null;

    const targetLevel = heading.level;
    let total = heading.wordCount;

    // Sum descendants (deeper headings until next heading at same or lower level)
    for (let i = idx + 1; i < doc.structure.length; i++) {
      if (doc.structure[i].level <= targetLevel) break;
      total += doc.structure[i].wordCount ?? 0;
    }

    return total;
  }

  // Markdown path: extract text and count words
  const text = extractMdSectionText(cardTitle, doc);
  if (!text) return null;
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

/**
 * Determine which detail levels are eligible given a section's word count.
 * Applies a tolerance multiplier (default 25%) to allow minor AI expansion.
 * Returns null (all unlocked) when word count is unavailable.
 */
export function getEligibleDetailLevels(
  sectionWordCount: number | null,
  tolerance = 1.25,
): Set<DetailLevel> | null {
  if (sectionWordCount === null) return null;

  const effective = sectionWordCount * tolerance;
  const eligible = new Set<DetailLevel>();
  if (effective >= 70) eligible.add('Executive');
  if (effective >= 200) eligible.add('Standard');
  if (effective >= 450) eligible.add('Detailed');
  if (effective >= 100) eligible.add('TakeawayCard');
  return eligible;
}

/**
 * Return the highest eligible summary-type detail level for a given word count.
 * Hierarchy: Detailed > Standard > Executive.
 * Returns null when the section is too short for any level, or when word count is unavailable.
 */
export function getMaxDetailLevel(
  sectionWordCount: number | null,
  tolerance = 1.25,
): DetailLevel | null {
  if (sectionWordCount === null) return null;

  const effective = sectionWordCount * tolerance;
  if (effective >= 450) return 'Detailed';
  if (effective >= 200) return 'Standard';
  if (effective >= 70) return 'Executive';
  return null;
}

// ── LOD pass/fail counts for multi-heading selection ──

export interface LodPassCounts {
  /** Total headings evaluated. */
  total: number;
  /** How many headings pass each LOD threshold. */
  counts: Record<'Executive' | 'Standard' | 'Detailed' | 'TakeawayCard', number>;
  /** Per-heading cumulative word counts (same order as input), null = unavailable. */
  wordCounts: (number | null)[];
}

/**
 * Compute per-LOD pass counts across multiple headings.
 * Returns null when ALL word counts are unavailable (all LODs unlocked).
 * Headings with unavailable word counts are treated as passing all thresholds.
 */
export function computeLodPassCounts(
  headingTexts: string[],
  doc: UploadedFile,
  tolerance = 1.25,
): LodPassCounts | null {
  const wordCounts = headingTexts.map((text) => computeMdSectionWordCount(text, doc));

  // If every heading returned null, no word count data — all LODs unlocked
  if (wordCounts.every((wc) => wc === null)) return null;

  const total = headingTexts.length;
  const counts: Record<'Executive' | 'Standard' | 'Detailed' | 'TakeawayCard', number> = {
    Executive: 0,
    Standard: 0,
    Detailed: 0,
    TakeawayCard: 0,
  };

  for (const wc of wordCounts) {
    if (wc === null) {
      // No data for this heading — treat as passing all thresholds
      counts.Executive++;
      counts.Standard++;
      counts.Detailed++;
      counts.TakeawayCard++;
    } else {
      const effective = wc * tolerance;
      if (effective >= 70) counts.Executive++;
      if (effective >= 100) counts.TakeawayCard++;
      if (effective >= 200) counts.Standard++;
      if (effective >= 450) counts.Detailed++;
    }
  }

  return { total, counts, wordCounts };
}
