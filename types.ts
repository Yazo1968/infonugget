export interface Palette {
  background: string;
  primary: string;
  secondary: string;
  accent: string;
  text: string;
}

export type DetailLevel = 'Executive' | 'Standard' | 'Detailed' | 'TitleCard' | 'TakeawayCard' | 'DirectContent';

export const isCoverLevel = (level: DetailLevel): boolean => level === 'TitleCard' || level === 'TakeawayCard';

export interface FontPair {
  primary: string; // Title font
  secondary: string; // Body font
}

/** Structured style identity — 3 labeled fields that replace the legacy prose blob. */
export interface StyleIdentity {
  technique: string;    // Rendering method: shapes, fills, strokes, textures
  composition: string;  // Layout rules: grid, spacing, hierarchy, arrangement
  mood: string;         // Atmosphere: era, feeling, personality, register
}

export interface CustomStyle {
  id: string;
  name: string;
  palette: Palette;
  fonts: FontPair;
  identity: string; // legacy single field — kept for backward compat
  technique?: string;   // structured field (new)
  composition?: string; // structured field (new)
  mood?: string;        // structured field (new)
  createdAt: number;
  lastModifiedAt: number;
}

export interface StylingOptions {
  levelOfDetail: DetailLevel;
  style: string;
  palette: Palette;
  fonts: FontPair;
  aspectRatio: '1:1' | '2:3' | '3:2' | '3:4' | '4:3' | '4:5' | '5:4' | '9:16' | '16:9' | '21:9';
  resolution: '1K' | '2K' | '4K';
  // Structured style identity — travels with settings to the EF
  technique?: string;
  composition?: string;
  mood?: string;
}

export interface ReferenceImage {
  url: string;
  settings: StylingOptions;
}

// ── Document content heading (H1-H6 parsed from markdown) ──

export interface Heading {
  level: number;
  text: string;
  id: string;
  selected?: boolean;
  startIndex?: number;
  /** Page number where this heading appears (native PDF only). */
  page?: number;
  /** Word count for this section's body text (native PDF only, from Gemini extraction). */
  wordCount?: number;
}

// ── PDF bookmark tree node (nested TOC structure for native PDFs) ──

export interface BookmarkNode {
  id: string;
  title: string;
  page: number;
  level: number;
  children: BookmarkNode[];
  /** Word count for this section's body text (from Gemini extraction). */
  wordCount?: number;
}

/** How the bookmark tree was obtained. */
export type BookmarkSource = 'pdf_bookmarks' | 'ai_generated' | 'manual';

// ── Album image (first-class image item in a card's album) ──

export interface AlbumImage {
  /** Database row UUID */
  id: string;
  /** Public CDN URL (derived from storage_path) */
  imageUrl: string;
  /** Path in the card-images Storage bucket */
  storagePath: string;
  /** Human-readable label, e.g. 'Generation 1', 'Modification 2' */
  label: string;
  /** Whether this is the currently displayed image for the card */
  isActive: boolean;
  /** When this image was created (epoch ms) */
  createdAt: number;
  /** Chronological position within the album */
  sortOrder: number;
}

// ── Card (the primary creative unit — synthesized content + generated image) ──

export interface Card {
  level: number;
  text: string;
  id: string;
  selected?: boolean;
  /** The structural detail level of this card (Executive, Standard, TitleCard, etc.). */
  detailLevel?: DetailLevel;
  /** @deprecated Retained for backward compat on deserialization. Use detailLevel instead. */
  settings?: StylingOptions;
  /** Stores synthesized content for each level of detail */
  synthesisMap?: Partial<Record<DetailLevel, string>>;
  /** Tracks synthesis state for each specific level */
  isSynthesizingMap?: Partial<Record<DetailLevel, boolean>>;
  startIndex?: number;
  /** Per-level active image URL (derived from albumMap, the isActive item's URL) */
  activeImageMap?: Partial<Record<DetailLevel, string>>;
  /** Per-level card generation state */
  isGeneratingMap?: Partial<Record<DetailLevel, boolean>>;
  /** Per-level album of all generated/modified images */
  albumMap?: Partial<Record<DetailLevel, AlbumImage[]>>;
  /** @deprecated Planner pipeline removed — kept for backward compat with stored cards */
  visualPlanMap?: Partial<Record<DetailLevel, string>>;
  /** Per-level snapshot of synthesis content used for card generation — used to detect content changes */
  lastGeneratedContentMap?: Partial<Record<DetailLevel, string>>;
  /** Per-level full visualizer prompt used for card generation */
  lastPromptMap?: Partial<Record<DetailLevel, string>>;
  /** Per-level layout directives from Claude's content synthesis (multi-agent pipeline) */
  layoutDirectivesMap?: Partial<Record<DetailLevel, string>>;
  /** Timestamp when this card was created */
  createdAt?: number;
  /** Timestamp when this card was last edited */
  lastEditedAt?: number;
  /** Names of documents that were active when this card was created */
  sourceDocuments?: string[];

