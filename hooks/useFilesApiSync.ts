import { useEffect, useRef } from 'react';
import { useNuggetContext } from '../context/NuggetContext';
import { uploadToFilesAPI } from '../utils/ai';
import { base64ToBlob } from '../utils/fileProcessing';
import { resolveEnabledDocs } from '../utils/documentResolution';
import { useToast } from '../components/ToastNotification';
import { createLogger } from '../utils/logger';

const log = createLogger('FilesApiSync');

/**
 * On nugget open, checks all enabled documents for missing `fileId`.
 * Uploads them in the background (non-blocking) and updates the document
 * in context when each upload succeeds.
 *
 * This mirrors the auto-upload pattern in `useCardGeneration.ts` (lines 104-147)
 * but runs proactively at nugget open instead of waiting for a synthesis call.
 *
 * Paired with `useNuggetCloseTracker` and the server-side `cleanup-files` Edge
 * Function, this forms the Files API lifecycle: close → cleanup (24h) → re-upload.
 */
export function useFilesApiSync(): void {
  const { selectedNugget, selectedNuggetId, updateNuggetDocument } = useNuggetContext();
  const { addToast } = useToast();

  // Track which nugget is currently being synced to prevent duplicate runs
  const syncingNuggetIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!selectedNugget || !selectedNuggetId) return;

    // Avoid re-entry if already syncing this nugget
    if (syncingNuggetIdRef.current === selectedNuggetId) return;

    const enabledDocs = resolveEnabledDocs(selectedNugget.documents);
    const docsNeedingUpload = enabledDocs.filter(
      (d) => !d.fileId && (d.content || d.pdfBase64),
    );

    if (docsNeedingUpload.length === 0) return;

    syncingNuggetIdRef.current = selectedNuggetId;
    const nuggetId = selectedNuggetId;
    let cancelled = false;

    (async () => {
      log.info(`Re-uploading ${docsNeedingUpload.length} document(s) for nugget ${nuggetId}`);
      let successCount = 0;
      let failCount = 0;

      for (const doc of docsNeedingUpload) {
        if (cancelled) break;
        try {
          let newFileId: string | undefined;
          if (doc.sourceType === 'native-pdf' && doc.pdfBase64) {
            newFileId = await uploadToFilesAPI(
              base64ToBlob(doc.pdfBase64, 'application/pdf'),
              doc.name,
              'application/pdf',
            );
          } else if (doc.content) {
            newFileId = await uploadToFilesAPI(doc.content, doc.name, 'text/plain');
          }
          if (newFileId && !cancelled) {
            updateNuggetDocument(doc.id, { ...doc, fileId: newFileId });
            successCount++;
          }
        } catch (err: any) {
          log.warn(`Re-upload failed for "${doc.name}":`, err);
          failCount++;
        }
      }

      if (!cancelled) {
        if (failCount > 0) {
          addToast({
            type: 'warning',
            message: `${failCount} document(s) could not be synced to Files API`,
            detail: 'AI features may be limited for unsynced documents. They will retry on next open.',
            duration: 8000,
          });
        }
        if (successCount > 0) {
          log.info(`Successfully re-uploaded ${successCount} document(s)`);
        }
      }

      if (syncingNuggetIdRef.current === nuggetId) {
        syncingNuggetIdRef.current = null;
      }
    })();

    return () => {
      cancelled = true;
      if (syncingNuggetIdRef.current === nuggetId) {
        syncingNuggetIdRef.current = null;
      }
    };
    // Only trigger on nugget change — NOT on selectedNugget (avoids re-triggering during upload)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNuggetId]);
}
