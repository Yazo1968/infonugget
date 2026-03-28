import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { GoogleGenAI } from "npm:@google/genai";

// ── Env ──
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY")!;
const GEMINI_API_KEY_FALLBACK = Deno.env.get("GEMINI_API_KEY_FALLBACK") || "";

// ── Defaults ──
const DEFAULT_MAX_TOKENS_PER_CHUNK = 512;
const DEFAULT_MAX_OVERLAP_TOKENS = 50;
const DEFAULT_POLL_INTERVAL_MS = 3000;
const DEFAULT_POLL_TIMEOUT_MS = 120_000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonRes(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errRes(msg: string, status = 500) {
  return jsonRes({ error: msg }, status);
}

// ── Auth helper ──
async function verifyUser(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;
  const anonKey = req.headers.get("apikey") || Deno.env.get("SUPABASE_ANON_KEY");
  if (!anonKey) return null;
  const supabase = createClient(SUPABASE_URL, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  return user;
}

// ── Gemini client with key rotation ──
function getGeminiClients(): GoogleGenAI[] {
  const keys = [GEMINI_API_KEY, GEMINI_API_KEY_FALLBACK].filter(Boolean);
  return keys.map(key => new GoogleGenAI({ apiKey: key }));
}

async function withKeyRotation<T>(fn: (ai: GoogleGenAI) => Promise<T>): Promise<T> {
  const clients = getGeminiClients();
  let lastError: Error | null = null;
  for (const ai of clients) {
    try {
      return await fn(ai);
    } catch (err) {
      lastError = err as Error;
      const msg = (err as Error).message || "";
      if (msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED") || msg.includes("quota")) continue;
      throw err;
    }
  }
  throw lastError || new Error("All Gemini API keys exhausted");
}

// ── Poll an async operation until done ──
async function pollOperation(
  ai: GoogleGenAI,
  operation: any,
  timeoutMs: number = DEFAULT_POLL_TIMEOUT_MS,
  intervalMs: number = DEFAULT_POLL_INTERVAL_MS,
): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  let op = operation;
  while (!op.done) {
    if (Date.now() > deadline) {
      throw new Error(`Operation timed out after ${timeoutMs / 1000}s`);
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
    op = await ai.operations.get(op);
  }
  return op;
}

// ── Base64 to Blob ──
function base64ToBlob(base64: string, mimeType: string): Blob {
  const binaryStr = atob(base64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

// ── Action handlers ──

interface CreateStoreParams {
  nuggetId: string;
  displayName?: string;
}

async function handleCreateStore(params: CreateStoreParams) {
  const { nuggetId, displayName } = params;
  if (!nuggetId) throw new Error("nuggetId is required");

  const storeName = displayName || `nugget-${nuggetId}`;

  return await withKeyRotation(async (ai) => {
    const store = await ai.fileSearchStores.create({
      config: { displayName: storeName },
    });
    return {
      success: true,
      storeName: store.name,
      displayName: storeName,
    };
  });
}

interface DeleteStoreParams {
  storeName: string;
}

async function handleDeleteStore(params: DeleteStoreParams) {
  const { storeName } = params;
  if (!storeName) throw new Error("storeName is required");

  return await withKeyRotation(async (ai) => {
    await ai.fileSearchStores.delete({
      name: storeName,
      config: { force: true },
    });
    return { success: true };
  });
}

interface UploadDocumentParams {
  storeName: string;
  fileBase64: string;
  fileName: string;
  mimeType: string;
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
}

async function handleUploadDocument(params: UploadDocumentParams) {
  const { storeName, fileBase64, fileName, mimeType, metadata, chunkingConfig, pollTimeoutMs } = params;
  if (!storeName) throw new Error("storeName is required");
  if (!fileBase64) throw new Error("fileBase64 is required");
  if (!fileName) throw new Error("fileName is required");

  const maxTokens = chunkingConfig?.maxTokensPerChunk ?? DEFAULT_MAX_TOKENS_PER_CHUNK;
  const maxOverlap = chunkingConfig?.maxOverlapTokens ?? DEFAULT_MAX_OVERLAP_TOKENS;
  const timeout = pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;

  const blob = base64ToBlob(fileBase64, mimeType || "application/octet-stream");

  // Build custom metadata array for Gemini File Search
  const customMetadata: Array<{ key: string; stringValue: string }> = [];
  if (metadata?.nugget_id) customMetadata.push({ key: "nugget_id", stringValue: metadata.nugget_id });
  if (metadata?.document_name) customMetadata.push({ key: "document_name", stringValue: metadata.document_name });
  if (metadata?.source_type) customMetadata.push({ key: "source_type", stringValue: metadata.source_type });

  // Use a single client for both upload and polling (same key must be used)
  const clients = getGeminiClients();
  let lastError: Error | null = null;

  for (const ai of clients) {
    try {
      const uploadConfig: Record<string, unknown> = {
        displayName: fileName,
        chunkingConfig: {
          whiteSpaceConfig: {
            maxTokensPerChunk: maxTokens,
            maxOverlapTokens: maxOverlap,
          },
        },
      };
      if (customMetadata.length > 0) {
        uploadConfig.customMetadata = customMetadata;
      }

      let operation = await ai.fileSearchStores.uploadToFileSearchStore({
        fileSearchStoreName: storeName,
        file: blob,
        config: uploadConfig as any,
      });

      // Poll until done
      operation = await pollOperation(ai, operation, timeout);

      return {
        success: true,
        documentName: operation.result?.name || null,
        metadata: metadata || null,
      };
    } catch (err) {
      lastError = err as Error;
      const msg = (err as Error).message || "";
      if (msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED") || msg.includes("quota")) continue;
      throw err;
    }
  }
  throw lastError || new Error("All Gemini API keys exhausted");
}

interface RemoveDocumentParams {
  storeName: string;
  documentName: string;
}

async function handleRemoveDocument(params: RemoveDocumentParams) {
  const { storeName, documentName } = params;
  if (!storeName) throw new Error("storeName is required");
  if (!documentName) throw new Error("documentName is required");

  // documentName should be the full resource name: fileSearchStores/{store}/documents/{doc}
  // If only the doc ID is provided, construct the full path
  const fullName = documentName.includes("/")
    ? documentName
    : `${storeName}/documents/${documentName}`;

  return await withKeyRotation(async (ai) => {
    await ai.fileSearchStores.documents.delete({ name: fullName });
    return { success: true };
  });
}

interface ListDocumentsParams {
  storeName: string;
}

async function handleListDocuments(params: ListDocumentsParams) {
  const { storeName } = params;
  if (!storeName) throw new Error("storeName is required");

  return await withKeyRotation(async (ai) => {
    const documents = await ai.fileSearchStores.documents.list({ parent: storeName });
    const docs: Array<{ name: string; displayName?: string }> = [];
    for await (const doc of documents) {
      docs.push({
        name: (doc as any).name,
        displayName: (doc as any).displayName,
      });
    }
    return { success: true, documents: docs };
  });
}

// ── Main handler ──
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Auth check
    const user = await verifyUser(req);
    if (!user) return errRes("Unauthorized", 401);

    const body = await req.json();
    const { action, ...params } = body;

    if (!action) return errRes("Missing action field", 400);

    switch (action) {
      case "create-store":
        return jsonRes(await handleCreateStore(params as CreateStoreParams));
      case "delete-store":
        return jsonRes(await handleDeleteStore(params as DeleteStoreParams));
      case "upload-document":
        return jsonRes(await handleUploadDocument(params as UploadDocumentParams));
      case "remove-document":
        return jsonRes(await handleRemoveDocument(params as RemoveDocumentParams));
      case "list-documents":
        return jsonRes(await handleListDocuments(params as ListDocumentsParams));
      default:
        return errRes(`Unknown action: ${action}`, 400);
    }
  } catch (err) {
    const msg = (err as Error).message || "Internal server error";
    console.error("[manage-stores] Error:", msg);
    return errRes(msg, 500);
  }
});