  // ── Legacy fields (kept for backward compat deserialization, DO NOT use in new code) ──
  /** @deprecated Use activeImageMap instead */
  cardUrlMap?: Partial<Record<DetailLevel, string>>;
  /** @deprecated Use albumMap instead */
  imageHistoryMap?: Partial<Record<DetailLevel, ImageVersion[]>>;
}

/** A folder that groups cards in the card list. Created by batch generation. */
export interface CardFolder {
  kind: 'folder';
  id: string;
  name: string;
  cards: Card[];
  collapsed?: boolean;
  createdAt: number;
  lastModifiedAt: number;
}

/** A single item in the nugget's card list — either a loose card or a folder. */
export type CardItem = Card | CardFolder;

/** Type guard: is this item a CardFolder? */
export function isCardFolder(item: CardItem): item is CardFolder {
  return (item as CardFolder).kind === 'folder';
}

// ── Document origin tracking ──

export interface SourceOrigin {
  type: 'uploaded' | 'copied' | 'moved';
  /** For copy/move: name of the source project */
  sourceProjectName?: string;
  /** For copy/move: name of the source nugget */
  sourceNuggetName?: string;
  /** When the origin event occurred (epoch ms) */
  timestamp: number;
}

export interface UploadedFile {
  id: string;
  name: string;
  size: number;
  type: string;
  lastModified: number;
  content?: string;
  structure?: Heading[];
  status: 'uploading' | 'processing' | 'ready' | 'error';
  progress: number;
  /** Whether the document is included in chat context (defaults to true when undefined). Not persisted. */
  enabled?: boolean;
  /** Anthropic Files API file ID — used to reference the document in chat without re-uploading content. */
  fileId?: string;
  /** Distinguishes how this document is stored and rendered. undefined = 'markdown' (backward compat). */
  sourceType?: 'markdown' | 'native-pdf';
  /** Raw PDF as base64 for iframe viewer (only for native-pdf documents). */
  pdfBase64?: string;
  /** How the TOC was extracted: from an explicit TOC page or by visual scanning. */
  tocSource?: 'toc_page' | 'visual_scan';
  /** Nested bookmark tree (native-pdf only). Single source of truth for document structure. */
  bookmarks?: BookmarkNode[];
  /** How the bookmark tree was obtained (native-pdf only). */
  bookmarkSource?: BookmarkSource;
  /** Original file format before conversion to markdown. */
  originalFormat?: 'md' | 'pdf';
  /** Timestamp when this document was added to the nugget (epoch ms). */
  createdAt?: number;
  /** Timestamp when this document's content was last saved in the editor (epoch ms). */
  lastEditedAt?: number;
  /** Timestamp when this document was last renamed (epoch ms). */
  lastRenamedAt?: number;
  /** Original file name at upload time (never changes). */
  originalName?: string;
  /** How this document arrived in the nugget (uploaded, copied, or moved). */
  sourceOrigin?: SourceOrigin;
  /** Version counter — increments on rename or content edit. */
  version?: number;
  /** Timestamp when chat was last enabled for this document (epoch ms). */
  lastEnabledAt?: number;
  /** Timestamp when chat was last disabled for this document (epoch ms). */
  lastDisabledAt?: number;
}

