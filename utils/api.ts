/**
 * Client API wrappers for the new backend Edge Functions.
 * These replace direct AI calls from the browser with single
 * API calls to server-side functions that handle the full pipeline.
 */

import { supabase } from './supabase';
import { createLogger } from './logger';
import { StylingOptions, DetailLevel, UploadedFile } from '../types';

const log = createLogger('API');

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

const GENERATE_CARD_URL = `${SUPABASE_URL}/functions/v1/generate-card`;
const MANAGE_IMAGES_URL = `${SUPABASE_URL}/functions/v1/manage-images`;

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
  subject?: string;
  existingSynthesis?: string;
  previousPlan?: string;
  documents?: Array<{
    fileId?: string;
    name: string;
    sourceType?: string;
    structure?: Array<{ level: number; text: string; page?: number }>;
    content?: string;
  }>;
  referenceImage?: { base64: string; mimeType: string } | null;
  skipSynthesis?: boolean;
}

export interface GenerateCardResponse {
  success: boolean;
  imageUrl: string;
  storagePath: string;
  synthesisContent: string;
  visualPlan: string;
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
  action: 'delete_active' | 'delete_versions' | 'delete_all' | 'restore_version' | 'get_history';
  nuggetId: string;
  cardId?: string;
  detailLevel: string;
  versionIndex?: number;
}

export interface ManageImagesResponse {
  success?: boolean;
  imageUrl?: string;
  currentUrl?: string | null;
  history?: Array<{ imageUrl: string; timestamp: number; label: string }>;
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
