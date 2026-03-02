import { describe, it, expect } from 'vitest';
import {
  flattenBookmarks,
  headingsToBookmarks,
  buildTocSystemPrompt,
} from '../../utils/pdfBookmarks';
import type { BookmarkNode, Heading } from '../../types';

function makeBookmark(overrides: Partial<BookmarkNode> = {}): BookmarkNode {
  return {
    id: crypto.randomUUID(),
    title: 'Chapter 1',
    page: 1,
    level: 1,
    children: [],
    ...overrides,
  };
}

describe('flattenBookmarks', () => {
  it('returns empty array for empty input', () => {
    expect(flattenBookmarks([])).toEqual([]);
  });

  it('flattens a single-level tree', () => {
    const bookmarks = [makeBookmark({ title: 'A', level: 1 }), makeBookmark({ title: 'B', level: 1 })];
    const result = flattenBookmarks(bookmarks);
    expect(result).toHaveLength(2);
    expect(result[0].text).toBe('A');
    expect(result[1].text).toBe('B');
  });

  it('flattens nested bookmarks preserving depth-first order', () => {
    const child = makeBookmark({ title: 'Section 1.1', level: 2 });
    const parent = makeBookmark({ title: 'Chapter 1', level: 1, children: [child] });
    const result = flattenBookmarks([parent]);
    expect(result).toHaveLength(2);
    expect(result[0].text).toBe('Chapter 1');
    expect(result[0].level).toBe(1);
    expect(result[1].text).toBe('Section 1.1');
    expect(result[1].level).toBe(2);
  });
});

describe('headingsToBookmarks', () => {
  it('returns empty array for empty input', () => {
    expect(headingsToBookmarks([])).toEqual([]);
  });

  it('creates flat structure for same-level headings', () => {
    const headings: Heading[] = [
      { level: 1, text: 'A', id: 'a' },
      { level: 1, text: 'B', id: 'b' },
    ];
    const result = headingsToBookmarks(headings);
    expect(result).toHaveLength(2);
    expect(result[0].title).toBe('A');
    expect(result[0].children).toHaveLength(0);
    expect(result[1].title).toBe('B');
  });

  it('nests deeper headings as children', () => {
    const headings: Heading[] = [
      { level: 1, text: 'Chapter 1', id: 'c1' },
      { level: 2, text: 'Section 1.1', id: 's1' },
      { level: 2, text: 'Section 1.2', id: 's2' },
      { level: 1, text: 'Chapter 2', id: 'c2' },
    ];
    const result = headingsToBookmarks(headings);
    expect(result).toHaveLength(2);
    expect(result[0].title).toBe('Chapter 1');
    expect(result[0].children).toHaveLength(2);
    expect(result[0].children[0].title).toBe('Section 1.1');
    expect(result[0].children[1].title).toBe('Section 1.2');
    expect(result[1].title).toBe('Chapter 2');
    expect(result[1].children).toHaveLength(0);
  });

  it('round-trips with flattenBookmarks', () => {
    const headings: Heading[] = [
      { level: 1, text: 'A', id: 'a', page: 1 },
      { level: 2, text: 'A.1', id: 'a1', page: 2 },
      { level: 3, text: 'A.1.1', id: 'a11', page: 3 },
      { level: 1, text: 'B', id: 'b', page: 10 },
    ];
    const bookmarks = headingsToBookmarks(headings);
    const flat = flattenBookmarks(bookmarks);
    expect(flat.map((h) => h.text)).toEqual(['A', 'A.1', 'A.1.1', 'B']);
    expect(flat.map((h) => h.level)).toEqual([1, 2, 3, 1]);
  });

  it('round-trips wordCount through headingsToBookmarks and flattenBookmarks', () => {
    const headings: Heading[] = [
      { level: 1, text: 'Intro', id: 'h1', page: 1, wordCount: 0 },
      { level: 2, text: 'Background', id: 'h2', page: 2, wordCount: 523 },
      { level: 2, text: 'Methods', id: 'h3', page: 5, wordCount: 1200 },
      { level: 1, text: 'Conclusion', id: 'h4', page: 10, wordCount: 300 },
    ];
    const bookmarks = headingsToBookmarks(headings);
    expect(bookmarks[0].wordCount).toBe(0);
    expect(bookmarks[0].children[0].wordCount).toBe(523);
    expect(bookmarks[0].children[1].wordCount).toBe(1200);
    expect(bookmarks[1].wordCount).toBe(300);

    const flat = flattenBookmarks(bookmarks);
    expect(flat.map((h) => h.wordCount)).toEqual([0, 523, 1200, 300]);
  });
});

describe('buildTocSystemPrompt', () => {
  it('returns empty string for empty bookmarks', () => {
    expect(buildTocSystemPrompt([], 'doc.pdf')).toBe('');
  });

  it('builds a formatted TOC string', () => {
    const bookmarks = [
      makeBookmark({ title: 'Intro', page: 1, level: 1, children: [] }),
      makeBookmark({
        title: 'Main',
        page: 5,
        level: 1,
        children: [makeBookmark({ title: 'Sub', page: 7, level: 2, children: [] })],
      }),
    ];
    const result = buildTocSystemPrompt(bookmarks, 'test.pdf', 20);
    expect(result).toContain('Table of Contents for "test.pdf" (20 pages)');
    expect(result).toContain('- Intro (page 1)');
    expect(result).toContain('- Main (page 5)');
    expect(result).toContain('  - Sub (page 7)');
  });
});