export interface PendingFileUpload {
  file: File;
  placeholderId: string;
  mode: 'markdown' | 'native-pdf';
}

export interface ZoomState {
  imageUrl: string | null;
  cardId: string | null;
  cardText: string | null;
  palette?: Palette | null;
  album?: AlbumImage[];
  aspectRatio?: string; // e.g. '16:9', '4:3', '1:1', '3:4'
  resolution?: string; // e.g. '1K', '2K', '4K'
}

// Phase 1: Annotation & Zoom types
export type AnnotationTool = 'select' | 'pin' | 'arrow' | 'rectangle' | 'sketch' | 'text' | 'zoom';

export interface NormalizedPoint {
  x: number; // 0.0-1.0
  y: number; // 0.0-1.0
}

export interface ZoomViewState {
  scale: number; // 0.5 to 4.0
  panX: number; // CSS transform translateX in px
  panY: number; // CSS transform translateY in px
  isPanning: boolean;
}

// Phase 2: Annotation data types
type AnnotationType = 'pin' | 'arrow' | 'rectangle' | 'sketch';

interface BaseAnnotation {
  id: string;
  type: AnnotationType;
  color: string;
  createdAt: number;
}

export interface PinAnnotation extends BaseAnnotation {
  type: 'pin';
  position: NormalizedPoint;
  instruction: string;
}

export interface RectangleAnnotation extends BaseAnnotation {
  type: 'rectangle';
  topLeft: NormalizedPoint;
  bottomRight: NormalizedPoint;
  instruction: string;
}

export interface ArrowAnnotation extends BaseAnnotation {
  type: 'arrow';
  start: NormalizedPoint;
  end: NormalizedPoint;
  instruction: string;
}

export interface SketchAnnotation extends BaseAnnotation {
  type: 'sketch';
  points: NormalizedPoint[];
  strokeWidth: number; // normalized — thick brush for area highlighting
  instruction: string;
}

export type Annotation = PinAnnotation | RectangleAnnotation | ArrowAnnotation | SketchAnnotation;

// Phase 5: Version history
export interface ImageVersion {
  imageUrl: string; // blob URL or data URL
  timestamp: number;
  label: string; // "Original", "Modification 1", etc.
}

// ─────────────────────────────────────────────────────────────────
// Insights Workflow Types
// ─────────────────────────────────────────────────────────────────

export type WorkflowMode = 'insights';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  isCardContent?: boolean; // true if this was a "Generate Card" response
  detailLevel?: DetailLevel; // which level was requested
  savedAsCardId?: string; // if user saved this to card list
}

export interface InsightsDocument {
  id: string;
  name: string;
  type: 'md' | 'pdf';
  size: number;
  content?: string; // text content for MD files
  base64?: string; // binary content for PDF
  mediaType?: string; // MIME type for binary docs
}

export interface InsightsSession {
  id: string;
  documents: InsightsDocument[];
  messages: ChatMessage[];
  cards: Card[]; // user-curated cards
}

// ── Document change tracking ──

export type DocChangeEventType = 'added' | 'removed' | 'renamed' | 'enabled' | 'disabled' | 'updated' | 'toc_updated';

/** Magnitude data captured on 'updated' events to distinguish minor edits from major rewrites. */
export interface DocChangeMagnitude {
  charCountBefore: number;
  charCountAfter: number;
  headingCountBefore: number;
  headingCountAfter: number;
  headingTextChanged: boolean;
}

export interface DocChangeEvent {
  type: DocChangeEventType;
  docId: string;
  docName: string;
  /** For rename events, the previous name */
  oldName?: string;
  timestamp: number;
  /** Monotonic sequence number — equals sourcesLogStats.logsCreated at time of creation */
  seq: number;
  /** Magnitude data for 'updated' events (char count, heading count, heading text changes) */
  magnitude?: DocChangeMagnitude;
  /** User-editable label (set via rename in log kebab menu) */
  userLabel?: string;
}

