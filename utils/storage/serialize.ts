import {
  UploadedFile,
  Heading,
  Card,
  CardItem,
  CardFolder,
  isCardFolder,
  DetailLevel,
  Nugget,
  Project,
  AlbumImage,
  ImageVersion,
  BookmarkNode,
  SourcesLogStats,
} from '../../types';
import {
  StoredFile,
  StoredHeading,
  StoredAlbumImage,
  StoredImage,
  StoredNugget,
  StoredNuggetDocument,
  StoredProject,
} from './StorageBackend';
import { headingsToBookmarks } from '../pdfBookmarks';

const DETAIL_LEVELS: DetailLevel[] = [
  'Executive',
  'Standard',
  'Detailed',
  'TitleCard',
  'TakeawayCard',
  'DirectContent',
];

/** Map legacy stored level names to current ones (backward compat for IndexedDB data). */
const LEGACY_LEVEL_MAP: Record<string, DetailLevel> = {
  TitleCover: 'TitleCard',
  TakeawayCover: 'TakeawayCard',
};

// ── File serialization ──

function _serializeFile(f: UploadedFile): StoredFile {
  return {
    id: f.id,
    name: f.name,
    size: f.size,
    type: f.type,
    lastModified: f.lastModified,
    content: f.content,
    status: f.status === 'ready' ? 'ready' : 'error',
    progress: f.status === 'ready' ? 100 : 0,
  };
}

export function deserializeFile(sf: StoredFile, structure?: Heading[]): UploadedFile {
  return {
    id: sf.id,
    name: sf.name,
    size: sf.size,
    type: sf.type,
    lastModified: sf.lastModified,
    content: sf.content,
    status: sf.status,
    progress: sf.progress,
    structure,
  };
}

// ── Card serialization (runtime Card ↔ StoredHeading) ──

export function serializeCard(card: Card, fileId: string): StoredHeading {
  return {
    fileId,
    headingId: card.id,
    level: card.level,
    text: card.text,
    selected: card.selected,
    detailLevel: card.detailLevel,
    settings: card.settings,
    synthesisMap: card.synthesisMap,
    visualPlanMap: card.visualPlanMap,
    lastGeneratedContentMap: card.lastGeneratedContentMap,
    lastPromptMap: card.lastPromptMap,
    createdAt: card.createdAt,
    lastEditedAt: card.lastEditedAt,
    sourceDocuments: card.sourceDocuments,
    // Excluded: isSynthesizingMap, isGeneratingMap, startIndex, cardUrlMap, imageHistoryMap
  };
}

/** Extract album images from a card for persistence. */
export function extractAlbumImages(card: Card, fileId: string): StoredAlbumImage[] {
  const images: StoredAlbumImage[] = [];
  for (const level of DETAIL_LEVELS) {
    const album = card.albumMap?.[level];
    if (album && album.length > 0) {
      for (const img of album) {
        images.push({
          id: img.id,
          fileId,
          headingId: card.id,
          level,
          storagePath: img.storagePath,
          imageUrl: img.imageUrl,
          isActive: img.isActive,
          label: img.label,
          sortOrder: img.sortOrder,
          createdAt: img.createdAt,
        });
      }
    }
  }
  return images;
}

/** @deprecated Legacy extraction — kept for backward compat with IndexedDB. Use extractAlbumImages. */
export function extractImages(card: Card, fileId: string): StoredImage[] {
  const images: StoredImage[] = [];
  for (const level of DETAIL_LEVELS) {
    const cardUrl = card.activeImageMap?.[level] || card.cardUrlMap?.[level];
    const history = card.imageHistoryMap?.[level];
    if (cardUrl || (history && history.length > 0)) {
      images.push({
        fileId,
        headingId: card.id,
        level,
        cardUrl: cardUrl || '',
        imageHistory: (history || []).map((v) => ({
          imageUrl: v.imageUrl,
          timestamp: v.timestamp,
          label: v.label,
        })),
      });
    }
  }
  return images;
}

// ── CardItem (Card | CardFolder) serialization ──

