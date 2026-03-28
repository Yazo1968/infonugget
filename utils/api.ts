/**
 * Client API wrappers for the new backend Edge Functions.
 * These replace direct AI calls from the browser with single
 * API calls to server-side functions that handle the full pipeline.
 */

import { supabase } from './supabase';
import { createLogger } from './logger';
import { StylingOptions, DetailLevel, UploadedFile, QualityReport, DQAFReport, BookmarkNode, AlbumImage, RetrievedChunk } from '../types';

const log = createLogger('API');

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

const GENERATE_CARD_URL = `${SUPABASE_URL}/functions/v1/generate-card`;
const MANAGE_IMAGES_URL = `${SUPABASE_URL}/functions/v1/manage-images`;
const CHAT_MESSAGE_URL = `${SUPABASE_URL}/functions/v1/chat-message`;
const DOCUMENT_QUALITY_URL = `${SUPABASE_URL}/functions/v1/document-quality`;
const GENERATE_GRAPHICS_URL = `${SUPABASE_URL}/functions/v1/generate-graphics`;

/** Get a fresh auth token for Edge Function calls. */
async function getAuthToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.access_token) {
    try {
      const payload = JSON.parse(atob(session.access_token.split('.')[1]));
      const nowSec = Math.floor(Date.now() / 1000);
      if (payload.exp && payload.exp > nowSec + 30) {
        return session.access_token;
      }
    } catch {
      return session.access_token;
    }
  }
  const { data: { session: refreshed }, error } = await supabase.auth.refreshSession();
  if (error || !refreshed?.access_token) {
    throw new Error('Not authenticated — session refresh failed');
  }
  return refreshed.access_token;
}

function authHeaders(token: string) {
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'apikey': SUPABASE_ANON_KEY,
  };
}

// ─────────────────────────────────────────────────────────────────
// generate-card API
// ─────────────────────────────────────────────────────────────────

export interface GenerateCardRequest {
  nuggetId: string;
  cardId: string;
  cardTitle: string;
  detailLevel: DetailLevel;
  settings: StylingOptions;
  domain?: string;
  existingSynthesis?: string;
  documents?: Array<{
    fileId?: string;
    name: string;
    sourceType?: string;
    structure?: Array<{ level: number; text: string; page?: number }>;
    content?: string;
  }>;
  referenceImage?: { base64: string; mimeType: string } | null;
  skipSynthesis?: boolean;
  layoutDirectives?: string;
  /** Rendered content screenshot (replaces directives + text content in prompt) */
  screenshotBase64?: string;
  screenshotMimeType?: string;
  /** Pre-retrieved chunks from Gemini File Search (replaces Files API document blocks when provided) */
  retrievedChunks?: RetrievedChunk[];
}

export interface GenerateCardResponse {
  success: boolean;
  imageId: string;
  imageUrl: string;
  storagePath: string;
  synthesisContent: string;
  imagePrompt?: string;
  geminiUsage: unknown;
}

/**
 * Call the generate-card Edge Function.
 * Runs the full 3-phase pipeline server-side:
 *   Phase 1: Content Synthesis (Claude)
 *   Phase 2: Layout Planning (Claude)
 *   Phase 3: Image Generation (Gemini)
 *   Phase 4: Storage + DB persistence
 *
 * Returns a signed URL for the generated image.
 */
export async function generateCardApi(
  request: GenerateCardRequest,
  signal?: AbortSignal,
): Promise<GenerateCardResponse> {
  const token = await getAuthToken();
  const res = await fetch(GENERATE_CARD_URL, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(request),
    signal,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(body.error || `generate-card failed: ${res.status}`);
  }

  return res.json();
}

// ─────────────────────────────────────────────────────────────────
// manage-images API
// ─────────────────────────────────────────────────────────────────

export interface ManageImagesRequest {
  action: 'set_active' | 'delete_image' | 'delete_album' | 'delete_card_albums' | 'delete_all_albums' | 'get_album' | 'upload_image';
  nuggetId: string;
  cardId?: string;
  detailLevel?: string;
  imageId?: string;
  // upload_image fields
  imageBase64?: string;
  imageMimeType?: string;
  label?: string;
}

export interface ManageImagesResponse {
  success?: boolean;
  album?: AlbumImage[];
  activeImageUrl?: string | null;
  deletedCount?: number;
}

/**
 * Call the manage-images Edge Function.
 * Handles image CRUD operations server-side.
 */
export async function manageImagesApi(
  request: ManageImagesRequest,
  signal?: AbortSignal,
): Promise<ManageImagesResponse> {
  const token = await getAuthToken();
  const res = await fetch(MANAGE_IMAGES_URL, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(request),
    signal,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(body.error || `manage-images failed: ${res.status}`);
  }

  return res.json();
}

// ─────────────────────────────────────────────────────────────────
// chat-message API
// ─────────────────────────────────────────────────────────────────