/** Persistent audit counters for the Sources Log. Reconciliation: Created = Shown + Deleted + Archived. */
export interface SourcesLogStats {
  /** Total checkpoint entries ever created */
  logsCreated: number;
  /** Checkpoint entries removed by the user (individual delete or bulk "Delete Logs") */
  logsDeleted: number;
  /** Checkpoint entries auto-removed by the app to maintain the 20-entry cap */
  logsArchived: number;
  /** Timestamp of the most recent checkpoint */
  lastUpdated: number;
  /** Monotonic counter for raw docChangeLog events (used for seq assignment) */
  rawEventSeq: number;
  /** Highest raw event seq consumed into a checkpoint */
  lastCheckpointRawSeq: number;
}

// ── Sources Log checkpoint model ──

/** What triggered creating a Sources Log checkpoint entry */
export type SourcesLogTrigger = 'chat_initiated' | 'chat_continued' | 'smart_deck' | 'manual';

/** A single change within a checkpoint — simplified view of a raw DocChangeEvent */
export interface SourcesLogChange {
  type: DocChangeEventType;
  docName: string;
  oldName?: string;
  magnitude?: DocChangeMagnitude;
}

/** A checkpoint entry in the Sources Log — aggregates raw changes at a trigger point */
export interface SourcesLogEntry {
  /** Monotonic sequence number for this checkpoint */
  seq: number;
  /** What triggered this checkpoint */
  trigger: SourcesLogTrigger;
  /** When this checkpoint was created */
  timestamp: number;
  /** User-editable label (via rename in kebab menu) */
  userLabel?: string;
  /** Individual changes aggregated into this checkpoint */
  changes: SourcesLogChange[];
}

// ── Document Quality Check types (legacy — kept for backward compat) ──

/** @deprecated Use DQAFReport instead */
export interface TopicCluster {
  /** Cluster subject label, e.g. "AI & Workforce Transformation" */
  subject: string;
  /** One-sentence description of what this cluster covers */
  description: string;
  /** IDs of documents in this cluster */
  documentIds: string[];
  /** True if this cluster has no relationship to other clusters */
  isolated: boolean;
}

/** @deprecated Use DQAFReport instead */
export interface QualityConflict {
  /** What the conflict is about */
  description: string;
  /** The conflicting claims from different documents */
  entries: Array<{
    documentId: string;
    documentName: string;
    /** What this document states */
    claim: string;
    /** Section/paragraph reference in the document */
    location: string;
  }>;
  /** Recommendation on how to resolve */
  recommendation: string;
}

/** @deprecated Use DQAFReport instead */
export interface QualityReport {
  /** Current check status: green = clear, amber = needs recheck, red = issues found */
  status: 'green' | 'amber' | 'red';
  /** Groups of related documents by topic */
  clusters: TopicCluster[];
  /** Cross-document contradictions */
  conflicts: QualityConflict[];
  /** Whether any documents are unrelated to others */
  hasUnrelatedDocs: boolean;
  /** When the last check was performed */
  lastCheckTimestamp: number;
  /** Seq of most recent docChangeLog event at time of check — used for amber detection */
  docChangeLogSeqAtCheck: number;
}

// ── DQAF v2 — Document Quality Assessment Framework types ──

export type DQAFPass1CheckId = 'P1-01' | 'P1-02' | 'P1-03' | 'P1-04' | 'P1-05' | 'P1-06';
export type DQAFPass2CheckId = 'P2-02' | 'P2-03' | 'P2-04' | 'P2-05' | 'P2-06';
export type DQAFCheckId = DQAFPass1CheckId | DQAFPass2CheckId;
export type DQAFScore = 0 | 1 | 2;
export type DQAFSeverity = 'critical' | 'moderate' | 'minor';
export type DQAFVerdict = 'ready' | 'conditional' | 'not_ready';
export type DQAFRelevanceInterpretation = 'primary_source' | 'supporting_source' | 'orphan_review_required';

/** Five-dimension profile used for engagement purpose and per-document characterisation */
export interface DQAFProfile {
  objective: string;
  audience: string;
  type: string;
  focus: string;
  tone: string;
}

