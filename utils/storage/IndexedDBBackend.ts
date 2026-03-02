import { InsightsDocument } from '../../types';
import { createLogger } from '../logger';
import {
  StorageBackend,
  AppSessionState,
  StoredFile,
  StoredHeading,
  StoredImage,
  StoredInsightsSession,
  StoredNugget,
  StoredNuggetDocument,
  StoredProject,
} from './StorageBackend';

const log = createLogger('IndexedDB');

const DB_NAME = 'infonugget-db';
const DB_VERSION = 5;

// Store names — v1
const STORE_APP_STATE = 'appState';
const STORE_FILES = 'files';
const STORE_HEADINGS = 'headings';
const STORE_IMAGES = 'images';
const STORE_INSIGHTS_SESSION = 'insightsSession';
const STORE_INSIGHTS_DOCS = 'insightsDocs';
const STORE_INSIGHTS_HEADINGS = 'insightsHeadings';
const STORE_INSIGHTS_IMAGES = 'insightsImages';

// Store names — v2 (nuggets)
const STORE_DOCUMENTS = 'documents'; // v2 legacy — kept for migration reads
const STORE_NUGGETS = 'nuggets';
const STORE_NUGGET_HEADINGS = 'nuggetHeadings';
const STORE_NUGGET_IMAGES = 'nuggetImages';

// Store names — v3 (per-nugget owned documents)
const STORE_NUGGET_DOCUMENTS = 'nuggetDocuments';

// Store names — v4 (projects)
const STORE_PROJECTS = 'projects';

const ALL_STORES = [
  STORE_APP_STATE,
  STORE_FILES,
  STORE_HEADINGS,
  STORE_IMAGES,
  STORE_INSIGHTS_SESSION,
  STORE_INSIGHTS_DOCS,
  STORE_INSIGHTS_HEADINGS,
  STORE_INSIGHTS_IMAGES,
  STORE_DOCUMENTS,
  STORE_NUGGETS,
  STORE_NUGGET_HEADINGS,
  STORE_NUGGET_IMAGES,
  STORE_NUGGET_DOCUMENTS,
  STORE_PROJECTS,
];

// ── Helpers ──

function promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function promisifyTransaction(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
  });
}

// ── Image storage: Blob conversion ──
//
// Images are stored as native Blobs in IndexedDB for ~33% savings over base64.
// At the read/write boundary we convert between the runtime format (data URL
// strings on StoredImage) and the storage format (Blob objects).
// The load path is backward-compatible — if a stored value is already a string
// (legacy base64 data URL), it passes through unchanged. This enables lazy
// migration: old records convert to Blob format on their next save.

/** Convert a data URL string to a Blob for storage. */
function dataUrlToBlob(dataUrl: string): Blob {
  if (!dataUrl.startsWith('data:')) {
    // Not a data URL — wrap as-is (shouldn't happen in practice)
    return new Blob([dataUrl], { type: 'application/octet-stream' });
  }
  const commaIdx = dataUrl.indexOf(',');
  const header = dataUrl.substring(0, commaIdx);
  const base64 = dataUrl.substring(commaIdx + 1);
  const mime = header.match(/:(.*?);/)?.[1] || 'image/png';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}

/** Convert a Blob back to a data URL string for runtime use. */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Convert a runtime URL (blob: object URL or data: URL) to a Blob for storage. */
async function urlToBlob(url: string): Promise<Blob> {
  if (url.startsWith('blob:')) {
    const response = await fetch(url);
    return response.blob();
  }
  return dataUrlToBlob(url);
}

/** Internal storage representation — uses Blobs instead of data URL strings. */
interface StoredImageBlob {
  fileId: string;
  headingId: string;
  level: string;
  cardUrl: Blob;
  imageHistory: {
    imageUrl: Blob;
    timestamp: number;
    label: string;
  }[];
}