export interface ChatMessageDocument {
  name: string;
  content?: string;
  fileId?: string;
  sourceType?: string;
  bookmarks?: BookmarkNode[];
}

export interface ChatMessageHistoryEntry {
  role: 'user' | 'assistant' | 'system';
  content: string;
  isCardContent?: boolean;
}

export interface ChatMessageRequest {
  action: 'send_message' | 'initiate_chat' | 'compact' | 'docviz_analyse';
  userText?: string;
  isCardRequest?: boolean;
  detailLevel?: DetailLevel;
  conversationHistory?: ChatMessageHistoryEntry[];
  domain?: string;
  qualityReport?: QualityReport | DQAFReport;
  documents: ChatMessageDocument[];
  /** Custom system prompt (used by docviz_analyse) */
  systemPrompt?: string;
  /** Max tokens override */
  maxTokens?: number;
  /** Extended thinking config */
  thinking?: { budgetTokens: number };
  /** Pre-retrieved chunks from Gemini File Search (replaces Files API document blocks when provided) */
  retrievedChunks?: RetrievedChunk[];
  /** Gemini File Search Store name — EF retrieves chunks internally when provided */
  geminiStoreName?: string;
  /** JSON schema for structured output from Gemini (used with File Search) */
  responseJsonSchema?: Record<string, unknown>;
}

export interface ChatMessageResponse {
  success: boolean;
  responseText: string;
  budgetExceeded?: boolean;
  messagesPruned?: number;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  };
}

/**
 * Call the chat-message Edge Function.
 * Handles both regular chat and card content generation via Claude.
 * All prompt building, token budgeting, and message pruning happen server-side.
 */
export async function chatMessageApi(
  request: ChatMessageRequest,
  signal?: AbortSignal,
): Promise<ChatMessageResponse> {
  const token = await getAuthToken();
  const res = await fetch(CHAT_MESSAGE_URL, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(request),
    signal,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(body.error || `chat-message failed: ${res.status}`);
  }

  return res.json();
}

// ─────────────────────────────────────────────────────────────────
// document-quality API (DQAF v2)
// ─────────────────────────────────────────────────────────────────

export interface DocumentQualityDocument {
  id: string;
  name: string;
  fileId?: string;
  content?: string;
  sourceType?: string;
  bookmarks?: Array<{ level: number; text: string; page?: number; wordCount?: number }>;
}

export interface DocumentQualityRequest {
  documents: DocumentQualityDocument[];
  engagementPurpose: string;
  /** Optional nugget ID — used server-side to update last_api_call_at for Files API cleanup. */
  nuggetId?: string;
  /** Stage selector: 'call1' for per-doc only, 'call2' for cross-doc + report, omit for legacy full pipeline. */
  stage?: 'call1' | 'call2';
  /** Call 1 results — required when stage is 'call2'. */
  call1Data?: Record<string, unknown>;
  /** Pre-retrieved chunks from Gemini File Search (replaces Files API document blocks when provided) */
  retrievedChunks?: RetrievedChunk[];
}

interface DQAFUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/** Response from stage 'call1' — returns intermediate per-document analysis. */
export interface DocumentQualityCall1Response {
  success: boolean;
  stage: 'call1';
  call1Data: Record<string, unknown>;
  usage: DQAFUsage;
}

/** Response from stage 'call2' or legacy full pipeline — returns the final report. */
export interface DocumentQualityReportResponse {
  success: boolean;
  report: DQAFReport;
  usage: DQAFUsage;
}

export type DocumentQualityResponse = DocumentQualityCall1Response | DocumentQualityReportResponse;

/**
 * Call the document-quality Edge Function.
 *
 * Supports staged execution to avoid free-plan 150s Edge Function timeout:
 * - stage 'call1': runs per-document analysis only → returns call1Data
 * - stage 'call2': runs cross-doc analysis + report assembly → returns report
 * - no stage: legacy full pipeline (may timeout on free plan with multiple docs)
 */
export async function documentQualityApi(
  request: DocumentQualityRequest,
  signal?: AbortSignal,
): Promise<DocumentQualityResponse> {
  const token = await getAuthToken();
  const res = await fetch(DOCUMENT_QUALITY_URL, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(request),
    signal,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(body.error || `document-quality failed: ${res.status}`);
  }

  return res.json();
}

// ─────────────────────────────────────────────────────────────────
// generate-graphics API (DocViz)
// ─────────────────────────────────────────────────────────────────

export interface GenerateGraphicsRequest {
  nuggetId: string;
  proposalIndex: number;
  prompt: string;
  screenshotBase64: string;
  aspectRatio: string;
  resolution?: string;
}

export interface GenerateGraphicsResponse {
  success: boolean;
  imageUrl: string;
  storagePath: string;
}