/** Per-dimension alignment result comparing a document to the engagement purpose */
export interface DQAFRelevanceDimension {
  /** 1 = supporting (adjacent), 2 = direct (purpose-built) */
  alignmentScore: 1 | 2;
  alignmentLabel: 'direct' | 'supporting';
  /** Explanation of why this alignment score was assigned */
  note: string;
}

/** Per-dimension compatibility result for a document pair */
export interface DQAFCompatibilityDimension {
  /** 0 = incompatible, 1 = adjacent, 2 = aligned */
  score: DQAFScore;
  label: 'aligned' | 'adjacent' | 'incompatible';
  /** Required when score is 0 or 1. Null when score is 2. */
  note: string | null;
}

/** Individual check result (Pass 1 or Pass 2) */
export interface DQAFCheckResult {
  /** 0 = Fail, 1 = Caution, 2 = Pass */
  score: DQAFScore;
  /** Required when score is 0 or 1 — precise description with location references. Null when 2. */
  note: string | null;
}

/** Document metadata detected during assessment */
export interface DQAFDocumentMetadata {
  detectedTitle: string | null;
  detectedDate: string | null;
  detectedVersion: string | null;
  detectedSource: string | null;
}

/** Per-document assessment record */
export interface DQAFDocumentAssessment {
  documentId: string;
  documentLabel: string;
  metadata: DQAFDocumentMetadata;
  /** Five-dimension profile of this document based on observable content */
  documentProfile: DQAFProfile;
  /** Individual relevance score against the engagement purpose (0-100) */
  relevanceScoreA: number;
  /** Threshold interpretation of relevanceScoreA */
  relevanceInterpretation: DQAFRelevanceInterpretation;
  /** Per-dimension alignment scores against the engagement purpose */
  relevanceDimensionScores: {
    objective: DQAFRelevanceDimension;
    focus: DQAFRelevanceDimension;
    audience: DQAFRelevanceDimension;
    type: DQAFRelevanceDimension;
    tone: DQAFRelevanceDimension;
  };
  /** All six Pass 1 check scores */
  pass1Scores: Record<DQAFPass1CheckId, DQAFCheckResult>;
  /** Average of 6 Pass 1 scores normalised to 0-100 */
  documentReadinessScore: number;
  /** ready (90-100), conditional (70-89), not_ready (<70) */
  documentVerdict: DQAFVerdict;
}

/** Inter-document compatibility record for a single pair */
export interface DQAFCompatibilityRecord {
  /** The two document IDs being compared */
  documentPair: [string, string];
  /** Overall compatibility score (0-100) */
  compatibilityScoreB: number;
  /** Per-dimension compatibility scores */
  dimensionScores: {
    objective: DQAFCompatibilityDimension;
    focus: DQAFCompatibilityDimension;
    audience: DQAFCompatibilityDimension;
    type: DQAFCompatibilityDimension;
    tone: DQAFCompatibilityDimension;
  };
}

/** Cross-document finding from Pass 2 */
export interface DQAFCrossDocFinding {
  /** P2-01 is retired — relevance handled by Stage 1 */
  checkId: DQAFPass2CheckId;
  /** Scope determines which group this finding renders in on the Conflicts panel */
  scope?: 'between_documents' | 'whole_set';
  severity: DQAFSeverity;
  /** Precise description including location references */
  description: string;
  /** Document IDs involved in this finding */
  documentsInvolved: string[];
  /** What will happen to output if this issue is not addressed */
  productionImpact: string;
}

/** P1 failure that has cross-document consequences — rendered in Conflicts panel Group C */
export interface DQAFPerDocumentFlag {
  checkId: DQAFPass1CheckId;
  documentId: string;
  scope: 'this_document';
  severity: DQAFSeverity;
  description: string;
  /** What happens to combined output if this P1 issue is not addressed */
  crossDocumentConsequence: string;
}