/**
 * Serialize a CardItem[] into flat StoredHeading[] + folder metadata.
 * Cards inside folders get `folderId` set. All items get `orderIndex` for ordering.
 */
export function serializeCardItems(
  items: CardItem[],
  nuggetId: string,
): { headings: StoredHeading[]; folders: StoredNugget['folders'] } {
  const headings: StoredHeading[] = [];
  const folders: NonNullable<StoredNugget['folders']> = [];

  items.forEach((item, topIdx) => {
    if (isCardFolder(item)) {
      folders.push({
        id: item.id,
        name: item.name,
        collapsed: item.collapsed,
        orderIndex: topIdx,
        createdAt: item.createdAt,
        lastModifiedAt: item.lastModifiedAt,
        autoDeckSessionId: item.autoDeckSessionId,
      });
      item.cards.forEach((card, cardIdx) => {
        const sh = serializeCard(card, nuggetId);
        sh.folderId = item.id;
        sh.orderIndex = cardIdx;
        headings.push(sh);
      });
    } else {
      const sh = serializeCard(item, nuggetId);
      sh.orderIndex = topIdx;
      headings.push(sh);
    }
  });

  return { headings, folders: folders.length > 0 ? folders : undefined };
}

/**
 * Deserialize StoredHeading[] + folder metadata back into CardItem[].
 * Backward compatible: headings without folderId become root-level cards.
 */
export function deserializeCardItems(
  headings: StoredHeading[],
  images: StoredImage[] | StoredAlbumImage[],
  folders?: StoredNugget['folders'],
): CardItem[] {
  if (!folders || folders.length === 0) {
    // No folders — all cards at root (backward compat)
    return headings.map((sh) => deserializeCard(sh, images));
  }

  const folderMap = new Map(folders.map((f) => [f.id, f]));
  const folderHeadings = new Map<string, StoredHeading[]>();
  const rootHeadings: { orderIndex: number; heading: StoredHeading }[] = [];

  for (const sh of headings) {
    const fid = sh.folderId;
    if (fid && folderMap.has(fid)) {
      const arr = folderHeadings.get(fid) || [];
      arr.push(sh);
      folderHeadings.set(fid, arr);
    } else {
      rootHeadings.push({ orderIndex: sh.orderIndex ?? 0, heading: sh });
    }
  }

  // Build result with ordering
  const items: { orderIndex: number; item: CardItem }[] = [];

  for (const rh of rootHeadings) {
    items.push({ orderIndex: rh.orderIndex, item: deserializeCard(rh.heading, images) });
  }

  for (const [folderId, sf] of folderMap) {
    const fh = (folderHeadings.get(folderId) || []).sort(
      (a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0),
    );
    const cards = fh.map((h) => deserializeCard(h, images));
    const folder: CardFolder = {
      kind: 'folder' as const,
      id: sf.id,
      name: sf.name,
      cards,
      collapsed: sf.collapsed,
      createdAt: sf.createdAt,
      lastModifiedAt: sf.lastModifiedAt,
      autoDeckSessionId: sf.autoDeckSessionId,
    };
    items.push({
      orderIndex: sf.orderIndex,
      item: folder,
    });
  }

  items.sort((a, b) => a.orderIndex - b.orderIndex);
  return items.map((i) => i.item);
}

/** Migrate any legacy level keys inside a Partial<Record<DetailLevel, T>> map. */
function migrateLevelMap<T>(map?: Partial<Record<string, T>>): Partial<Record<DetailLevel, T>> | undefined {
  if (!map) return map as any;
  const out: Partial<Record<string, T>> = {};
  for (const [key, val] of Object.entries(map)) {
    out[LEGACY_LEVEL_MAP[key] || key] = val;
  }
  return out as Partial<Record<DetailLevel, T>>;
}

