import {
  DetailLevel,
  StylingOptions,
  NuggetType,
  ChatMessage,
  InsightsDocument,
  DocChangeEvent,
  SourceOrigin,
  QualityReport,
  DQAFReport,
  SourcesLogStats,
  SourcesLogEntry,
  AutoDeckBriefing,
  BriefingSuggestions,
} from '../../types';

// ── Stored types (what lives in the database) ──

export interface AppSessionState {
  selectedNuggetId: string | null;
  selectedDocumentId?: string | null;
  selectedProjectId?: string | null;
  activeCardId: string | null;
  /** Which project is "opened" in the workspace (null = show landing page). */
  openProjectId?: string | null;
  // Legacy fields — kept for backward compat reads, ignored on write
  selectedFileId?: string | null;
  workflowMode?: string;
}

export interface StoredFile {
  id: string;
  name: string;
  size: number;
  type: string;
  lastModified: number;
  content?: string;
  status: 'ready' | 'error';
  progress: number;
}

export interface StoredHeading {
  fileId: string;
  headingId: string;
  level: number;
  text: string;
  selected?: boolean;
  detailLevel?: DetailLevel;
  settings?: StylingOptions;
  synthesisMap?: Partial<Record<DetailLevel, string>>;
  /** @deprecated Planner pipeline removed — kept for backward compat with stored cards */
  visualPlanMap?: Partial<Record<DetailLevel, string>>;
  lastGeneratedContentMap?: Partial<Record<DetailLevel, string>>;
  lastPromptMap?: Partial<Record<DetailLevel, string>>;
  createdAt?: number;
  lastEditedAt?: number;
  sourceDocuments?: string[];
  /** CardFolder ID this card belongs to (undefined = root-level card). */
  folderId?: string;
  /** Ordering index for reconstructing card/folder order on deserialization. */
  orderIndex?: number;
}

export interface StoredImageVersion {
  imageUrl: string; // guaranteed data URL (blob URLs converted before storage)
  timestamp: number;
  label: string;
}

/** @deprecated Legacy format — kept for backward compat with IndexedDB. Use StoredAlbumImage. */
export interface StoredImage {
  fileId: string;
  headingId: string;
  level: DetailLevel;
  cardUrl: string;
  imageHistory: StoredImageVersion[];
}

/** Album-based image storage — one row per image in the card_images table. */
export interface StoredAlbumImage {
  id: string;
  fileId: string;       // nuggetId
  headingId: string;    // cardId
  level: DetailLevel;
  storagePath: string;
  imageUrl: string;     // signed URL (hydrated on load)
  isActive: boolean;
  label: string;
  sortOrder: number;
  createdAt: number;
}

export interface StoredInsightsSession {
  id: string;
  messages: ChatMessage[];
}

export interface StoredNugget {
  id: string;
  name: string;
  type: NuggetType;
  messages?: ChatMessage[];
  docChangeLog?: DocChangeEvent[];
  lastDocChangeSyncSeq?: number;
  sourcesLogStats?: SourcesLogStats;
  sourcesLog?: SourcesLogEntry[];
  domain?: string;
  domainReviewNeeded?: boolean;
  /** @deprecated Use domain instead — kept for backward compat reads */
  subject?: string;
  /** @deprecated Use domainReviewNeeded instead — kept for backward compat reads */
  subjectReviewNeeded?: boolean;
  briefReviewNeeded?: boolean;
  stylingOptions?: StylingOptions;
  createdAt: number;
  lastModifiedAt: number;
  /** @deprecated Use dqafReport instead */
  qualityReport?: QualityReport;
  /** DQAF v2 assessment report — full 3-stage quality assessment */
  dqafReport?: DQAFReport;
  /** Engagement purpose statement for DQAF assessment */
  engagementPurpose?: string;
  /** Persisted briefing (5-field descriptive brief) — used by Auto-Deck and DQAF */
  briefing?: AutoDeckBriefing;
  /** Persisted AI-generated briefing suggestions (dropdown options) */
  briefingSuggestions?: BriefingSuggestions;
  /** ISO timestamp of when this nugget was last navigated away from (for Files API cleanup). */
  lastClosedAt?: string;
  /** Persisted DocViz analysis result */
  docVizResult?: import('../../types').DocVizResult;
  /** CardFolder metadata for nuggets that contain card folders. */
  folders?: Array<{
    id: string;
    name: string;
    collapsed?: boolean;
    orderIndex: number;
    createdAt: number;
    lastModifiedAt: number;
  }>;
}

export interface StoredNuggetDocument {
  nuggetId: string;
  docId: string;
  name: string;
  size: number;
  type: string;
  lastModified: number;
  content?: string;
  status: 'ready' | 'error';
  progress: number;
  /** Distinguishes how this document is stored and rendered. undefined = 'markdown' (backward compat). */
  sourceType?: 'markdown' | 'native-pdf';
  /** Raw PDF as base64 for iframe viewer (only for native-pdf documents). */
  pdfBase64?: string;
  /** Anthropic Files API file ID — used to reference the document in chat without re-uploading content. */
  fileId?: string;
  /** Document heading structure (TOC). For native PDFs, extracted via Claude; for markdown, derived from content. */
  structure?: Array<{ level: number; text: string; id: string; startIndex?: number; page?: number; wordCount?: number }>;
  /** How the TOC was extracted: from an explicit TOC page or by visual scanning. */
  tocSource?: 'toc_page' | 'visual_scan';
  /** Original file format before conversion to markdown. */
  originalFormat?: 'md' | 'pdf';
  /** Timestamp when this document was added to the nugget (epoch ms). */
  createdAt?: number;
  /** Timestamp when this document's content was last saved in the editor (epoch ms). */
  lastEditedAt?: number;
  /** Timestamp when this document was last renamed (epoch ms). */
  lastRenamedAt?: number;
  /** Original file name at upload time. */
  originalName?: string;
  /** How this document arrived in the nugget. */
  sourceOrigin?: SourceOrigin;
  /** Version counter — increments on rename or content edit. */
  version?: number;
  /** Timestamp when chat was last enabled (epoch ms). */
  lastEnabledAt?: number;
  /** Timestamp when chat was last disabled (epoch ms). */
  lastDisabledAt?: number;
  /** Nested bookmark tree (native-pdf only). Single source of truth for document structure. */
  bookmarks?: Array<{ id: string; title: string; page: number; level: number; children: any[]; wordCount?: number }>;
  /** How the bookmark tree was obtained (native-pdf only). */
  bookmarkSource?: 'pdf_bookmarks' | 'ai_generated' | 'manual';
}