/** Set-level KPIs computed from all checks */
export interface DQAFKPIs {
  /** Average of all individual relevance scores (Score A) */
  documentRelevanceRate: number;
  /** % of docs scoring 2 on avg of P1-02, P1-03, P1-04 */
  internalIntegrityRate: number;
  /** % of P2-02, P2-03, P2-04 checks with no findings */
  crossDocumentConsistencyScore: number;
  /** % of docs scoring 2 on avg of P1-05 + P2-05 */
  versionConfidenceRate: number;
  /** % of docs scoring 2 on P1-06 */
  structuralCoherenceRate: number;
  /** Weighted average: integrity 30% + consistency 30% + relevance 20% + version 10% + structure 10% */
  overallSetReadinessScore: number;
}

/** Summary of flagged issues by severity */
export interface DQAFFlagsSummary {
  critical: number;
  moderate: number;
  minor: number;
  total: number;
}

/** Mandatory notice when critical flags exist — copy-ready for the producer */
export interface DQAFProductionNotice {
  summary: string;
  conflictsDescribed: string;
  productionConsequence: string;
  /** Ready-to-use disclosure statement the producer can include in output */
  suggestedDisclosure: string;
}

/** Record of a document that could not be retrieved */
export interface DQAFRetrievalFailure {
  documentReference: string;
  reason: string;
  assessmentImpact: string;
}

/** Action-oriented sign-off record for the producer */
export interface DQAFDocumentRegister {
  documentId: string;
  documentLabel: string;
  detectedVersion: string | null;
  detectedDate: string | null;
  relevanceScoreA: number;
  relevanceInterpretation: DQAFRelevanceInterpretation;
  documentReadinessScore: number;
  documentVerdict: DQAFVerdict;
  /** Plain, specific, actionable instruction for the producer */
  requiredAction: string;
}

/** Complete DQAF assessment report */
export interface DQAFReport {
  /** Unique assessment ID */
  assessmentId: string;
  /** ISO 8601 timestamp of when assessment was completed */
  assessedAt: string;
  /** The engagement purpose statement as provided by the user */
  engagementPurposeStatement: string;
  /** Five-dimension profile derived from the engagement purpose */
  engagementPurposeProfile: DQAFProfile;
  /** Total documents submitted */
  documentCountSubmitted: number;
  /** Total documents successfully retrieved and assessed */
  documentCountRetrieved: number;
  /** Present only when documents failed to retrieve */
  retrievalFailures?: DQAFRetrievalFailure[];
  /** One record per successfully retrieved document */
  documents: DQAFDocumentAssessment[];
  /** One record per document pair — N*(N-1)/2 records */
  interDocumentCompatibility: DQAFCompatibilityRecord[];
  /** Cross-document findings from Pass 2 */
  crossDocumentFindings: DQAFCrossDocFinding[];
  /** P1 failures with cross-document consequences — rendered in Conflicts panel Group C */
  perDocumentFlags?: DQAFPerDocumentFlag[];
  /** Set-level KPIs */
  kpis: DQAFKPIs;
  /** Summary of flagged issues by severity */
  flagsSummary: DQAFFlagsSummary;
  /** Overall set verdict */
  overallVerdict: DQAFVerdict;
  /** Plain-language explanation of what drove the verdict */
  verdictRationale: string;
  /** One row per document — action-oriented sign-off record */
  documentRegister: DQAFDocumentRegister[];
  /** Present only when at least one critical flag exists */
  mandatoryProductionNotice?: DQAFProductionNotice;
  // ── Internal app fields (not part of DQAF output schema) ──
  /** When this assessment was stored locally */
  lastCheckTimestamp: number;
  /** Seq of most recent docChangeLog event at time of check — for stale detection */
  docChangeLogSeqAtCheck: number;
  /** Legacy compat for FootnoteBar/PanelTabBar: ready→green, conditional→amber, not_ready→red */
  status: 'green' | 'amber' | 'red';
}

// ── Nugget types ──

export type NuggetType = 'insights';

