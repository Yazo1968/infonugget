import type { UploadedFile } from '../types';

/**
 * Document resolution utilities — consolidates the identical
 * document filtering logic used across useCardGeneration,
 * useInsightsLab, and useSmartDeck.
 */

/**
 * Filters documents to only those that are enabled and have content available.
 * A document has content if it has inline content, a Files API file ID, or PDF base64.
 */
export function resolveEnabledDocs(docs: UploadedFile[]): UploadedFile[] {
  return docs.filter(
    (d) => d.enabled !== false && (d.content || d.fileId || d.pdfBase64),
  );
}

/**
 * Resolves documents for ordered selection (used by Auto-Deck).
 * Filters to available docs, then orders by the provided ID list.
 */
export function resolveOrderedDocs(
  allDocs: UploadedFile[],
  orderedIds: string[],
): UploadedFile[] {
  const available = allDocs.filter((d) => d.enabled !== false && (d.content || d.fileId || d.pdfBase64));
  return orderedIds
    .map((id) => available.find((d) => d.id === id))
    .filter((d): d is UploadedFile => !!d);
}
