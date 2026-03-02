import { describe, it, expect } from 'vitest';
import { computeMdSectionWordCount, getEligibleDetailLevels, computeLodPassCounts } from '../../utils/cardUtils';
import type { UploadedFile } from '../../types';

function makePdfDoc(structure: Array<{ level: number; text: string; wordCount?: number }>): UploadedFile {
  return {
    id: 'doc-1',
    name: 'test.pdf',
    size: 1000,
    type: 'application/pdf',
    lastModified: Date.now(),
    sourceType: 'native-pdf',
    status: 'ready',
    progress: 100,
    structure: structure.map((s, i) => ({ ...s, id: `h-${i}` })),
  };
}

function makeMdDoc(content: string): UploadedFile {
  return {
    id: 'doc-2',
    name: 'test.md',
    size: content.length,
    type: 'text/markdown',
    lastModified: Date.now(),
    sourceType: 'markdown',
    content,
    status: 'ready',
    progress: 100,
  };
}

describe('computeMdSectionWordCount — native PDF', () => {
  it('returns null for PDF with no structure', () => {
    const doc = makePdfDoc([]);
    expect(computeMdSectionWordCount('Intro', doc)).toBeNull();
  });

  it('returns null for heading not found', () => {
    const doc = makePdfDoc([{ level: 1, text: 'Intro', wordCount: 100 }]);
    expect(computeMdSectionWordCount('Missing', doc)).toBeNull();
  });

  it('returns wordCount for a leaf heading', () => {
    const doc = makePdfDoc([
      { level: 1, text: 'Chapter 1', wordCount: 500 },
      { level: 1, text: 'Chapter 2', wordCount: 300 },
    ]);
    expect(computeMdSectionWordCount('Chapter 1', doc)).toBe(500);
    expect(computeMdSectionWordCount('Chapter 2', doc)).toBe(300);
  });

  it('sums wordCount for heading + descendants', () => {
    const doc = makePdfDoc([
      { level: 1, text: 'Chapter 1', wordCount: 0 },
      { level: 2, text: 'Section 1.1', wordCount: 200 },
      { level: 2, text: 'Section 1.2', wordCount: 300 },
      { level: 1, text: 'Chapter 2', wordCount: 100 },
    ]);
    // Chapter 1 = own 0 + Section 1.1 (200) + Section 1.2 (300) = 500
    expect(computeMdSectionWordCount('Chapter 1', doc)).toBe(500);
    // Chapter 2 = own 100 (no descendants)
    expect(computeMdSectionWordCount('Chapter 2', doc)).toBe(100);
  });

  it('stops summing at next same-level heading', () => {
    const doc = makePdfDoc([
      { level: 1, text: 'A', wordCount: 10 },
      { level: 2, text: 'A.1', wordCount: 50 },
      { level: 3, text: 'A.1.1', wordCount: 100 },
      { level: 1, text: 'B', wordCount: 200 },
    ]);
    // A = 10 + 50 + 100 = 160 (stops before B at level 1)
    expect(computeMdSectionWordCount('A', doc)).toBe(160);
    // A.1 = 50 + 100 = 150 (stops before B at level 1, which is <= level 2)
    expect(computeMdSectionWordCount('A.1', doc)).toBe(150);
  });

  it('returns total for __whole_document__', () => {
    const doc = makePdfDoc([
      { level: 1, text: 'Intro', wordCount: 100 },
      { level: 2, text: 'Sub', wordCount: 200 },
      { level: 1, text: 'Conclusion', wordCount: 150 },
    ]);
    expect(computeMdSectionWordCount('__whole_document__', doc)).toBe(450);
  });

  it('returns null when no wordCount data exists', () => {
    const doc = makePdfDoc([
      { level: 1, text: 'Intro' },
      { level: 2, text: 'Sub' },
    ]);
    expect(computeMdSectionWordCount('__whole_document__', doc)).toBeNull();
    expect(computeMdSectionWordCount('Intro', doc)).toBeNull();
  });
});

describe('computeMdSectionWordCount — markdown', () => {
  it('counts words in a section', () => {
    const doc = makeMdDoc('# Title\n\nHello world foo bar baz.\n\n# Next\n\nMore text.');
    expect(computeMdSectionWordCount('Title', doc)).toBe(7); // # Title + Hello world foo bar baz.
  });

  it('returns null for non-existent heading', () => {
    const doc = makeMdDoc('# Title\n\nSome text.');
    expect(computeMdSectionWordCount('Missing', doc)).toBeNull();
  });
});

