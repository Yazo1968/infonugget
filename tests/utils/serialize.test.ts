import { describe, it, expect } from 'vitest';
import {
  serializeCard,
  deserializeCard,
  extractImages,
  serializeNugget,
  deserializeNugget,
  serializeNuggetDocument,
  deserializeNuggetDocument,
  serializeProject,
  deserializeProject,
} from '../../utils/storage/serialize';
import type { Card, Nugget, UploadedFile, Project } from '../../types';

// ── Fixtures ──

function makeCard(overrides: Partial<Card> = {}): Card {
  return {
    id: 'card-1',
    level: 2,
    text: 'Test Section',
    selected: true,
    detailLevel: 'Standard',
    synthesisMap: { Standard: 'Synthesized content here' },
    lastGeneratedContentMap: { Standard: 'Last gen content' },
    lastPromptMap: { Standard: 'Full prompt' },
    isSynthesizingMap: { Standard: false },
    isGeneratingMap: { Standard: false },
    cardUrlMap: { Standard: 'blob:http://localhost/abc' },
    imageHistoryMap: {
      Standard: [{ imageUrl: 'data:image/png;base64,abc', timestamp: 1000, label: 'Original' }],
    },
    createdAt: 1700000000000,
    lastEditedAt: 1700001000000,
    sourceDocuments: ['doc-a.md', 'doc-b.pdf'],
    ...overrides,
  };
}

function makeNugget(overrides: Partial<Nugget> = {}): Nugget {
  return {
    id: 'nugget-1',
    name: 'Test Nugget',
    type: 'insights',
    documents: [],
    cards: [],
    messages: [{ id: 'm1', role: 'user', content: 'Hello', timestamp: 1000 }],
    docChangeLog: [{ type: 'added', docId: 'd1', docName: 'doc.md', timestamp: 1000, seq: 1 }],
    lastDocChangeSyncSeq: 1,
    subject: 'Climate science overview',
    createdAt: 1700000000000,
    lastModifiedAt: 1700001000000,
    ...overrides,
  };
}

function makeDocument(overrides: Partial<UploadedFile> = {}): UploadedFile {
  return {
    id: 'doc-1',
    name: 'report.md',
    size: 5000,
    type: 'text/markdown',
    lastModified: 1700000000000,
    content: '# Report\n\nSome content here.',
    status: 'ready',
    progress: 100,
    sourceType: 'markdown',
    originalFormat: 'md',
    createdAt: 1700000000000,
    lastEditedAt: 1700001000000,
    originalName: 'report.md',
    version: 2,
    ...overrides,
  };
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    name: 'My Project',
    nuggetIds: ['nugget-1', 'nugget-2'],
    isCollapsed: false,
    createdAt: 1700000000000,
    lastModifiedAt: 1700001000000,
    ...overrides,
  };
}

// ── Card round-trip ──

describe('Card serialization', () => {
  it('round-trips card data (serialize → deserialize)', () => {
    const card = makeCard();
    const fileId = 'file-1';
    const stored = serializeCard(card, fileId);
    const images = extractImages(card, fileId);

    // Verify stored heading has correct fileId
    expect(stored.fileId).toBe(fileId);
    expect(stored.headingId).toBe(card.id);
    expect(stored.text).toBe(card.text);

    // Verify images were extracted
    expect(images).toHaveLength(1);
    expect(images[0].level).toBe('Standard');
    expect(images[0].cardUrl).toBe('blob:http://localhost/abc');
    expect(images[0].imageHistory).toHaveLength(1);

    // Deserialize back
    const restored = deserializeCard(stored, images);
    expect(restored.id).toBe(card.id);
    expect(restored.text).toBe(card.text);
    expect(restored.level).toBe(card.level);
    expect(restored.selected).toBe(card.selected);
    expect(restored.detailLevel).toBe('Standard');
    expect(restored.synthesisMap?.Standard).toBe('Synthesized content here');
    expect(restored.cardUrlMap?.Standard).toBe('blob:http://localhost/abc');
    expect(restored.imageHistoryMap?.Standard).toHaveLength(1);
    expect(restored.sourceDocuments).toEqual(['doc-a.md', 'doc-b.pdf']);
  });

  it('excludes runtime-only maps from serialized data', () => {
    const card = makeCard({ isSynthesizingMap: { Standard: true }, isGeneratingMap: { Standard: true } });
    const stored = serializeCard(card, 'f1');
    // StoredHeading should NOT have isSynthesizingMap or isGeneratingMap
    expect((stored as any).isSynthesizingMap).toBeUndefined();
    expect((stored as any).isGeneratingMap).toBeUndefined();
  });

  it('migrates legacy TitleCover → TitleCard on deserialization', () => {
    const stored = serializeCard(makeCard({ detailLevel: undefined }), 'f1');
    // Manually inject legacy level names
    (stored as any).synthesisMap = { TitleCover: 'Legacy content' };
    (stored as any).detailLevel = undefined;
    (stored as any).settings = { levelOfDetail: 'TitleCover' };

    const restored = deserializeCard(stored, []);
    // settings.levelOfDetail should be migrated
    expect(restored.settings?.levelOfDetail).toBe('TitleCard');
    // synthesisMap key should be migrated
    expect(restored.synthesisMap?.TitleCard).toBe('Legacy content');
  });

  it('extracts no images when cardUrlMap is empty', () => {
    const card = makeCard({ cardUrlMap: undefined, imageHistoryMap: undefined });
    const images = extractImages(card, 'f1');
    expect(images).toHaveLength(0);
  });
});

