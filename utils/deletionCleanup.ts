import { deleteFromFilesAPI } from './ai';
import { createLogger } from './logger';
import type { Nugget } from '../types';

const log = createLogger('DeletionCleanup');

export interface CleanupResult {
  filesApiDeleted: number;
  filesApiFailed: number;
}

/**
 * Clean up external files for a nugget (best-effort):
 *   - Delete Files API entries for all documents with fileId
 *
 * Storage cleanup (card images, PDFs) is handled by SupabaseBackend's
 * deleteNuggetImages/deleteNuggetDocuments before the nugget row is deleted.
 * The card_images rows are cleaned up via CASCADE on nugget deletion.
 *
 * Never throws — logs failures. Expired files (404) are silently ignored.
 */
export async function cleanupNuggetExternalFiles(nugget: Nugget): Promise<CleanupResult> {
  let filesApiDeleted = 0;
  let filesApiFailed = 0;

  // Files API cleanup (parallel, best-effort)
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

  log.info(`Nugget ${nugget.id} cleanup: ${filesApiDeleted} files deleted, ${filesApiFailed} failed`);
  return { filesApiDeleted, filesApiFailed };
}
