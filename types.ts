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

export interface CustomStyle {
  id: string;
  name: string;
  palette: Palette;
  fonts: FontPair;
  identity: string; // visual identity description for generation prompts
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
  /** Per-level card image URLs */
  cardUrlMap?: Partial<Record<DetailLevel, string>>;
  /** Per-level card generation state */
  isGeneratingMap?: Partial<Record<DetailLevel, boolean>>;
  /** Per-level annotation/version history */
  imageHistoryMap?: Partial<Record<DetailLevel, ImageVersion[]>>;
  /** Per-level visual layout plan from the planner step */
  visualPlanMap?: Partial<Record<DetailLevel, string>>;
  /** Per-level snapshot of synthesis content used for card generation — used to detect content changes */
  lastGeneratedContentMap?: Partial<Record<DetailLevel, string>>;
  /** Per-level full visualizer prompt used for card generation */
  lastPromptMap?: Partial<Record<DetailLevel, string>>;
  /** Timestamp when this card was created */
  createdAt?: number;
  /** Timestamp when this card was last edited */
  lastEditedAt?: number;
  /** Names of documents that were active when this card was created */
  sourceDocuments?: string[];
  /** Links this card to the Auto-Deck session that created it */
  autoDeckSessionId?: string;
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
  /** Links this folder to the Auto-Deck session that created it */
  autoDeckSessionId?: string;
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
  imageHistory?: ImageVersion[];
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

export interface DocChangeEvent {
  type: DocChangeEventType;
  docId: string;
  docName: string;
  /** For rename events, the previous name */
  oldName?: string;
  timestamp: number;
}

// ── Document Quality Check types ──

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

export interface QualityReport {
  /** Current check status: green = clear, amber = needs recheck, red = issues found */
  status: 'green' | 'amber' | 'red';
  /** Groups of related documents by topic */
  clusters: TopicCluster[];
  /** Cross-document contradictions */
  conflicts: QualityConflict[];
  /** Whether any documents are unrelated to others */
  hasUnrelatedDocs: boolean;
  /** True if user dismissed warnings and chose to proceed */
  dismissed: boolean;
  /** When the last check was performed */
  lastCheckTimestamp: number;
  /** Index into docChangeLog at time of check — used for amber detection */
  docChangeLogIndexAtCheck: number;
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
  /** Ordered log of document mutations for change notification */
  docChangeLog?: DocChangeEvent[];
  /** Index into docChangeLog marking last sync to chat agent */
  lastDocChangeSyncIndex?: number;
  /** AI-generated topic sentence used for expert priming in prompts. User-editable. */
  subject?: string;
  /** Per-nugget styling preferences for the generation toolbar. Persisted to IndexedDB. */
  stylingOptions?: StylingOptions;
  /** Document quality check report — clusters, conflicts, warnings */
  qualityReport?: QualityReport;
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
  includeSectionTitles?: boolean; // add title cards for main sections
  includeClosing?: boolean; // add a closing takeaway/conclusion card
}

export type AutoDeckLod = 'executive' | 'standard' | 'detailed';

export type AutoDeckStatus =
  | 'configuring'
  | 'planning'
  | 'conflict'
  | 'reviewing'
  | 'revising'
  | 'finalizing'
  | 'producing'
  | 'complete'
  | 'error';

export interface PlannedCard {
  number: number;
  title: string;
  description: string;
  sources: {
    document: string;
    section?: string; // legacy — kept for backward compat
    heading?: string; // EXACT heading text from document
    fallbackDescription?: string; // when no clear heading, describe location
  }[];
  /** Target word count for this card (within the LOD range, assigned by planner). */
  wordTarget?: number;
  /** Verbatim quotes/figures from sources that MUST appear in card content. */
  keyDataPoints?: string[];
  /** Content writer instructions — either a legacy string or structured object. */
  guidance:
    | string
    | {
        emphasis: string;
        tone: string;
        exclude: string;
      };
  /** References to other cards this one relates to (e.g., "Builds on Card 2"). */
  crossReferences?: string | null;
}

export interface PlanQuestionOption {
  key: string; // e.g. "a", "b", "c"
  label: string; // Display text for the option
  producerInstruction: string; // Verbatim instruction injected into producer prompt
}

export interface PlanQuestion {
  id: string; // e.g. "q1", "q2"
  question: string; // The question text
  options: PlanQuestionOption[];
  recommendedKey: string; // Which option key the planner recommends
  context?: string; // Optional brief context for why this question matters
}

export interface ConflictItem {
  description: string;
  sourceA: { document: string; section: string };
  sourceB: { document: string; section: string };
  severity: 'high' | 'medium' | 'low';
}

export interface ParsedPlan {
  metadata: {
    category: string;
    lod: AutoDeckLod;
    sourceWordCount: number;
    cardCount: number;
    documentStrategy: 'dissolve' | 'preserve' | 'hybrid';
    documentRelationships: string;
  };
  cards: PlannedCard[];
  /** Planner-generated decision-point questions for user review. */
  questions?: PlanQuestion[];
}

export interface ReviewCardState {
  included: boolean;
}

export interface ReviewState {
  generalComment: string;
  cardStates: Record<number, ReviewCardState>;
  /** User's MCQ answers — maps questionId to selected option key. */
  questionAnswers: Record<string, string>;
  decision: 'pending' | 'approved' | 'revise';
}

export interface AutoDeckSession {
  id: string;
  nuggetId: string;
  briefing: AutoDeckBriefing;
  lod: AutoDeckLod;
  /** Ordered document IDs selected by user (preserved across revisions) */
  orderedDocIds: string[];
  status: AutoDeckStatus;
  parsedPlan: ParsedPlan | null;
  conflicts: ConflictItem[] | null;
  reviewState: ReviewState | null;
  producedCards: { number: number; title: string; content: string; wordCount: number }[];
  revisionCount: number;
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