export function deserializeCard(stored: StoredHeading, images: StoredImage[] | StoredAlbumImage[]): Card {
  // Migrate legacy levelOfDetail in settings
  const settings = stored.settings ? { ...stored.settings } : stored.settings;
  if (settings?.levelOfDetail && LEGACY_LEVEL_MAP[settings.levelOfDetail as string]) {
    settings.levelOfDetail = LEGACY_LEVEL_MAP[settings.levelOfDetail as string];
  }

  // Migrate detailLevel: prefer explicitly stored field, fall back to settings.levelOfDetail
  const detailLevel = stored.detailLevel || (settings?.levelOfDetail ? settings.levelOfDetail : undefined);

  const card: Card = {
    id: stored.headingId,
    level: stored.level,
    text: stored.text,
    selected: stored.selected,
    detailLevel,
    settings,
    synthesisMap: migrateLevelMap(stored.synthesisMap),
    visualPlanMap: migrateLevelMap(stored.visualPlanMap),
    lastGeneratedContentMap: migrateLevelMap(stored.lastGeneratedContentMap),
    lastPromptMap: migrateLevelMap(stored.lastPromptMap),
    isSynthesizingMap: {},
    isGeneratingMap: {},
    createdAt: stored.createdAt,
    lastEditedAt: stored.lastEditedAt,
    sourceDocuments: stored.sourceDocuments,
  };

  // Merge image data back into card — detect album vs legacy format
  const matchingImages = images.filter((img) => img.headingId === stored.headingId);
  if (matchingImages.length > 0) {
    const isAlbumFormat = 'isActive' in matchingImages[0];

    if (isAlbumFormat) {
      // New album format (StoredAlbumImage[])
      const albumMap: Partial<Record<DetailLevel, AlbumImage[]>> = {};
      const activeImageMap: Partial<Record<DetailLevel, string>> = {};

      for (const img of matchingImages as StoredAlbumImage[]) {
        const lvl = (LEGACY_LEVEL_MAP[img.level as string] || img.level) as DetailLevel;
        if (!albumMap[lvl]) albumMap[lvl] = [];
        albumMap[lvl]!.push({
          id: img.id,
          imageUrl: img.imageUrl,
          storagePath: img.storagePath,
          label: img.label,
          isActive: img.isActive,
          createdAt: img.createdAt,
          sortOrder: img.sortOrder,
        });
        if (img.isActive && img.imageUrl) {
          activeImageMap[lvl] = img.imageUrl;
        }
      }

      // Sort each album by sortOrder
      for (const lvl of Object.keys(albumMap) as DetailLevel[]) {
        albumMap[lvl]!.sort((a, b) => a.sortOrder - b.sortOrder);
      }

      card.albumMap = albumMap;
      if (Object.keys(activeImageMap).length > 0) {
        card.activeImageMap = activeImageMap;
      }
    } else {
      // Legacy format (StoredImage[]) — convert to album
      const albumMap: Partial<Record<DetailLevel, AlbumImage[]>> = {};
      const activeImageMap: Partial<Record<DetailLevel, string>> = {};

      for (const img of matchingImages as StoredImage[]) {
        const lvl = (LEGACY_LEVEL_MAP[img.level as string] || img.level) as DetailLevel;
        const album: AlbumImage[] = [];
        let sortIdx = 0;

        // Add history entries as non-active album items
        if (img.imageHistory?.length > 0) {
          for (const v of img.imageHistory) {
            album.push({
              id: `legacy-${stored.headingId}-${lvl}-${sortIdx}`,
              imageUrl: v.imageUrl,
              storagePath: '',
              label: v.label || `Version ${sortIdx + 1}`,
              isActive: false,
              createdAt: v.timestamp,
              sortOrder: sortIdx,
            });
            sortIdx++;
          }
        }

        // Add current image as active
        if (img.cardUrl) {
          album.push({
            id: `legacy-${stored.headingId}-${lvl}-current`,
            imageUrl: img.cardUrl,
            storagePath: '',
            label: 'Current',
            isActive: true,
            createdAt: Date.now(),
            sortOrder: sortIdx,
          });
          activeImageMap[lvl] = img.cardUrl;
        }

        if (album.length > 0) {
          albumMap[lvl] = album;
        }
      }

      card.albumMap = Object.keys(albumMap).length > 0 ? albumMap : undefined;
      card.activeImageMap = Object.keys(activeImageMap).length > 0 ? activeImageMap : undefined;
    }
  }

  return card;
}

