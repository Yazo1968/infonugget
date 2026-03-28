/**
 * Gemini File Search Store lifecycle helpers.
 *
 * These are fire-and-forget side effects called from nugget/document
 * lifecycle hooks in AppContext and useDocumentOperations.
 * Failures are logged but never block the primary operation.
 */

import {
  createStoreApi,
  deleteStoreApi,
  uploadDocumentToStoreApi,
  removeDocumentFromStoreApi,
} from './api';
import { createLogger } from './logger';
import type { Nugget, UploadedFile } from '../types';

const log = createLogger('FileSearchStore');

// ── Store lifecycle ──

/**
 * Create a Gemini File Search Store for a nugget.
 * Returns the store name on success, undefined on failure.
 */
export async function createStoreForNugget(
  nuggetId: string,
): Promise<string | undefined> {
  try {
    const res = await createStoreApi(nuggetId);
    log.info(`Store created for nugget ${nuggetId}: ${res.storeName}`);
    return res.storeName;
  } catch (err) {
    log.warn(`Failed to create store for nugget ${nuggetId}:`, err);
    return undefined;
  }
}

/**
 * Delete a Gemini File Search Store for a nugget (best-effort).
 */
export async function deleteStoreForNugget(
  nuggetId: string,
  storeName: string | undefined,
): Promise<void> {
  if (!storeName) return;
  try {
    await deleteStoreApi(storeName);
    log.info(`Store deleted for nugget ${nuggetId}`);
  } catch (err) {
    log.warn(`Failed to delete store for nugget ${nuggetId}:`, err);
  }
}

// ── Document lifecycle ──

/**
 * Import a document into the nugget's File Search Store.
 * Returns the Gemini document name on success, undefined on failure.
 */
export async function importDocumentToStore(
  nuggetId: string,
  storeName: string,
  documentName: string,
  fileBase64: string,
  mimeType: string,
): Promise<string | undefined> {
  try {
    const res = await uploadDocumentToStoreApi(
      storeName,
      fileBase64,
      documentName,
      mimeType,
      { nugget_id: nuggetId, document_name: documentName },
      undefined, // chunkingConfig
      300_000,   // pollTimeoutMs: 5 minutes for large PDFs
    );
    log.info(`Document "${documentName}" imported to store for nugget ${nuggetId}`);
    return res.documentName ?? undefined;
  } catch (err) {
    log.warn(`Failed to import document "${documentName}" to store:`, err);
    return undefined;
  }
}

/**
 * Remove a document from the nugget's File Search Store (best-effort).
 */
export async function removeDocumentFromStore(
  nuggetId: string,
  storeName: string,
  geminiDocumentName: string,
): Promise<void> {
  try {
    await removeDocumentFromStoreApi(storeName, geminiDocumentName);
    log.info(`Document removed from store for nugget ${nuggetId}`);
  } catch (err) {
    log.warn(`Failed to remove document from store for nugget ${nuggetId}:`, err);
  }
}

// ── Batch helpers ──

/**
 * Delete stores for multiple nuggets (used by project deletion).
 * Best-effort, parallel execution.
 */
export async function deleteStoresForNuggets(nuggets: Nugget[]): Promise<void> {
  const withStores = nuggets.filter((n) => n.geminiStoreName);
  if (withStores.length === 0) return;
  await Promise.allSettled(
    withStores.map((n) => deleteStoreForNugget(n.id, n.geminiStoreName)),
  );
}

/**
 * Remove all documents in a nugget from its File Search Store (used by nugget deletion).
 * Best-effort, parallel execution.
 */
export async function removeAllDocumentsFromStore(
  nuggetId: string,
  storeName: string,
  documents: UploadedFile[],
): Promise<void> {
  const withGeminiName = documents.filter((d) => d.geminiDocumentName);
  if (withGeminiName.length === 0) return;
  await Promise.allSettled(
    withGeminiName.map((d) =>
      removeDocumentFromStore(nuggetId, storeName, d.geminiDocumentName!),
    ),
  );
}