// ── Nugget round-trip ──

describe('Nugget serialization', () => {
  it('round-trips nugget metadata', () => {
    const nugget = makeNugget();
    const stored = serializeNugget(nugget);
    expect(stored.id).toBe(nugget.id);
    expect(stored.name).toBe(nugget.name);
    expect(stored.messages).toEqual(nugget.messages);
    expect(stored.docChangeLog).toEqual(nugget.docChangeLog);
    expect(stored.subject).toBe('Climate science overview');

    const restored = deserializeNugget(stored, [], []);
    expect(restored.id).toBe(nugget.id);
    expect(restored.name).toBe(nugget.name);
    expect(restored.type).toBe('insights');
    expect(restored.subject).toBe('Climate science overview');
    expect(restored.documents).toEqual([]);
    expect(restored.cards).toEqual([]);
  });

  it('includes cards and documents in deserialized nugget', () => {
    const nugget = makeNugget();
    const stored = serializeNugget(nugget);
    const cards = [makeCard()];
    const docs = [makeDocument()];
    const restored = deserializeNugget(stored, cards, docs);
    expect(restored.cards).toHaveLength(1);
    expect(restored.documents).toHaveLength(1);
    expect(restored.cards[0].id).toBe('card-1');
    expect(restored.documents[0].id).toBe('doc-1');
  });
});

// ── NuggetDocument round-trip ──

describe('NuggetDocument serialization', () => {
  it('round-trips a markdown document', () => {
    const doc = makeDocument();
    const stored = serializeNuggetDocument('nug-1', doc);
    expect(stored.nuggetId).toBe('nug-1');
    expect(stored.docId).toBe(doc.id);
    expect(stored.name).toBe(doc.name);
    expect(stored.content).toBe(doc.content);
    expect(stored.sourceType).toBe('markdown');
    expect(stored.originalFormat).toBe('md');

    const restored = deserializeNuggetDocument(stored);
    expect(restored.id).toBe(doc.id);
    expect(restored.name).toBe(doc.name);
    expect(restored.content).toBe(doc.content);
    expect(restored.sourceType).toBe('markdown');
    expect(restored.version).toBe(2);
    expect(restored.originalName).toBe('report.md');
  });

  it('round-trips a native-pdf document with bookmarks', () => {
    const bookmarks = [{ id: 'b1', title: 'Chapter 1', page: 1, level: 1, children: [] }];
    const doc = makeDocument({
      id: 'pdf-1',
      name: 'analysis.pdf',
      type: 'application/pdf',
      sourceType: 'native-pdf',
      pdfBase64: 'JVBERi0xLjQK', // minimal PDF header
      bookmarks,
      bookmarkSource: 'pdf_bookmarks',
    });
    const stored = serializeNuggetDocument('nug-1', doc);
    expect(stored.sourceType).toBe('native-pdf');
    expect(stored.pdfBase64).toBe('JVBERi0xLjQK');
    expect(stored.bookmarks).toEqual(bookmarks);

    const restored = deserializeNuggetDocument(stored);
    expect(restored.sourceType).toBe('native-pdf');
    expect(restored.pdfBase64).toBe('JVBERi0xLjQK');
    expect(restored.bookmarks).toEqual(bookmarks);
    expect(restored.bookmarkSource).toBe('pdf_bookmarks');
  });

  it('migrates flat structure to bookmarks for native-pdf without bookmarks', () => {
    const doc = makeDocument({
      sourceType: 'native-pdf',
      structure: [
        { level: 1, text: 'Introduction', id: 'h1', page: 1 },
        { level: 2, text: 'Background', id: 'h2', page: 3 },
      ],
    });
    const stored = serializeNuggetDocument('nug-1', doc);
    // Remove bookmarks to simulate legacy data
    delete (stored as any).bookmarks;
    delete (stored as any).bookmarkSource;

    const restored = deserializeNuggetDocument(stored);
    // Should have auto-migrated from structure to bookmarks
    expect(restored.bookmarks).toBeDefined();
    expect(restored.bookmarks!.length).toBe(1); // Level 1 at root
    expect(restored.bookmarks![0].title).toBe('Introduction');
    expect(restored.bookmarks![0].children.length).toBe(1);
    expect(restored.bookmarks![0].children[0].title).toBe('Background');
    expect(restored.bookmarkSource).toBe('manual');
  });

  it('sets status to error for non-ready documents', () => {
    const doc = makeDocument({ status: 'uploading' });
    const stored = serializeNuggetDocument('nug-1', doc);
    expect(stored.status).toBe('error');
    expect(stored.progress).toBe(0);
  });
});

// ── Project round-trip ──

describe('Project serialization', () => {
  it('round-trips project data', () => {
    const project = makeProject();
    const stored = serializeProject(project);
    expect(stored.id).toBe(project.id);
    expect(stored.name).toBe(project.name);
    expect(stored.nuggetIds).toEqual(['nugget-1', 'nugget-2']);
    expect(stored.isCollapsed).toBe(false);

    const restored = deserializeProject(stored);
    expect(restored.id).toBe(project.id);
    expect(restored.name).toBe(project.name);
    expect(restored.nuggetIds).toEqual(project.nuggetIds);
    expect(restored.createdAt).toBe(project.createdAt);
    expect(restored.lastModifiedAt).toBe(project.lastModifiedAt);
  });
});