/** Convert StoredImage (runtime, string URLs) → StoredImageBlob (storage, Blobs). */
async function imageToBlobStorage(image: StoredImage): Promise<StoredImageBlob> {
  const cardUrl = await urlToBlob(image.cardUrl);
  const imageHistory = await Promise.all(
    image.imageHistory.map(async (v) => ({
      imageUrl: await urlToBlob(v.imageUrl),
      timestamp: v.timestamp,
      label: v.label,
    })),
  );
  return {
    fileId: image.fileId,
    headingId: image.headingId,
    level: image.level,
    cardUrl,
    imageHistory,
  };
}

/**
 * Convert storage record → StoredImage (runtime, string URLs).
 * Backward-compatible: handles both legacy format (string data URLs)
 * and new format (Blob objects).
 */
async function blobStorageToImage(stored: any): Promise<StoredImage> {
  let cardUrl: string;
  if (stored.cardUrl instanceof Blob) {
    cardUrl = await blobToDataUrl(stored.cardUrl);
  } else {
    cardUrl = stored.cardUrl; // Already a string (legacy data)
  }

  const imageHistory = await Promise.all(
    (stored.imageHistory || []).map(async (v: any) => {
      let imageUrl: string;
      if (v.imageUrl instanceof Blob) {
        imageUrl = await blobToDataUrl(v.imageUrl);
      } else {
        imageUrl = v.imageUrl; // Legacy string
      }
      return { imageUrl, timestamp: v.timestamp, label: v.label };
    }),
  );

  return {
    fileId: stored.fileId,
    headingId: stored.headingId,
    level: stored.level,
    cardUrl,
    imageHistory,
  };
}

/**
 * Legacy helper — converts blob: URLs to data: URLs (no Blob storage).
 * Used by insights image methods which still use the old string-based format.
 */
async function convertImageBlobUrls(image: StoredImage): Promise<StoredImage> {
  const cardUrl = image.cardUrl.startsWith('blob:')
    ? await blobToDataUrl(await urlToBlob(image.cardUrl))
    : image.cardUrl;
  const imageHistory = await Promise.all(
    image.imageHistory.map(async (v) => ({
      ...v,
      imageUrl: v.imageUrl.startsWith('blob:') ? await blobToDataUrl(await urlToBlob(v.imageUrl)) : v.imageUrl,
    })),
  );
  return { ...image, cardUrl, imageHistory };
}

// ── Implementation ──