describe('getEligibleDetailLevels', () => {
  it('returns null for null input', () => {
    expect(getEligibleDetailLevels(null)).toBeNull();
  });

  it('returns empty set for 0 words', () => {
    const result = getEligibleDetailLevels(0);
    expect(result).toBeInstanceOf(Set);
    expect(result!.size).toBe(0);
  });

  it('unlocks Executive at 56+ words (70 / 1.25)', () => {
    expect(getEligibleDetailLevels(55)!.has('Executive')).toBe(false);
    expect(getEligibleDetailLevels(56)!.has('Executive')).toBe(true);
  });

  it('unlocks all levels for large word counts', () => {
    const result = getEligibleDetailLevels(500);
    expect(result!.has('Executive')).toBe(true);
    expect(result!.has('Standard')).toBe(true);
    expect(result!.has('Detailed')).toBe(true);
  });
});

describe('computeLodPassCounts', () => {
  it('returns null when all word counts are unavailable', () => {
    const doc = makePdfDoc([
      { level: 1, text: 'Intro' },
      { level: 1, text: 'Body' },
    ]);
    expect(computeLodPassCounts(['Intro', 'Body'], doc)).toBeNull();
  });

  it('returns null for headings not found in doc', () => {
    const doc = makePdfDoc([{ level: 1, text: 'Intro', wordCount: 100 }]);
    expect(computeLodPassCounts(['Missing', 'Also Missing'], doc)).toBeNull();
  });

  it('single heading — all LODs pass', () => {
    const doc = makePdfDoc([{ level: 1, text: 'Chapter', wordCount: 500 }]);
    const result = computeLodPassCounts(['Chapter'], doc);
    expect(result).not.toBeNull();
    expect(result!.total).toBe(1);
    expect(result!.counts.Executive).toBe(1);
    expect(result!.counts.Standard).toBe(1);
    expect(result!.counts.Detailed).toBe(1);
    expect(result!.wordCounts).toEqual([500]);
  });

  it('single heading — partial LODs pass', () => {
    const doc = makePdfDoc([{ level: 1, text: 'Short', wordCount: 100 }]);
    const result = computeLodPassCounts(['Short'], doc);
    expect(result).not.toBeNull();
    expect(result!.counts.Executive).toBe(1);  // 100 * 1.25 = 125 >= 70
    expect(result!.counts.Standard).toBe(0);   // 125 < 200
    expect(result!.counts.Detailed).toBe(0);   // 125 < 450
  });

  it('multiple headings — mixed results', () => {
    const doc = makePdfDoc([
      { level: 1, text: 'Big', wordCount: 500 },
      { level: 1, text: 'Medium', wordCount: 200 },
      { level: 1, text: 'Small', wordCount: 40 },
    ]);
    const result = computeLodPassCounts(['Big', 'Medium', 'Small'], doc);
    expect(result).not.toBeNull();
    expect(result!.total).toBe(3);
    expect(result!.counts.Executive).toBe(2);  // Big (625>=70), Medium (250>=70), Small (50<70)
    expect(result!.counts.Standard).toBe(2);   // Big (625>=200), Medium (250>=200), Small (50<200)
    expect(result!.counts.Detailed).toBe(1);   // Big (625>=450), Medium (250<450), Small (50<450)
    expect(result!.wordCounts).toEqual([500, 200, 40]);
  });

  it('headings with null word count treated as passing all thresholds', () => {
    const doc = makePdfDoc([
      { level: 1, text: 'Known', wordCount: 100 },
      { level: 1, text: 'Unknown' },
    ]);
    const result = computeLodPassCounts(['Known', 'Unknown'], doc);
    expect(result).not.toBeNull();
    expect(result!.total).toBe(2);
    expect(result!.counts.Executive).toBe(2);  // Known passes, Unknown passes (null = all pass)
    expect(result!.counts.Standard).toBe(1);   // Known fails (125<200), Unknown passes
    expect(result!.counts.Detailed).toBe(1);   // Known fails (125<450), Unknown passes
    expect(result!.wordCounts).toEqual([100, null]);
  });

  it('tolerance parameter is applied', () => {
    const doc = makePdfDoc([{ level: 1, text: 'Border', wordCount: 56 }]);
    // With default tolerance 1.25: 56 * 1.25 = 70 >= 70 → Executive passes
    const result125 = computeLodPassCounts(['Border'], doc);
    expect(result125!.counts.Executive).toBe(1);
    // With tolerance 1.0: 56 * 1.0 = 56 < 70 → Executive fails
    const result100 = computeLodPassCounts(['Border'], doc, 1.0);
    expect(result100!.counts.Executive).toBe(0);
  });

  it('works with markdown documents', () => {
    const doc = makeMdDoc('# Big\n\n' + 'word '.repeat(500) + '\n\n# Small\n\nfew words here.');
    const result = computeLodPassCounts(['Big', 'Small'], doc);
    expect(result).not.toBeNull();
    expect(result!.total).toBe(2);
    expect(result!.counts.Detailed).toBe(1);  // Big passes, Small fails
    expect(result!.wordCounts[0]).toBeGreaterThan(400);
    expect(result!.wordCounts[1]).toBeLessThan(10);
  });
});