export interface Nugget {
  id: string;
  name: string;
  type: NuggetType;
  documents: UploadedFile[];
  cards: CardItem[];
  messages?: ChatMessage[];
  lastDocHash?: string; // hash of active documents at time of last API call
  /** Ordered log of document mutations for change notification (capped at 20 entries) */
  docChangeLog?: DocChangeEvent[];
  /** Seq of the last docChangeLog event synced to the chat agent */
  lastDocChangeSyncSeq?: number;
  /** Persistent audit counters for the Sources Log */
  sourcesLogStats?: SourcesLogStats;
  /** Checkpoint entries shown in the Sources Log modal (capped at 20) */
  sourcesLog?: SourcesLogEntry[];
  /** AI-generated domain context for expert priming and image generation. User-editable. */
  domain?: string;
  /** True when document changes have occurred since the domain was last reviewed */
  domainReviewNeeded?: boolean;
  /** True when document changes have occurred since the briefing was last reviewed */
  briefReviewNeeded?: boolean;
  /** Per-nugget styling preferences for the generation toolbar. Persisted to IndexedDB. */
  stylingOptions?: StylingOptions;
  /** @deprecated Use dqafReport instead */
  qualityReport?: QualityReport;
  /** DQAF v2 assessment report — full 3-stage quality assessment */
  dqafReport?: DQAFReport;
  /** Engagement purpose statement for DQAF assessment — what the document set is meant to produce */
  engagementPurpose?: string;
  /** Persisted briefing (5-field descriptive brief) — used by Auto-Deck and DQAF */
  briefing?: AutoDeckBriefing;
  /** Persisted AI-generated briefing suggestions (dropdown options for each field) */
  briefingSuggestions?: BriefingSuggestions;
  /** ISO timestamp of when this nugget was last navigated away from (for Files API cleanup). */
  lastClosedAt?: string;
  createdAt: number;
  lastModifiedAt: number;
}

// ── Project types ──

export interface Project {
  id: string;
  name: string;
  description?: string;
  nuggetIds: string[];
  isCollapsed?: boolean;
  createdAt: number;
  lastModifiedAt: number;
}

// ─────────────────────────────────────────────────────────────────
// Auto-Deck Types
// ─────────────────────────────────────────────────────────────────

export interface AutoDeckBriefing {
  audience: string; // max 100 chars — who will view this
  type: string; // max 80 chars — presentation type (educational, pitch, etc.)
  objective: string; // max 150 chars — what the audience should take away
  tone?: string; // max 80 chars — how it should sound (optional)
  focus?: string; // max 120 chars — what to prioritize (optional)
  minCards?: number; // optional minimum card count constraint
  maxCards?: number; // optional maximum card count constraint
  includeCover?: boolean; // add a cover/title card
  includeClosing?: boolean; // add a closing takeaway/conclusion card
}

export type AutoDeckLod = 'executive' | 'standard' | 'detailed';

/** The 5 briefing field names. */
export type BriefingFieldName = 'objective' | 'audience' | 'type' | 'focus' | 'tone';

/** A single dropdown option for an AI-suggested briefing field. */
export interface BriefingSuggestionOption {
  label: string; // 1-2 word shorthand for dropdown
  text: string;  // full sentence that auto-fills the textarea
}

/** AI-generated suggestions for all 5 briefing fields. */
export type BriefingSuggestions = Record<BriefingFieldName, BriefingSuggestionOption[]>;

// ── SmartDeck types ──

export type SmartDeckStatus = 'configuring' | 'generating' | 'reviewing' | 'accepting' | 'complete' | 'error';

export interface SmartDeckSession {
  id: string;
  nuggetId: string;
  lod: AutoDeckLod;
  domain?: string;
  status: SmartDeckStatus;
  generatedCards: { number: number; title: string; content: string; wordCount: number }[];
  includeCover: boolean;
  includeClosing: boolean;
  error: string | null;
  createdAt: number;
}

// ── Persistence types ──

export interface InitialPersistedState {
  nuggets: Nugget[];
  projects: Project[];
  selectedNuggetId: string | null;
  selectedDocumentId?: string | null;
  selectedProjectId?: string | null;
  activeCardId: string | null;
  /** Which project is "opened" in the workspace (null = show landing page). */
  openProjectId?: string | null;
  workflowMode: WorkflowMode;
  // Token usage totals (persisted across refreshes)
  tokenUsageTotals?: Record<string, number>;
  // User-created custom styles (global, not per-nugget)
  customStyles?: CustomStyle[];
}