export interface StoredProject {
  id: string;
  name: string;
  nuggetIds: string[];
  isCollapsed?: boolean;
  branding?: import('../../types').BrandingSettings;
  headerFooter?: import('../../types').HeaderFooterSettings;
  createdAt: number;
  lastModifiedAt: number;
}

// ── Storage interface (swappable backend) ──

export interface StorageBackend {
  init(): Promise<void>;
  isReady(): boolean;

  // App session state
  saveAppState(state: AppSessionState): Promise<void>;
  loadAppState(): Promise<AppSessionState | null>;

  // Files (metadata + content, no structure)
  saveFile(file: StoredFile): Promise<void>;
  loadFiles(): Promise<StoredFile[]>;
  deleteFile(fileId: string): Promise<void>;

  // Headings (per file, text data only)
  saveHeadings(fileId: string, headings: StoredHeading[]): Promise<void>;
  loadHeadings(fileId: string): Promise<StoredHeading[]>;
  deleteHeadings(fileId: string): Promise<void>;

  // Images (per heading+level, separated for performance)
  saveImage(image: StoredImage): Promise<void>;
  loadImages(fileId: string): Promise<StoredImage[]>;
  deleteImages(fileId: string): Promise<void>;

  // Insights session (chat messages)
  saveInsightsSession(session: StoredInsightsSession): Promise<void>;
  loadInsightsSession(): Promise<StoredInsightsSession | null>;
  deleteInsightsSession(): Promise<void>;

  // Insights documents
  saveInsightsDoc(doc: InsightsDocument): Promise<void>;
  loadInsightsDocs(): Promise<InsightsDocument[]>;
  deleteInsightsDoc(docId: string): Promise<void>;

  // Insights headings
  saveInsightsHeadings(headings: StoredHeading[]): Promise<void>;
  loadInsightsHeadings(): Promise<StoredHeading[]>;
  deleteInsightsHeadings(): Promise<void>;

  // Insights images
  saveInsightsImage(image: StoredImage): Promise<void>;
  loadInsightsImages(): Promise<StoredImage[]>;
  deleteInsightsImages(): Promise<void>;

  // Nugget documents (per-nugget owned)
  saveNuggetDocument(doc: StoredNuggetDocument): Promise<void>;
  loadNuggetDocuments(nuggetId: string): Promise<StoredNuggetDocument[]>;
  deleteNuggetDocument(nuggetId: string, docId: string): Promise<void>;
  deleteNuggetDocuments(nuggetId: string): Promise<void>;

  // Documents (v2 legacy — kept for migration reads only)
  loadDocuments(): Promise<StoredFile[]>;

  // Nuggets
  saveNugget(nugget: StoredNugget): Promise<void>;
  loadNuggets(): Promise<StoredNugget[]>;
  deleteNugget(nuggetId: string): Promise<void>;

  // Nugget headings (keyed by nuggetId)
  saveNuggetHeadings(nuggetId: string, headings: StoredHeading[]): Promise<void>;
  saveNuggetHeading(heading: StoredHeading): Promise<void>;
  loadNuggetHeadings(nuggetId: string): Promise<StoredHeading[]>;
  deleteNuggetHeadings(nuggetId: string): Promise<void>;

  // Nugget images (keyed by nuggetId)
  saveNuggetImage(image: StoredImage): Promise<void>;
  saveNuggetImages(images: StoredImage[]): Promise<void>;
  loadNuggetImages(nuggetId: string): Promise<StoredAlbumImage[] | StoredImage[]>;
  deleteNuggetImages(nuggetId: string): Promise<void>;
  deleteNuggetImage(fileId: string, headingId: string, level: string): Promise<void>;

  // Atomic nugget save (headings + images + documents in one transaction)
  saveNuggetDataAtomic(
    nuggetId: string,
    nugget: StoredNugget,
    headings: StoredHeading[],
    images: StoredImage[],
    documents: StoredNuggetDocument[],
  ): Promise<void>;

  // Lightweight nugget ID enumeration (no full deserialization)
  loadAllNuggetIds(): Promise<string[]>;

  // Legacy store cleanup (clear migration-only stores)
  clearLegacyStores(): Promise<void>;

  // Projects
  saveProject(project: StoredProject): Promise<void>;
  loadProjects(): Promise<StoredProject[]>;
  deleteProject(projectId: string): Promise<void>;

  // Token usage
  saveTokenUsage(totals: Record<string, unknown>): Promise<void>;
  loadTokenUsage(): Promise<Record<string, unknown> | null>;

  // Custom styles
  saveCustomStyles(styles: unknown[]): Promise<void>;
  loadCustomStyles(): Promise<unknown[] | null>;

  // Clear everything
  clearAll(): Promise<void>;
}