export class IndexedDBBackend implements StorageBackend {
  private db: IDBDatabase | null = null;
  private ready = false;

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        const tx = (event.target as IDBOpenDBRequest).transaction!;
        const oldVersion = event.oldVersion;
        if (oldVersion < 1) this.createStoresV1(db);
        if (oldVersion < 2) this.createStoresV2(db);
        if (oldVersion < 3) this.createStoresV3(db);
        if (oldVersion < 4) this.createStoresV4(db);
        if (oldVersion < 5) this.migrateV5(tx);
      };

      request.onsuccess = () => {
        this.db = request.result;
        this.ready = true;
        resolve();
      };

      request.onerror = () => {
        log.error('IndexedDB init failed:', request.error);
        reject(request.error);
      };
    });
  }

  private createStoresV1(db: IDBDatabase): void {
    if (!db.objectStoreNames.contains(STORE_APP_STATE)) {
      db.createObjectStore(STORE_APP_STATE);
    }
    if (!db.objectStoreNames.contains(STORE_FILES)) {
      db.createObjectStore(STORE_FILES, { keyPath: 'id' });
    }
    if (!db.objectStoreNames.contains(STORE_HEADINGS)) {
      const store = db.createObjectStore(STORE_HEADINGS, { keyPath: ['fileId', 'headingId'] });
      store.createIndex('byFile', 'fileId', { unique: false });
    }
    if (!db.objectStoreNames.contains(STORE_IMAGES)) {
      const store = db.createObjectStore(STORE_IMAGES, { keyPath: ['fileId', 'headingId', 'level'] });
      store.createIndex('byFile', 'fileId', { unique: false });
    }
    if (!db.objectStoreNames.contains(STORE_INSIGHTS_SESSION)) {
      db.createObjectStore(STORE_INSIGHTS_SESSION);
    }
    if (!db.objectStoreNames.contains(STORE_INSIGHTS_DOCS)) {
      db.createObjectStore(STORE_INSIGHTS_DOCS, { keyPath: 'id' });
    }
    if (!db.objectStoreNames.contains(STORE_INSIGHTS_HEADINGS)) {
      db.createObjectStore(STORE_INSIGHTS_HEADINGS, { keyPath: 'headingId' });
    }
    if (!db.objectStoreNames.contains(STORE_INSIGHTS_IMAGES)) {
      db.createObjectStore(STORE_INSIGHTS_IMAGES, { keyPath: ['headingId', 'level'] });
    }
  }

  private createStoresV2(db: IDBDatabase): void {
    if (!db.objectStoreNames.contains(STORE_DOCUMENTS)) {
      db.createObjectStore(STORE_DOCUMENTS, { keyPath: 'id' });
    }
    if (!db.objectStoreNames.contains(STORE_NUGGETS)) {
      db.createObjectStore(STORE_NUGGETS, { keyPath: 'id' });
    }
    if (!db.objectStoreNames.contains(STORE_NUGGET_HEADINGS)) {
      const store = db.createObjectStore(STORE_NUGGET_HEADINGS, { keyPath: ['fileId', 'headingId'] });
      store.createIndex('byNugget', 'fileId', { unique: false });
    }
    if (!db.objectStoreNames.contains(STORE_NUGGET_IMAGES)) {
      const store = db.createObjectStore(STORE_NUGGET_IMAGES, { keyPath: ['fileId', 'headingId', 'level'] });
      store.createIndex('byNugget', 'fileId', { unique: false });
    }
  }

  private createStoresV3(db: IDBDatabase): void {
    if (!db.objectStoreNames.contains(STORE_NUGGET_DOCUMENTS)) {
      const store = db.createObjectStore(STORE_NUGGET_DOCUMENTS, { keyPath: ['nuggetId', 'docId'] });
      store.createIndex('byNugget', 'nuggetId', { unique: false });
    }
  }

  private createStoresV4(db: IDBDatabase): void {
    if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
      db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
    }
  }

  private migrateV5(tx: IDBTransaction): void {
    // Clear 4 pure-legacy stores that only contain pre-migration data.
    // These stores were written during the v1/v2 era and are read-only after
    // migration to nugget-based storage. Any data in them has already been
    // migrated to nuggets/nuggetDocuments/nuggetHeadings/nuggetImages.
    //
    // DO NOT touch: insightsSession, insightsDocs, insightsHeadings, insightsImages
    // — those are still actively written by the persistence layer.
    const legacyStores = [STORE_FILES, STORE_HEADINGS, STORE_IMAGES, STORE_DOCUMENTS];
    for (const name of legacyStores) {
      if (tx.objectStoreNames.contains(name)) {
        tx.objectStore(name).clear();
      }
    }
  }

  isReady(): boolean {
    return this.ready;
  }

  private getDB(): IDBDatabase {
    if (!this.db) throw new Error('IndexedDB not initialized. Call init() first.');
    return this.db;
  }

  // ── App state ──

  async saveAppState(state: AppSessionState): Promise<void> {
    const db = this.getDB();
    const tx = db.transaction(STORE_APP_STATE, 'readwrite');
    tx.objectStore(STORE_APP_STATE).put(state, 'current');
    await promisifyTransaction(tx);
  }

  async loadAppState(): Promise<AppSessionState | null> {
    const db = this.getDB();
    const tx = db.transaction(STORE_APP_STATE, 'readonly');
    const result = await promisifyRequest(tx.objectStore(STORE_APP_STATE).get('current'));
    return result ?? null;
  }

  // ── Files ──

  async saveFile(file: StoredFile): Promise<void> {
    const db = this.getDB();
    const tx = db.transaction(STORE_FILES, 'readwrite');
    tx.objectStore(STORE_FILES).put(file);
    await promisifyTransaction(tx);
  }

  async loadFiles(): Promise<StoredFile[]> {
    const db = this.getDB();
    const tx = db.transaction(STORE_FILES, 'readonly');
    return await promisifyRequest(tx.objectStore(STORE_FILES).getAll());
  }

  async deleteFile(fileId: string): Promise<void> {
    const db = this.getDB();
    const tx = db.transaction(STORE_FILES, 'readwrite');
    tx.objectStore(STORE_FILES).delete(fileId);
    await promisifyTransaction(tx);
  }

  // ── Headings ──

  async saveHeadings(fileId: string, headings: StoredHeading[]): Promise<void> {
    const db = this.getDB();
    const tx = db.transaction(STORE_HEADINGS, 'readwrite');
    const store = tx.objectStore(STORE_HEADINGS);
    const index = store.index('byFile');

    // Delete existing headings for this file
    const existingKeys = await promisifyRequest(index.getAllKeys(fileId));
    for (const key of existingKeys) {
      store.delete(key);
    }

    // Write new headings
    for (const h of headings) {
      store.put(h);
    }

    await promisifyTransaction(tx);
  }

  async loadHeadings(fileId: string): Promise<StoredHeading[]> {
    const db = this.getDB();
    const tx = db.transaction(STORE_HEADINGS, 'readonly');
    const index = tx.objectStore(STORE_HEADINGS).index('byFile');
    return await promisifyRequest(index.getAll(fileId));
  }

  async deleteHeadings(fileId: string): Promise<void> {
    const db = this.getDB();
    const tx = db.transaction(STORE_HEADINGS, 'readwrite');
    const store = tx.objectStore(STORE_HEADINGS);
    const index = store.index('byFile');
    const keys = await promisifyRequest(index.getAllKeys(fileId));
    for (const key of keys) {
      store.delete(key);
    }
    await promisifyTransaction(tx);
  }

  // ── Images ──

  async saveImage(image: StoredImage): Promise<void> {
    const converted = await convertImageBlobUrls(image);
    const db = this.getDB();
    const tx = db.transaction(STORE_IMAGES, 'readwrite');
    tx.objectStore(STORE_IMAGES).put(converted);
    await promisifyTransaction(tx);
  }

  async loadImages(fileId: string): Promise<StoredImage[]> {
    const db = this.getDB();
    const tx = db.transaction(STORE_IMAGES, 'readonly');
    const index = tx.objectStore(STORE_IMAGES).index('byFile');
    return await promisifyRequest(index.getAll(fileId));
  }

  async deleteImages(fileId: string): Promise<void> {
    const db = this.getDB();
    const tx = db.transaction(STORE_IMAGES, 'readwrite');
    const store = tx.objectStore(STORE_IMAGES);
    const index = store.index('byFile');
    const keys = await promisifyRequest(index.getAllKeys(fileId));
    for (const key of keys) {
      store.delete(key);
    }
    await promisifyTransaction(tx);
  }

  // ── Insights session ──

  async saveInsightsSession(session: StoredInsightsSession): Promise<void> {
    const db = this.getDB();
    const tx = db.transaction(STORE_INSIGHTS_SESSION, 'readwrite');
    tx.objectStore(STORE_INSIGHTS_SESSION).put(session, 'current');
    await promisifyTransaction(tx);
  }

  async loadInsightsSession(): Promise<StoredInsightsSession | null> {
    const db = this.getDB();
    const tx = db.transaction(STORE_INSIGHTS_SESSION, 'readonly');
    const result = await promisifyRequest(tx.objectStore(STORE_INSIGHTS_SESSION).get('current'));
    return result ?? null;
  }

  async deleteInsightsSession(): Promise<void> {
    const db = this.getDB();
    const tx = db.transaction(STORE_INSIGHTS_SESSION, 'readwrite');
    tx.objectStore(STORE_INSIGHTS_SESSION).delete('current');
    await promisifyTransaction(tx);
  }

  // ── Insights documents ──

  async saveInsightsDoc(doc: InsightsDocument): Promise<void> {
    const db = this.getDB();
    const tx = db.transaction(STORE_INSIGHTS_DOCS, 'readwrite');
    tx.objectStore(STORE_INSIGHTS_DOCS).put(doc);
    await promisifyTransaction(tx);
  }

  async loadInsightsDocs(): Promise<InsightsDocument[]> {
    const db = this.getDB();
    const tx = db.transaction(STORE_INSIGHTS_DOCS, 'readonly');
    return await promisifyRequest(tx.objectStore(STORE_INSIGHTS_DOCS).getAll());
  }

  async deleteInsightsDoc(docId: string): Promise<void> {
    const db = this.getDB();
    const tx = db.transaction(STORE_INSIGHTS_DOCS, 'readwrite');
    tx.objectStore(STORE_INSIGHTS_DOCS).delete(docId);
    await promisifyTransaction(tx);
  }

  // ── Insights headings ──

  async saveInsightsHeadings(headings: StoredHeading[]): Promise<void> {
    const db = this.getDB();
    const tx = db.transaction(STORE_INSIGHTS_HEADINGS, 'readwrite');
    const store = tx.objectStore(STORE_INSIGHTS_HEADINGS);

    // Clear all existing
    await promisifyRequest(store.clear());

    // Write new
    for (const h of headings) {
      store.put(h);
    }

    await promisifyTransaction(tx);
  }

  async loadInsightsHeadings(): Promise<StoredHeading[]> {
    const db = this.getDB();
    const tx = db.transaction(STORE_INSIGHTS_HEADINGS, 'readonly');
    return await promisifyRequest(tx.objectStore(STORE_INSIGHTS_HEADINGS).getAll());
  }

  async deleteInsightsHeadings(): Promise<void> {
    const db = this.getDB();
    const tx = db.transaction(STORE_INSIGHTS_HEADINGS, 'readwrite');
    await promisifyRequest(tx.objectStore(STORE_INSIGHTS_HEADINGS).clear());
  }

  // ── Insights images ──

  async saveInsightsImage(image: StoredImage): Promise<void> {
    const converted = await convertImageBlobUrls(image);
    const db = this.getDB();
    const tx = db.transaction(STORE_INSIGHTS_IMAGES, 'readwrite');
    tx.objectStore(STORE_INSIGHTS_IMAGES).put(converted);
    await promisifyTransaction(tx);
  }

  async loadInsightsImages(): Promise<StoredImage[]> {
    const db = this.getDB();
    const tx = db.transaction(STORE_INSIGHTS_IMAGES, 'readonly');
    return await promisifyRequest(tx.objectStore(STORE_INSIGHTS_IMAGES).getAll());
  }

  async deleteInsightsImages(): Promise<void> {
    const db = this.getDB();
    const tx = db.transaction(STORE_INSIGHTS_IMAGES, 'readwrite');
    await promisifyRequest(tx.objectStore(STORE_INSIGHTS_IMAGES).clear());
  }

  // ── Nugget documents (per-nugget owned) ──

  async saveNuggetDocument(doc: StoredNuggetDocument): Promise<void> {
    const db = this.getDB();
    const tx = db.transaction(STORE_NUGGET_DOCUMENTS, 'readwrite');
    tx.objectStore(STORE_NUGGET_DOCUMENTS).put(doc);
    await promisifyTransaction(tx);
  }

  async loadNuggetDocuments(nuggetId: string): Promise<StoredNuggetDocument[]> {
    const db = this.getDB();
    const tx = db.transaction(STORE_NUGGET_DOCUMENTS, 'readonly');
    const index = tx.objectStore(STORE_NUGGET_DOCUMENTS).index('byNugget');
    return await promisifyRequest(index.getAll(nuggetId));
  }

  async deleteNuggetDocument(nuggetId: string, docId: string): Promise<void> {
    const db = this.getDB();
    const tx = db.transaction(STORE_NUGGET_DOCUMENTS, 'readwrite');
    tx.objectStore(STORE_NUGGET_DOCUMENTS).delete([nuggetId, docId]);
    await promisifyTransaction(tx);
  }

  async deleteNuggetDocuments(nuggetId: string): Promise<void> {
    const db = this.getDB();
    const tx = db.transaction(STORE_NUGGET_DOCUMENTS, 'readwrite');
    const store = tx.objectStore(STORE_NUGGET_DOCUMENTS);
    const index = store.index('byNugget');
    const keys = await promisifyRequest(index.getAllKeys(nuggetId));
    for (const key of keys) {
      store.delete(key);
    }
    await promisifyTransaction(tx);
  }

  // ── Documents (v2 legacy — migration reads only) ──

  async loadDocuments(): Promise<StoredFile[]> {
    const db = this.getDB();
    if (!db.objectStoreNames.contains(STORE_DOCUMENTS)) return [];
    const tx = db.transaction(STORE_DOCUMENTS, 'readonly');
    return await promisifyRequest(tx.objectStore(STORE_DOCUMENTS).getAll());
  }

  // ── Nuggets ──

  async saveNugget(nugget: StoredNugget): Promise<void> {
    const db = this.getDB();
    const tx = db.transaction(STORE_NUGGETS, 'readwrite');
    tx.objectStore(STORE_NUGGETS).put(nugget);
    await promisifyTransaction(tx);
  }

  async loadNuggets(): Promise<StoredNugget[]> {
    const db = this.getDB();
    const tx = db.transaction(STORE_NUGGETS, 'readonly');
    return await promisifyRequest(tx.objectStore(STORE_NUGGETS).getAll());
  }

  async deleteNugget(nuggetId: string): Promise<void> {
    const db = this.getDB();
    const tx = db.transaction(STORE_NUGGETS, 'readwrite');
    tx.objectStore(STORE_NUGGETS).delete(nuggetId);
    await promisifyTransaction(tx);
  }

  // ── Nugget headings ──

  async saveNuggetHeadings(nuggetId: string, headings: StoredHeading[]): Promise<void> {
    const db = this.getDB();
    const tx = db.transaction(STORE_NUGGET_HEADINGS, 'readwrite');
    const store = tx.objectStore(STORE_NUGGET_HEADINGS);
    const index = store.index('byNugget');

    // Delete existing headings for this nugget
    const existingKeys = await promisifyRequest(index.getAllKeys(nuggetId));
    for (const key of existingKeys) {
      store.delete(key);
    }

    // Write new headings
    for (const h of headings) {
      store.put(h);
    }

    await promisifyTransaction(tx);
  }

  async saveNuggetHeading(heading: StoredHeading): Promise<void> {
    const db = this.getDB();
    const tx = db.transaction(STORE_NUGGET_HEADINGS, 'readwrite');
    tx.objectStore(STORE_NUGGET_HEADINGS).put(heading);
    await promisifyTransaction(tx);
  }

  async loadNuggetHeadings(nuggetId: string): Promise<StoredHeading[]> {
    const db = this.getDB();
    const tx = db.transaction(STORE_NUGGET_HEADINGS, 'readonly');
    const index = tx.objectStore(STORE_NUGGET_HEADINGS).index('byNugget');
    return await promisifyRequest(index.getAll(nuggetId));
  }

  async deleteNuggetHeadings(nuggetId: string): Promise<void> {
    const db = this.getDB();
    const tx = db.transaction(STORE_NUGGET_HEADINGS, 'readwrite');
    const store = tx.objectStore(STORE_NUGGET_HEADINGS);
    const index = store.index('byNugget');
    const keys = await promisifyRequest(index.getAllKeys(nuggetId));
    for (const key of keys) {
      store.delete(key);
    }
    await promisifyTransaction(tx);
  }

  // ── Nugget images ──

  async saveNuggetImage(image: StoredImage): Promise<void> {
    // Convert to Blob format BEFORE opening the transaction
    const blobbed = await imageToBlobStorage(image);
    const db = this.getDB();
    const tx = db.transaction(STORE_NUGGET_IMAGES, 'readwrite');
    tx.objectStore(STORE_NUGGET_IMAGES).put(blobbed);
    await promisifyTransaction(tx);
  }

  async saveNuggetImages(images: StoredImage[]): Promise<void> {
    if (images.length === 0) return;
    // Convert all images to Blob format BEFORE opening the transaction
    // (IndexedDB transactions auto-close if the event loop goes idle during async work)
    const blobbed = await Promise.all(images.map(imageToBlobStorage));
    const db = this.getDB();
    const tx = db.transaction(STORE_NUGGET_IMAGES, 'readwrite');
    const store = tx.objectStore(STORE_NUGGET_IMAGES);
    for (const img of blobbed) {
      store.put(img);
    }
    await promisifyTransaction(tx);
  }

  async loadNuggetImages(nuggetId: string): Promise<StoredImage[]> {
    const db = this.getDB();
    const tx = db.transaction(STORE_NUGGET_IMAGES, 'readonly');
    const index = tx.objectStore(STORE_NUGGET_IMAGES).index('byNugget');
    const raw = await promisifyRequest(index.getAll(nuggetId));
    // Convert Blobs back to data URLs (backward-compatible with legacy string format)
    return Promise.all(raw.map(blobStorageToImage));
  }

  async deleteNuggetImages(nuggetId: string): Promise<void> {
    const db = this.getDB();
    const tx = db.transaction(STORE_NUGGET_IMAGES, 'readwrite');
    const store = tx.objectStore(STORE_NUGGET_IMAGES);
    const index = store.index('byNugget');
    const keys = await promisifyRequest(index.getAllKeys(nuggetId));
    for (const key of keys) {
      store.delete(key);
    }
    await promisifyTransaction(tx);
  }

  async deleteNuggetImage(fileId: string, headingId: string, level: string): Promise<void> {
    const db = this.getDB();
    const tx = db.transaction(STORE_NUGGET_IMAGES, 'readwrite');
    tx.objectStore(STORE_NUGGET_IMAGES).delete([fileId, headingId, level]);
    await promisifyTransaction(tx);
  }

  // ── Atomic nugget save (headings + images + documents in one transaction) ──

  async saveNuggetDataAtomic(
    nuggetId: string,
    nugget: StoredNugget,
    headings: StoredHeading[],
    images: StoredImage[],
    documents: StoredNuggetDocument[],
  ): Promise<void> {
    // All async work (Blob conversion) MUST complete BEFORE opening the transaction.
    // IndexedDB transactions auto-commit if the event loop goes idle during async work.
    const convertedImages = await Promise.all(images.map(imageToBlobStorage));

    const db = this.getDB();
    const stores = [STORE_NUGGETS, STORE_NUGGET_HEADINGS, STORE_NUGGET_IMAGES, STORE_NUGGET_DOCUMENTS];
    const tx = db.transaction(stores, 'readwrite');

    // 1. Nugget metadata
    tx.objectStore(STORE_NUGGETS).put(nugget);

    // 2. Headings — delete old + write new (same pattern as batch method)
    const hStore = tx.objectStore(STORE_NUGGET_HEADINGS);
    const existingHeadingKeys = await promisifyRequest(hStore.index('byNugget').getAllKeys(nuggetId));
    for (const key of existingHeadingKeys) {
      hStore.delete(key);
    }
    for (const h of headings) {
      hStore.put(h);
    }

    // 3. Images — upsert all (put overwrites existing records with same key)
    const iStore = tx.objectStore(STORE_NUGGET_IMAGES);
    for (const img of convertedImages) {
      iStore.put(img);
    }

    // 4. Documents — upsert all
    const dStore = tx.objectStore(STORE_NUGGET_DOCUMENTS);
    for (const doc of documents) {
      dStore.put(doc);
    }

    await promisifyTransaction(tx);
  }

  // ── Lightweight nugget ID enumeration ──

  async loadAllNuggetIds(): Promise<string[]> {
    const db = this.getDB();
    const tx = db.transaction(STORE_NUGGETS, 'readonly');
    const keys = await promisifyRequest(tx.objectStore(STORE_NUGGETS).getAllKeys());
    return keys as string[];
  }

  // ── Legacy store cleanup ──

  async clearLegacyStores(): Promise<void> {
    const db = this.getDB();
    const legacyStores = [STORE_FILES, STORE_HEADINGS, STORE_IMAGES, STORE_DOCUMENTS];
    const availableStores = legacyStores.filter((s) => db.objectStoreNames.contains(s));
    if (availableStores.length === 0) return;
    const tx = db.transaction(availableStores, 'readwrite');
    for (const name of availableStores) {
      tx.objectStore(name).clear();
    }
    await promisifyTransaction(tx);
  }

  // ── Projects ──

  async saveProject(project: StoredProject): Promise<void> {
    const db = this.getDB();
    const tx = db.transaction(STORE_PROJECTS, 'readwrite');
    tx.objectStore(STORE_PROJECTS).put(project);
    await promisifyTransaction(tx);
  }

  async loadProjects(): Promise<StoredProject[]> {
    const db = this.getDB();
    const tx = db.transaction(STORE_PROJECTS, 'readonly');
    return await promisifyRequest(tx.objectStore(STORE_PROJECTS).getAll());
  }

  async deleteProject(projectId: string): Promise<void> {
    const db = this.getDB();
    const tx = db.transaction(STORE_PROJECTS, 'readwrite');
    tx.objectStore(STORE_PROJECTS).delete(projectId);
    await promisifyTransaction(tx);
  }

  // ── Token usage ──

  async saveTokenUsage(totals: Record<string, unknown>): Promise<void> {
    const db = this.getDB();
    const tx = db.transaction(STORE_APP_STATE, 'readwrite');
    tx.objectStore(STORE_APP_STATE).put(totals, 'tokenUsage');
    await promisifyTransaction(tx);
  }

  async loadTokenUsage(): Promise<Record<string, unknown> | null> {
    const db = this.getDB();
    const tx = db.transaction(STORE_APP_STATE, 'readonly');
    const result = await promisifyRequest(tx.objectStore(STORE_APP_STATE).get('tokenUsage'));
    return result ?? null;
  }

  // ── Custom styles ──

  async saveCustomStyles(styles: unknown[]): Promise<void> {
    const db = this.getDB();
    const tx = db.transaction(STORE_APP_STATE, 'readwrite');
    tx.objectStore(STORE_APP_STATE).put(styles, 'customStyles');
    await promisifyTransaction(tx);
  }

  async loadCustomStyles(): Promise<unknown[] | null> {
    const db = this.getDB();
    const tx = db.transaction(STORE_APP_STATE, 'readonly');
    const result = await promisifyRequest(tx.objectStore(STORE_APP_STATE).get('customStyles'));
    return result ?? null;
  }

  // ── Clear all ──

  async clearAll(): Promise<void> {
    const db = this.getDB();
    const tx = db.transaction(ALL_STORES, 'readwrite');
    for (const storeName of ALL_STORES) {
      tx.objectStore(storeName).clear();
    }
    await promisifyTransaction(tx);
  }
}