// ── Nugget serialization ──

export function serializeNugget(n: Nugget): StoredNugget {
  return {
    id: n.id,
    name: n.name,
    type: n.type,
    messages: n.messages,
    docChangeLog: n.docChangeLog,
    lastDocChangeSyncSeq: n.lastDocChangeSyncSeq,
    sourcesLogStats: n.sourcesLogStats,
    sourcesLog: n.sourcesLog,
    subject: n.subject,
    subjectReviewNeeded: n.subjectReviewNeeded,
    briefReviewNeeded: n.briefReviewNeeded,
    stylingOptions: n.stylingOptions,
    qualityReport: n.qualityReport,
    dqafReport: n.dqafReport,
    engagementPurpose: n.engagementPurpose,
    briefing: n.briefing,
    briefingSuggestions: n.briefingSuggestions,
    lastClosedAt: n.lastClosedAt,
    createdAt: n.createdAt,
    lastModifiedAt: n.lastModifiedAt,
  };
}

export function deserializeNugget(sn: StoredNugget, cards: CardItem[], documents: UploadedFile[]): Nugget {
  // Backfill seq on legacy events that lack it
  const docChangeLog = sn.docChangeLog?.map((e, i) => (
    e.seq != null ? e : { ...e, seq: i + 1 }
  ));

  // Initialize sourcesLogStats from legacy data if missing
  let sourcesLogStats: SourcesLogStats | undefined = sn.sourcesLogStats;
  if (!sourcesLogStats && docChangeLog && docChangeLog.length > 0) {
    const lastTimestamp = docChangeLog.reduce((max, e) => Math.max(max, e.timestamp), 0);
    const maxSeq = docChangeLog.reduce((max, e) => Math.max(max, e.seq), 0);
    sourcesLogStats = {
      logsCreated: 0,
      logsDeleted: 0,
      logsArchived: 0,
      lastUpdated: lastTimestamp,
      rawEventSeq: maxSeq,
      lastCheckpointRawSeq: 0,
    };
  }
  // Ensure existing stats have the new fields
  if (sourcesLogStats && sourcesLogStats.rawEventSeq == null) {
    const maxSeq = docChangeLog ? docChangeLog.reduce((max, e) => Math.max(max, e.seq), 0) : 0;
    sourcesLogStats = {
      ...sourcesLogStats,
      rawEventSeq: maxSeq,
      lastCheckpointRawSeq: sourcesLogStats.lastCheckpointRawSeq ?? 0,
    };
  }

  return {
    id: sn.id,
    name: sn.name,
    type: sn.type as 'insights',
    documents,
    cards,
    messages: sn.messages,
    docChangeLog,
    lastDocChangeSyncSeq: sn.lastDocChangeSyncSeq,
    sourcesLogStats,
    sourcesLog: sn.sourcesLog,
    subject: sn.subject,
    subjectReviewNeeded: sn.subjectReviewNeeded,
    briefReviewNeeded: sn.briefReviewNeeded,
    stylingOptions: sn.stylingOptions,
    qualityReport: sn.qualityReport,
    dqafReport: sn.dqafReport,
    engagementPurpose: sn.engagementPurpose,
    briefing: sn.briefing,
    briefingSuggestions: sn.briefingSuggestions,
    lastClosedAt: sn.lastClosedAt,
    createdAt: sn.createdAt,
    lastModifiedAt: sn.lastModifiedAt,
  };
}

// ── Nugget document serialization ──

