import { DetailLevel, InsightsDocument } from '../../types';
import { createLogger } from '../logger';
import { supabase } from '../supabase';
import {
  StorageBackend,
  AppSessionState,
  StoredFile,
  StoredHeading,
  StoredAlbumImage,
  StoredImage,
  StoredImageVersion,
  StoredInsightsSession,
  StoredNugget,
  StoredNuggetDocument,
  StoredProject,
} from './StorageBackend';

const log = createLogger('SupabaseBackend');

// ── Helpers ──

/** Convert a data URL to a Blob for upload. */
function dataUrlToBlob(dataUrl: string): Blob {
  if (!dataUrl.startsWith('data:')) {
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

/** Convert a base64 string (no data URL prefix) to a Blob. */
function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

// ── Implementation ──

export class SupabaseBackend implements StorageBackend {
  private userId: string;
  private ready = false;

  constructor(userId: string) {
    this.userId = userId;
  }

  // ── Private storage helpers ──

  /**
   * Upload an image (from data URL) to the card-images bucket.
   * Returns the storage path.
   */
  private async uploadImage(path: string, dataUrl: string): Promise<string> {
    const blob = dataUrlToBlob(dataUrl);
    const { error } = await supabase.storage
      .from('card-images')
      .upload(path, blob, { upsert: true, contentType: blob.type });
    if (error) {
      log.error('Image upload failed:', path, error);
      throw error;
    }
    return path;
  }

  /** Get a signed URL for a storage path in the card-images bucket (1-hour expiry). */
  private async getImageUrl(path: string): Promise<string> {
    const { data, error } = await supabase.storage
      .from('card-images')
      .createSignedUrl(path, 3600); // 1 hour
    if (error || !data?.signedUrl) {
      log.error('Failed to create signed URL for:', path, error);
      return '';
    }
    return data.signedUrl;
  }

  /** Upload a PDF (from base64) to the pdfs bucket. Returns the storage path. */
  private async uploadPdf(path: string, base64: string): Promise<string> {
    const blob = base64ToBlob(base64, 'application/pdf');
    const { error } = await supabase.storage
      .from('pdfs')
      .upload(path, blob, { upsert: true, contentType: 'application/pdf' });
    if (error) {
      log.error('PDF upload failed:', path, error);
      throw error;
    }
    return path;
  }

  /** Download a PDF from the pdfs bucket and return as base64 string. */
  private async downloadPdfAsBase64(path: string): Promise<string> {
    const { data, error } = await supabase.storage.from('pdfs').download(path);
    if (error || !data) {
      log.error('PDF download failed:', path, error);
      throw error || new Error('No data returned for PDF download');
    }
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        // Strip data URL prefix to get raw base64
        const base64 = result.split(',')[1] || result;
        resolve(base64);
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(data);
    });
  }

  /** Build a unique storage path for a card image. */
  private cardImagePath(nuggetId: string, cardId: string, detailLevel: string, suffix = ''): string {
    return `${this.userId}/${nuggetId}/${cardId}/${detailLevel}${suffix ? '-' + suffix : ''}.png`;
  }

  /** Build a unique storage path for a PDF. */
  private pdfPath(nuggetId: string, docId: string): string {
    return `${this.userId}/${nuggetId}/${docId}.pdf`;
  }

  // ── Init / Ready ──

  async init(): Promise<void> {
    // Supabase client is already configured; verify connectivity by touching profiles
    try {
      const { error } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', this.userId)
        .single();
      if (error && error.code !== 'PGRST116') {
        // PGRST116 = no rows found — acceptable for new user
        log.warn('Supabase init check:', error.message);
      }
      this.ready = true;
      log.info('Supabase backend initialized for user', this.userId);
    } catch (err) {
      log.error('Supabase init failed:', err);
      throw err;
    }
  }

  isReady(): boolean {
    return this.ready;
  }

  // ── App session state ──

  async saveAppState(state: AppSessionState): Promise<void> {
    const { error } = await supabase
      .from('app_state')
      .upsert({
        user_id: this.userId,
        selected_nugget_id: state.selectedNuggetId,
        selected_document_id: state.selectedDocumentId ?? null,
        selected_project_id: state.selectedProjectId ?? null,
        active_card_id: state.activeCardId,
        open_project_id: state.openProjectId ?? null,
      }, { onConflict: 'user_id' });
    if (error) {
      log.error('saveAppState failed:', error);
      throw error;
    }
  }

  async loadAppState(): Promise<AppSessionState | null> {
    const { data, error } = await supabase
      .from('app_state')
      .select('*')
      .eq('user_id', this.userId)
      .single();
    if (error) {
      if (error.code === 'PGRST116') return null; // no rows
      log.error('loadAppState failed:', error);
      throw error;
    }
    if (!data) return null;
    return {
      selectedNuggetId: data.selected_nugget_id,
      selectedDocumentId: data.selected_document_id,
      selectedProjectId: data.selected_project_id,
      activeCardId: data.active_card_id,
      openProjectId: data.open_project_id,
    };
  }

  // ── Files (legacy — no-op for Supabase) ──

  async saveFile(_file: StoredFile): Promise<void> {
    // Legacy method — no-op for Supabase backend
  }

  async loadFiles(): Promise<StoredFile[]> {
    // Legacy method — return empty
    return [];
  }

  async deleteFile(_fileId: string): Promise<void> {
    // Legacy method — no-op
  }

  // ── Headings (legacy per-file — no-op for Supabase) ──

  async saveHeadings(_fileId: string, _headings: StoredHeading[]): Promise<void> {
    // Legacy method — no-op
  }

  async loadHeadings(_fileId: string): Promise<StoredHeading[]> {
    // Legacy method — return empty
    return [];
  }

  async deleteHeadings(_fileId: string): Promise<void> {
    // Legacy method — no-op
  }

  // ── Images (legacy per-file — no-op for Supabase) ──

  async saveImage(_image: StoredImage): Promise<void> {
    // Legacy method — no-op
  }

  async loadImages(_fileId: string): Promise<StoredImage[]> {
    // Legacy method — return empty
    return [];
  }

  async deleteImages(_fileId: string): Promise<void> {
    // Legacy method — no-op
  }

  // ── Insights session (legacy — no-op for Supabase) ──

  async saveInsightsSession(_session: StoredInsightsSession): Promise<void> {
    // Legacy method — chat messages are stored on the nugget in Supabase
  }

  async loadInsightsSession(): Promise<StoredInsightsSession | null> {
    // Legacy method — return null
    return null;
  }

  async deleteInsightsSession(): Promise<void> {
    // Legacy method — no-op
  }

  // ── Insights documents (legacy — no-op for Supabase) ──

  async saveInsightsDoc(_doc: InsightsDocument): Promise<void> {
    // Legacy method — no-op
  }

  async loadInsightsDocs(): Promise<InsightsDocument[]> {
    // Legacy method — return empty
    return [];
  }

  async deleteInsightsDoc(_docId: string): Promise<void> {
    // Legacy method — no-op
  }

  // ── Insights headings (legacy — no-op for Supabase) ──

  async saveInsightsHeadings(_headings: StoredHeading[]): Promise<void> {
    // Legacy method — no-op
  }

  async loadInsightsHeadings(): Promise<StoredHeading[]> {
    // Legacy method — return empty
    return [];
  }

  async deleteInsightsHeadings(): Promise<void> {
    // Legacy method — no-op
  }

  // ── Insights images (legacy — no-op for Supabase) ──

  async saveInsightsImage(_image: StoredImage): Promise<void> {
    // Legacy method — no-op
  }

  async loadInsightsImages(): Promise<StoredImage[]> {
    // Legacy method — return empty
    return [];
  }

  async deleteInsightsImages(): Promise<void> {
    // Legacy method — no-op
  }

  // ── Nugget documents (per-nugget owned) ──

  async saveNuggetDocument(doc: StoredNuggetDocument): Promise<void> {
    // If there's a PDF base64 payload, upload to storage only if not already stored
    let pdfStoragePath: string | null = null;
    if (doc.pdfBase64) {
      // Check if this document already has a PDF in storage (avoid redundant uploads)
      const { data: existing } = await supabase
        .from('documents')
        .select('pdf_storage_path')
        .eq('nugget_id', doc.nuggetId)
        .eq('id', doc.docId)
        .single();

      if (existing?.pdf_storage_path) {
        // PDF already in storage — reuse existing path, skip upload
        pdfStoragePath = existing.pdf_storage_path;
      } else {
        // New PDF — upload to storage
        const path = this.pdfPath(doc.nuggetId, doc.docId);
        pdfStoragePath = await this.uploadPdf(path, doc.pdfBase64);
      }
    }

    const row: Record<string, unknown> = {
      nugget_id: doc.nuggetId,
      id: doc.docId,
      user_id: this.userId,
      name: doc.name,
      size: doc.size,
      type: doc.type,
      last_modified: doc.lastModified,
      content: doc.content ?? null,
      source_type: doc.sourceType ?? 'markdown',
      pdf_storage_path: pdfStoragePath,
      file_id: doc.fileId ?? null,
      structure: doc.structure ?? null,
      bookmarks: doc.bookmarks ?? null,
      bookmark_source: doc.bookmarkSource ?? null,
      toc_source: doc.tocSource ?? null,
      original_format: doc.originalFormat ?? null,
      status: doc.status,
      progress: doc.progress,
      created_at: doc.createdAt ?? null,
      last_edited_at: doc.lastEditedAt ?? null,
      last_renamed_at: doc.lastRenamedAt ?? null,
      original_name: doc.originalName ?? null,
      source_origin: doc.sourceOrigin ?? null,
      version: doc.version ?? null,
      last_enabled_at: doc.lastEnabledAt ?? null,
      last_disabled_at: doc.lastDisabledAt ?? null,
      enabled: true, // default enabled
    };

    const { error } = await supabase
      .from('documents')
      .upsert(row, { onConflict: 'nugget_id,id' });
    if (error) {
      log.error('saveNuggetDocument failed:', error);
      throw error;
    }
  }

  async loadNuggetDocuments(nuggetId: string): Promise<StoredNuggetDocument[]> {
    const { data, error } = await supabase
      .from('documents')
      .select('*')
      .eq('nugget_id', nuggetId);
    if (error) {
      log.error('loadNuggetDocuments failed:', error);
      throw error;
    }
    if (!data) return [];

    const docs: StoredNuggetDocument[] = [];
    for (const row of data) {
      let pdfBase64: string | undefined;
      if (row.pdf_storage_path) {
        try {
          pdfBase64 = await this.downloadPdfAsBase64(row.pdf_storage_path);
        } catch (err) {
          log.warn('Failed to download PDF for doc:', row.id, err);
        }
      }

      docs.push({
        nuggetId: row.nugget_id,
        docId: row.id,
        name: row.name,
        size: row.size ?? 0,
        type: row.type ?? '',
        lastModified: row.last_modified ?? 0,
        content: row.content ?? undefined,
        status: row.status ?? 'ready',
        progress: row.progress ?? 100,
        sourceType: row.source_type ?? undefined,
        pdfBase64,
        fileId: row.file_id ?? undefined,
        structure: row.structure ?? undefined,
        bookmarks: row.bookmarks ?? undefined,
        bookmarkSource: row.bookmark_source ?? undefined,
        tocSource: row.toc_source ?? undefined,
        originalFormat: row.original_format ?? undefined,
        createdAt: row.created_at ?? undefined,
        lastEditedAt: row.last_edited_at ?? undefined,
        lastRenamedAt: row.last_renamed_at ?? undefined,
        originalName: row.original_name ?? undefined,
        sourceOrigin: row.source_origin ?? undefined,
        version: row.version ?? undefined,
        lastEnabledAt: row.last_enabled_at ?? undefined,
        lastDisabledAt: row.last_disabled_at ?? undefined,
      });
    }
    return docs;
  }

  async deleteNuggetDocument(nuggetId: string, docId: string): Promise<void> {
    // Try to clean up any stored PDF first
    const { data: row } = await supabase
      .from('documents')
      .select('pdf_storage_path')
      .eq('nugget_id', nuggetId)
      .eq('id', docId)
      .single();
    if (row?.pdf_storage_path) {
      await supabase.storage.from('pdfs').remove([row.pdf_storage_path]);
    }

    const { error } = await supabase
      .from('documents')
      .delete()
      .eq('nugget_id', nuggetId)
      .eq('id', docId);
    if (error) {
      log.error('deleteNuggetDocument failed:', error);
      throw error;
    }
  }

  async deleteNuggetDocuments(nuggetId: string): Promise<void> {
    // Clean up stored PDFs first
    const { data: rows } = await supabase
      .from('documents')
      .select('pdf_storage_path')
      .eq('nugget_id', nuggetId);
    if (rows) {
      const paths = rows
        .map((r) => r.pdf_storage_path)
        .filter((p): p is string => !!p);
      if (paths.length > 0) {
        await supabase.storage.from('pdfs').remove(paths);
      }
    }

    const { error } = await supabase
      .from('documents')
      .delete()
      .eq('nugget_id', nuggetId);
    if (error) {
      log.error('deleteNuggetDocuments failed:', error);
      throw error;
    }
  }

  // ── Documents (v2 legacy — migration reads only) ──

  async loadDocuments(): Promise<StoredFile[]> {
    // Legacy method — return empty for Supabase
    return [];
  }

  // ── Nuggets ──

  async saveNugget(nugget: StoredNugget): Promise<void> {
    const { error } = await supabase
      .from('nuggets')
      .upsert({
        id: nugget.id,
        user_id: this.userId,
        name: nugget.name,
        type: nugget.type,
        messages: nugget.messages ?? null,
        doc_change_log: nugget.docChangeLog ?? null,
        last_doc_change_sync_index: nugget.lastDocChangeSyncSeq ?? null,
        sources_log_stats: nugget.sourcesLogStats ?? null,
        sources_log: nugget.sourcesLog ?? null,
        subject: nugget.subject ?? null,
        styling_options: nugget.stylingOptions ?? null,
        quality_report: nugget.dqafReport ?? nugget.qualityReport ?? null,
        engagement_purpose: nugget.engagementPurpose ?? null,
        briefing: nugget.briefing ?? null,
        briefing_suggestions: nugget.briefingSuggestions ?? null,
        nugget_last_closed_at: nugget.lastClosedAt ?? null,
        folders: nugget.folders ?? null,
        created_at: nugget.createdAt,
        last_modified_at: nugget.lastModifiedAt,
      }, { onConflict: 'id' });
    if (error) {
      log.error('saveNugget failed:', error);
      throw error;
    }
  }

  async loadNuggets(): Promise<StoredNugget[]> {
    const { data, error } = await supabase
      .from('nuggets')
      .select('*')
      .eq('user_id', this.userId);
    if (error) {
      log.error('loadNuggets failed:', error);
      throw error;
    }
    if (!data) return [];
    return data.map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type ?? 'insights',
      messages: row.messages ?? undefined,
      docChangeLog: row.doc_change_log ?? undefined,
      lastDocChangeSyncSeq: row.last_doc_change_sync_index ?? undefined,
      sourcesLogStats: row.sources_log_stats ?? undefined,
      sourcesLog: row.sources_log ?? undefined,
      subject: row.subject ?? undefined,
      stylingOptions: row.styling_options ?? undefined,
      // Discriminate DQAF v2 report (has assessmentId) from legacy QualityReport
      qualityReport: row.quality_report && !row.quality_report.assessmentId ? row.quality_report : undefined,
      dqafReport: row.quality_report?.assessmentId ? row.quality_report : undefined,
      engagementPurpose: row.engagement_purpose ?? undefined,
      briefing: row.briefing ?? undefined,
      briefingSuggestions: row.briefing_suggestions ?? undefined,
      lastClosedAt: row.nugget_last_closed_at ?? undefined,
      folders: row.folders ?? undefined,
      createdAt: row.created_at,
      lastModifiedAt: row.last_modified_at,
    }));
  }

  async deleteNugget(nuggetId: string): Promise<void> {
    const { error } = await supabase
      .from('nuggets')
      .delete()
      .eq('id', nuggetId)
      .eq('user_id', this.userId);
    if (error) {
      log.error('deleteNugget failed:', error);
      throw error;
    }
  }

  // ── Nugget headings (cards stored as JSONB on the nugget) ──

  async saveNuggetHeadings(nuggetId: string, headings: StoredHeading[]): Promise<void> {
    const { error } = await supabase
      .from('nuggets')
      .update({ cards: headings })
      .eq('id', nuggetId)
      .eq('user_id', this.userId);
    if (error) {
      log.error('saveNuggetHeadings failed:', error);
      throw error;
    }
  }

  async saveNuggetHeading(heading: StoredHeading): Promise<void> {
    // Load existing headings, upsert this one, then save back
    const nuggetId = heading.fileId; // fileId is the nuggetId in nugget-keyed headings
    const existing = await this.loadNuggetHeadings(nuggetId);
    const idx = existing.findIndex(
      (h) => h.fileId === heading.fileId && h.headingId === heading.headingId,
    );
    if (idx >= 0) {
      existing[idx] = heading;
    } else {
      existing.push(heading);
    }
    await this.saveNuggetHeadings(nuggetId, existing);
  }

  async loadNuggetHeadings(nuggetId: string): Promise<StoredHeading[]> {
    const { data, error } = await supabase
      .from('nuggets')
      .select('cards')
      .eq('id', nuggetId)
      .eq('user_id', this.userId)
      .single();
    if (error) {
      if (error.code === 'PGRST116') return []; // no rows
      log.error('loadNuggetHeadings failed:', error);
      throw error;
    }
    if (!data?.cards) return [];
    // cards is stored as JSONB — it should already be a parsed array
    return data.cards as StoredHeading[];
  }

  async deleteNuggetHeadings(nuggetId: string): Promise<void> {
    const { error } = await supabase
      .from('nuggets')
      .update({ cards: null })
      .eq('id', nuggetId)
      .eq('user_id', this.userId);
    if (error) {
      log.error('deleteNuggetHeadings failed:', error);
      throw error;
    }
  }

  // ── Nugget images ──

  async saveNuggetImage(image: StoredImage): Promise<void> {
    // Upload the main card image to storage
    const mainPath = this.cardImagePath(image.fileId, image.headingId, image.level);
    let storagePath: string | null;
    if (!image.cardUrl) {
      // No current image (deleted) — remove the old file from storage but keep history
      const { data: existing } = await supabase
        .from('card_images')
        .select('storage_path')
        .eq('nugget_id', image.fileId)
        .eq('card_id', image.headingId)
        .eq('detail_level', image.level)
        .eq('user_id', this.userId)
        .single();
      if (existing?.storage_path) {
        await supabase.storage.from('card-images').remove([existing.storage_path]);
      }
      storagePath = null;
    } else if (image.cardUrl.startsWith('data:') || image.cardUrl.startsWith('blob:')) {
      const urlToUpload = image.cardUrl.startsWith('blob:')
        ? await this.blobUrlToDataUrl(image.cardUrl)
        : image.cardUrl;
      storagePath = await this.uploadImage(mainPath, urlToUpload);
    } else {
      // Already a URL (e.g., Supabase storage URL) — just store the path
      storagePath = mainPath;
    }

    // Upload history images to storage
    const historyEntries: Array<{ imageUrl: string; timestamp: number; label: string }> = [];
    for (let i = 0; i < image.imageHistory.length; i++) {
      const version = image.imageHistory[i];
      const histPath = this.cardImagePath(image.fileId, image.headingId, image.level, `hist-${i}`);
      if (version.imageUrl.startsWith('data:') || version.imageUrl.startsWith('blob:')) {
        const urlToUpload = version.imageUrl.startsWith('blob:')
          ? await this.blobUrlToDataUrl(version.imageUrl)
          : version.imageUrl;
        await this.uploadImage(histPath, urlToUpload);
        historyEntries.push({
          imageUrl: histPath,
          timestamp: version.timestamp,
          label: version.label,
        });
      } else {
        historyEntries.push({
          imageUrl: version.imageUrl,
          timestamp: version.timestamp,
          label: version.label,
        });
      }
    }

    // Upsert the card_images metadata row
    const { error } = await supabase
      .from('card_images')
      .upsert({
        nugget_id: image.fileId,
        user_id: this.userId,
        card_id: image.headingId,
        detail_level: image.level,
        storage_path: storagePath,
        image_history: historyEntries,
      }, { onConflict: 'nugget_id,card_id,detail_level' });
    if (error) {
      log.error('saveNuggetImage failed:', error);
      throw error;
    }
  }

  async saveNuggetImages(images: StoredImage[]): Promise<void> {
    for (const image of images) {
      await this.saveNuggetImage(image);
    }
  }

  async loadNuggetImages(nuggetId: string): Promise<StoredAlbumImage[]> {
    const { data, error } = await supabase
      .from('card_images')
      .select('id, nugget_id, card_id, detail_level, storage_path, is_active, label, sort_order, created_at')
      .eq('nugget_id', nuggetId)
      .eq('user_id', this.userId)
      .order('sort_order', { ascending: true });
    if (error) {
      log.error('loadNuggetImages failed:', error);
      throw error;
    }
    if (!data) return [];

    const results: StoredAlbumImage[] = [];
    for (const row of data) {
      const imageUrl = row.storage_path
        ? await this.getImageUrl(row.storage_path)
        : '';

      results.push({
        id: row.id,
        fileId: row.nugget_id,
        headingId: row.card_id,
        level: row.detail_level as DetailLevel,
        storagePath: row.storage_path || '',
        imageUrl,
        isActive: row.is_active ?? false,
        label: row.label || '',
        sortOrder: row.sort_order ?? 0,
        createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
      });
    }
    return results;
  }

  async deleteNuggetImages(nuggetId: string): Promise<void> {
    // Fetch all image rows for this nugget to clean up storage
    const { data: rows } = await supabase
      .from('card_images')
      .select('storage_path, image_history')
      .eq('nugget_id', nuggetId)
      .eq('user_id', this.userId);

    if (rows && rows.length > 0) {
      const pathsToRemove: string[] = [];
      for (const row of rows) {
        if (row.storage_path) pathsToRemove.push(row.storage_path);
        if (row.image_history) {
          for (const entry of row.image_history as Array<{ imageUrl: string }>) {
            // Only remove paths that look like storage paths (not full URLs)
            if (entry.imageUrl && !entry.imageUrl.startsWith('http')) {
              pathsToRemove.push(entry.imageUrl);
            }
          }
        }
      }
      if (pathsToRemove.length > 0) {
        await supabase.storage.from('card-images').remove(pathsToRemove);
      }
    }

    const { error } = await supabase
      .from('card_images')
      .delete()
      .eq('nugget_id', nuggetId)
      .eq('user_id', this.userId);
    if (error) {
      log.error('deleteNuggetImages failed:', error);
      throw error;
    }
  }

  async deleteNuggetImage(fileId: string, headingId: string, level: string): Promise<void> {
    // Clean up storage file
    const { data: row } = await supabase
      .from('card_images')
      .select('storage_path, image_history')
      .eq('nugget_id', fileId)
      .eq('card_id', headingId)
      .eq('detail_level', level)
      .eq('user_id', this.userId)
      .single();

    if (row) {
      const pathsToRemove: string[] = [];
      if (row.storage_path) pathsToRemove.push(row.storage_path);
      if (row.image_history) {
        for (const entry of row.image_history as Array<{ imageUrl: string }>) {
          if (entry.imageUrl && !entry.imageUrl.startsWith('http')) {
            pathsToRemove.push(entry.imageUrl);
          }
        }
      }
      if (pathsToRemove.length > 0) {
        await supabase.storage.from('card-images').remove(pathsToRemove);
      }
    }

    const { error } = await supabase
      .from('card_images')
      .delete()
      .eq('nugget_id', fileId)
      .eq('card_id', headingId)
      .eq('detail_level', level)
      .eq('user_id', this.userId);
    if (error) {
      log.error('deleteNuggetImage failed:', error);
      throw error;
    }
  }

  // ── Atomic nugget save ──

  async saveNuggetDataAtomic(
    nuggetId: string,
    nugget: StoredNugget,
    headings: StoredHeading[],
    images: StoredImage[],
    documents: StoredNuggetDocument[],
  ): Promise<void> {
    // Supabase doesn't have multi-table transactions via the client,
    // so we do individual upserts. Errors in later steps won't roll back earlier ones.
    try {
      // 1. Nugget metadata
      await this.saveNugget(nugget);

      // 2. Cards (headings) — stored as JSONB on the nugget
      await this.saveNuggetHeadings(nuggetId, headings);

      // 3. Images — upsert each
      for (const image of images) {
        await this.saveNuggetImage(image);
      }

      // 4. Documents — upsert each
      for (const doc of documents) {
        await this.saveNuggetDocument(doc);
      }
    } catch (err) {
      log.error('saveNuggetDataAtomic failed (partial save may have occurred):', err);
      throw err;
    }
  }

  // ── Lightweight nugget ID enumeration ──

  async loadAllNuggetIds(): Promise<string[]> {
    const { data, error } = await supabase
      .from('nuggets')
      .select('id')
      .eq('user_id', this.userId);
    if (error) {
      log.error('loadAllNuggetIds failed:', error);
      throw error;
    }
    return (data || []).map((row) => row.id);
  }

  // ── Legacy store cleanup ──

  async clearLegacyStores(): Promise<void> {
    // No legacy stores to clear in Supabase — no-op
  }

  // ── Projects ──

  async saveProject(project: StoredProject): Promise<void> {
    const { error } = await supabase
      .from('projects')
      .upsert({
        id: project.id,
        user_id: this.userId,
        name: project.name,
        nugget_ids: project.nuggetIds,
        is_collapsed: project.isCollapsed ?? false,
        created_at: project.createdAt,
        last_modified_at: project.lastModifiedAt,
      }, { onConflict: 'id' });
    if (error) {
      log.error('saveProject failed:', error);
      throw error;
    }
  }

  async loadProjects(): Promise<StoredProject[]> {
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .eq('user_id', this.userId);
    if (error) {
      log.error('loadProjects failed:', error);
      throw error;
    }
    if (!data) return [];
    return data.map((row) => ({
      id: row.id,
      name: row.name,
      nuggetIds: row.nugget_ids ?? [],
      isCollapsed: row.is_collapsed ?? false,
      createdAt: row.created_at,
      lastModifiedAt: row.last_modified_at,
    }));
  }

  async deleteProject(projectId: string): Promise<void> {
    const { error } = await supabase
      .from('projects')
      .delete()
      .eq('id', projectId)
      .eq('user_id', this.userId);
    if (error) {
      log.error('deleteProject failed:', error);
      throw error;
    }
  }

  // ── Token usage ──

  async saveTokenUsage(totals: Record<string, unknown>): Promise<void> {
    const { error } = await supabase
      .from('token_usage')
      .upsert({
        user_id: this.userId,
        totals,
      }, { onConflict: 'user_id' });
    if (error) {
      log.error('saveTokenUsage failed:', error);
      throw error;
    }
  }

  async loadTokenUsage(): Promise<Record<string, unknown> | null> {
    const { data, error } = await supabase
      .from('token_usage')
      .select('totals')
      .eq('user_id', this.userId)
      .single();
    if (error) {
      if (error.code === 'PGRST116') return null;
      log.error('loadTokenUsage failed:', error);
      throw error;
    }
    return data?.totals ?? null;
  }

  // ── Custom styles ──

  async saveCustomStyles(styles: unknown[]): Promise<void> {
    // Delete existing styles for this user, then insert all
    await supabase
      .from('custom_styles')
      .delete()
      .eq('user_id', this.userId);

    if (styles.length === 0) return;

    const rows = styles.map((style: any) => ({
      user_id: this.userId,
      id: style.id,
      name: style.name,
      palette: style.palette ?? null,
      fonts: style.fonts ?? null,
      identity: style.identity ?? null,
      created_at: style.createdAt ?? Date.now(),
      last_modified_at: style.lastModifiedAt ?? Date.now(),
    }));

    const { error } = await supabase
      .from('custom_styles')
      .insert(rows);
    if (error) {
      log.error('saveCustomStyles failed:', error);
      throw error;
    }
  }

  async loadCustomStyles(): Promise<unknown[] | null> {
    const { data, error } = await supabase
      .from('custom_styles')
      .select('*')
      .eq('user_id', this.userId);
    if (error) {
      log.error('loadCustomStyles failed:', error);
      throw error;
    }
    if (!data || data.length === 0) return null;
    return data.map((row) => ({
      id: row.id,
      name: row.name,
      palette: row.palette,
      fonts: row.fonts,
      identity: row.identity,
      createdAt: row.created_at,
      lastModifiedAt: row.last_modified_at,
    }));
  }

  // ── Clear all ──

  async clearAll(): Promise<void> {
    // Delete all user data across all tables. Order matters for foreign key constraints.
    // Clean up storage first
    try {
      // List and remove all files in user's storage directories
      const { data: imageFiles } = await supabase.storage
        .from('card-images')
        .list(this.userId, { limit: 1000 });
      if (imageFiles && imageFiles.length > 0) {
        // For nested directories we need to recursively list, but a prefix-based remove works
        const paths = imageFiles.map((f) => `${this.userId}/${f.name}`);
        await supabase.storage.from('card-images').remove(paths);
      }

      const { data: pdfFiles } = await supabase.storage
        .from('pdfs')
        .list(this.userId, { limit: 1000 });
      if (pdfFiles && pdfFiles.length > 0) {
        const paths = pdfFiles.map((f) => `${this.userId}/${f.name}`);
        await supabase.storage.from('pdfs').remove(paths);
      }
    } catch (err) {
      log.warn('Storage cleanup during clearAll had errors (non-fatal):', err);
    }

    // Delete database rows
    const tables = [
      'card_images',
      'documents',
      'custom_styles',
      'token_usage',
      'app_state',
      'nuggets',
      'projects',
    ];
    for (const table of tables) {
      const { error } = await supabase
        .from(table)
        .delete()
        .eq('user_id', this.userId);
      if (error) {
        log.warn(`clearAll: failed to clear ${table}:`, error);
      }
    }
  }

  // ── Private utility ──

  /** Convert a blob: URL to a data URL for upload. */
  private async blobUrlToDataUrl(blobUrl: string): Promise<string> {
    const response = await fetch(blobUrl);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }
}