export async function generateGraphicsApi(
  request: GenerateGraphicsRequest,
  signal?: AbortSignal,
): Promise<GenerateGraphicsResponse> {
  const token = await getAuthToken();
  const res = await fetch(GENERATE_GRAPHICS_URL, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(request),
    signal,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(body.error || `generate-graphics failed: ${res.status}`);
  }

  return res.json();
}

// ─────────────────────────────────────────────────────────────────
// manage-stores API (Gemini File Search Store lifecycle)
// ─────────────────────────────────────────────────────────────────

const MANAGE_STORES_URL = `${SUPABASE_URL}/functions/v1/manage-stores`;

export type ManageStoresAction = 'create-store' | 'delete-store' | 'upload-document' | 'remove-document' | 'list-documents';

export interface ManageStoresRequest {
  action: ManageStoresAction;
  nuggetId?: string;
  displayName?: string;
  storeName?: string;
  fileBase64?: string;
  fileName?: string;
  mimeType?: string;
  metadata?: {
    nugget_id?: string;
    document_name?: string;
    source_type?: string;
  };
  chunkingConfig?: {
    maxTokensPerChunk?: number;
    maxOverlapTokens?: number;
  };
  pollTimeoutMs?: number;
  documentName?: string;
}

export interface CreateStoreResponse {
  success: boolean;
  storeName: string;
  displayName: string;
}

export interface UploadDocumentResponse {
  success: boolean;
  documentName: string | null;
  metadata: Record<string, string> | null;
}

export interface ListDocumentsResponse {
  success: boolean;
  documents: Array<{ name: string; displayName?: string }>;
}

export interface ManageStoresGenericResponse {
  success: boolean;
  [key: string]: unknown;
}

async function manageStoresApi<T = ManageStoresGenericResponse>(
  request: ManageStoresRequest,
  signal?: AbortSignal,
): Promise<T> {
  const token = await getAuthToken();
  const res = await fetch(MANAGE_STORES_URL, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(request),
    signal,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(body.error || `manage-stores failed: ${res.status}`);
  }

  return res.json();
}

/** Create a Gemini File Search Store for a nugget. */
export function createStoreApi(
  nuggetId: string,
  displayName?: string,
  signal?: AbortSignal,
): Promise<CreateStoreResponse> {
  return manageStoresApi<CreateStoreResponse>(
    { action: 'create-store', nuggetId, displayName },
    signal,
  );
}

/** Delete a Gemini File Search Store (force-deletes all documents). */
export function deleteStoreApi(
  storeName: string,
  signal?: AbortSignal,
): Promise<ManageStoresGenericResponse> {
  return manageStoresApi(
    { action: 'delete-store', storeName },
    signal,
  );
}

/** Upload a document to a Gemini File Search Store with metadata tagging. */
export function uploadDocumentToStoreApi(
  storeName: string,
  fileBase64: string,
  fileName: string,
  mimeType: string,
  metadata?: { nugget_id?: string; document_name?: string; source_type?: string },
  chunkingConfig?: { maxTokensPerChunk?: number; maxOverlapTokens?: number },
  pollTimeoutMs?: number,
  signal?: AbortSignal,
): Promise<UploadDocumentResponse> {
  return manageStoresApi<UploadDocumentResponse>(
    { action: 'upload-document', storeName, fileBase64, fileName, mimeType, metadata, chunkingConfig, pollTimeoutMs },
    signal,
  );
}

/** Remove a document from a Gemini File Search Store. */
export function removeDocumentFromStoreApi(
  storeName: string,
  documentName: string,
  signal?: AbortSignal,
): Promise<ManageStoresGenericResponse> {
  return manageStoresApi(
    { action: 'remove-document', storeName, documentName },
    signal,
  );
}

/** List all documents in a Gemini File Search Store. */
export function listStoreDocumentsApi(
  storeName: string,
  signal?: AbortSignal,
): Promise<ListDocumentsResponse> {
  return manageStoresApi<ListDocumentsResponse>(
    { action: 'list-documents', storeName },
    signal,
  );
}

// ─────────────────────────────────────────────────────────────────
// retrieve-chunks API (Gemini File Search retrieval)
// ─────────────────────────────────────────────────────────────────

const RETRIEVE_CHUNKS_URL = `${SUPABASE_URL}/functions/v1/retrieve-chunks`;

export interface RetrieveChunksRequest {
  storeName: string;
  queryText: string;
  metadataFilter?: string;
  maxChunks?: number;
}

export interface RetrieveChunksResponse {
  chunks: RetrievedChunk[];
  responseText?: string;
}

/**
 * Call the retrieve-chunks Edge Function.
 * Queries a Gemini File Search Store and returns grounded chunks.
 */
export async function retrieveChunksApi(
  request: RetrieveChunksRequest,
  signal?: AbortSignal,
): Promise<RetrieveChunksResponse> {
  const token = await getAuthToken();
  const res = await fetch(RETRIEVE_CHUNKS_URL, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(request),
    signal,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(body.error || `retrieve-chunks failed: ${res.status}`);
  }

  return res.json();
}