export function serializeNuggetDocument(nuggetId: string, doc: UploadedFile): StoredNuggetDocument {
  const stored: StoredNuggetDocument = {
    nuggetId,
    docId: doc.id,
    name: doc.name,
    size: doc.size,
    type: doc.type,
    lastModified: doc.lastModified,
    content: doc.content,
    status: doc.status === 'ready' ? 'ready' : 'error',
    progress: doc.status === 'ready' ? 100 : 0,
  };

  // Persist native PDF fields
  if (doc.sourceType) stored.sourceType = doc.sourceType;
  if (doc.pdfBase64) stored.pdfBase64 = doc.pdfBase64;
  if (doc.fileId) stored.fileId = doc.fileId;
  if (doc.structure) stored.structure = doc.structure;
  if (doc.tocSource) stored.tocSource = doc.tocSource;
  if (doc.originalFormat) stored.originalFormat = doc.originalFormat;
  if (doc.createdAt) stored.createdAt = doc.createdAt;
  if (doc.lastEditedAt) stored.lastEditedAt = doc.lastEditedAt;
  if (doc.lastRenamedAt) stored.lastRenamedAt = doc.lastRenamedAt;
  if (doc.originalName) stored.originalName = doc.originalName;
  if (doc.sourceOrigin) stored.sourceOrigin = doc.sourceOrigin;
  if (doc.version) stored.version = doc.version;
  if (doc.lastEnabledAt) stored.lastEnabledAt = doc.lastEnabledAt;
  if (doc.lastDisabledAt) stored.lastDisabledAt = doc.lastDisabledAt;
  if (doc.bookmarks) stored.bookmarks = doc.bookmarks;
  if (doc.bookmarkSource) stored.bookmarkSource = doc.bookmarkSource;

  return stored;
}

export function deserializeNuggetDocument(stored: StoredNuggetDocument): UploadedFile {
  const doc: UploadedFile = {
    id: stored.docId,
    name: stored.name,
    size: stored.size,
    type: stored.type,
    lastModified: stored.lastModified,
    content: stored.content,
    status: stored.status,
    progress: stored.progress,
  };

  // Restore native PDF fields
  if (stored.sourceType) doc.sourceType = stored.sourceType;
  if (stored.pdfBase64) doc.pdfBase64 = stored.pdfBase64;
  if (stored.fileId) doc.fileId = stored.fileId;
  if (stored.structure) doc.structure = stored.structure;
  if (stored.tocSource) doc.tocSource = stored.tocSource;
  if (stored.originalFormat) doc.originalFormat = stored.originalFormat;
  if (stored.createdAt) doc.createdAt = stored.createdAt;
  if (stored.lastEditedAt) doc.lastEditedAt = stored.lastEditedAt;
  if (stored.lastRenamedAt) doc.lastRenamedAt = stored.lastRenamedAt;
  if (stored.originalName) doc.originalName = stored.originalName;
  if (stored.sourceOrigin) doc.sourceOrigin = stored.sourceOrigin;
  if (stored.version) doc.version = stored.version;
  if (stored.lastEnabledAt) doc.lastEnabledAt = stored.lastEnabledAt;
  if (stored.lastDisabledAt) doc.lastDisabledAt = stored.lastDisabledAt;

  // Restore bookmarks, or migrate from flat structure if absent
  if (stored.bookmarks) {
    doc.bookmarks = stored.bookmarks as BookmarkNode[];
    doc.bookmarkSource = stored.bookmarkSource;
  } else if (stored.sourceType === 'native-pdf' && stored.structure?.length) {
    // Auto-migrate: convert existing flat headings to nested bookmarks
    const migratedHeadings: Heading[] = stored.structure.map((h) => ({
      level: h.level,
      text: h.text,
      id: h.id,
      page: h.page,
    }));
    doc.bookmarks = headingsToBookmarks(migratedHeadings);
    doc.bookmarkSource = 'manual';
  }

  return doc;
}

// ── Project serialization ──

export function serializeProject(p: Project): StoredProject {
  return {
    id: p.id,
    name: p.name,
    nuggetIds: p.nuggetIds,
    isCollapsed: p.isCollapsed,
    createdAt: p.createdAt,
    lastModifiedAt: p.lastModifiedAt,
  };
}

export function deserializeProject(sp: StoredProject): Project {
  return {
    id: sp.id,
    name: sp.name,
    nuggetIds: sp.nuggetIds,
    isCollapsed: sp.isCollapsed,
    createdAt: sp.createdAt,
    lastModifiedAt: sp.lastModifiedAt,
  };
}
