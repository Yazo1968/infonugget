import { deleteFromFilesAPI } from './ai';
import { manageImagesApi } from './api';
import { createLogger } from './logger';
import type { Nugget } from '../types';

const log = createLogger('DeletionCleanup');

export interface CleanupResult {
  filesApiDeleted: number;
  filesApiFailed: number;
  albumsCleanedUp: boolean;
}

/**
 * Clean up all external files for a nugget (best-effort, storage-first):
 *   1. Delete Files API entries for all documents with fileId
 *   2. Delete all card album images via manage-images API
 *
 * Never throws — logs failures. The scheduled orphan cleanup catches stragglers.
 */
export async function cleanupNuggetExternalFiles(nugget: Nugget): Promise<CleanupResult> {
  let filesApiDeleted = 0;
  let filesApiFailed = 0;
  let albumsCleanedUp = false;

  // 1. Files API cleanup (parallel, best-effort)
  const fileIdDocs = nugget.documents.filter(d => d.fileId);
  if (fileIdDocs.length > 0) {
    const results = await Promise.allSettled(
      fileIdDocs.map(doc => deleteFromFilesAPI(doc.fileId!)),
    );
    for (const r of results) {
      if (r.status === 'fulfilled') filesApiDeleted++;
      else { filesApiFailed++; log.warn('Files API cleanup failed:', r.reason); }
    }
  }

  // 2. Album cleanup — single call deletes all card images for the nugget
  try {
    await manageImagesApi({ action: 'delete_all_albums', nuggetId: nugget.id });
    albumsCleanedUp = true;
  } catch (err) {
    log.warn(`Album cleanup failed for nugget ${nugget.id}:`, err);
  }

  log.info(`Nugget ${nugget.id} cleanup: ${filesApiDeleted} files deleted, ${filesApiFailed} failed, albums=${albumsCleanedUp}`);
  return { filesApiDeleted, filesApiFailed, albumsCleanedUp };
}
