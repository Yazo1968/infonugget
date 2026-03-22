import { GEMINI_IMAGE_MODEL } from './constants';
import { withGeminiRetry, PRO_IMAGE_CONFIG, callGeminiProxy } from './ai';
import { buildModificationPrompt } from './prompts/imageGeneration';

interface ModificationRequest {
  originalImageUrl: string; // data URL or signed HTTP URL of the original image
  redlineDataUrl: string; // data URL of the redline overlay (empty string if no spatial annotations)
  instructions: string; // synthesized numbered instruction list
  cardText: string | null; // card title context for the prompt
  aspectRatio?: string; // e.g. '16:9', '4:3', '1:1', '3:4'
  resolution?: string; // e.g. '1K', '2K', '4K'
}

interface ModificationResult {
  newImageUrl: string; // data URL of the modified image
}

// TODO: Implement multi-turn chat for iterative image editing.
// Gemini docs say multi-turn chat is "the recommended way to iterate on images."
// The @google/genai SDK's ai.chats.create() handles thought signature circulation
// automatically. Implementation would require:
// 1. Maintaining a chat session per card+level (store in Card type)
// 2. Initial card generation becomes the first turn
// 3. Each annotation modification becomes a follow-up turn (no need to re-send full image)
// 4. Clear chat session when generating a new card from scratch
// 5. Handle session expiration gracefully
// This is a significant architectural change touching useSynthesis, modificationEngine,
// types.ts, and the annotation workflow. Should be a separate epic.

/**
 * Execute an image modification by sending a multimodal request to Gemini.
 *
 * The request includes:
 * 1. System instruction (style fidelity + literal interpretation) + aggregated instructions
 * 2. Original image (inlineData)
 * 3. Redline map (inlineData)
 *
 * Returns the modified image as a data URL.
 */
export async function executeModification(
  request: ModificationRequest,
  onUsage?: (entry: { provider: 'gemini'; model: string; inputTokens: number; outputTokens: number }) => void,
): Promise<ModificationResult> {
  const { originalImageUrl, redlineDataUrl, instructions, cardText, aspectRatio, resolution } = request;

  // Resolve image data — handles both data URLs and HTTP(S) signed URLs
  const rawImage = await resolveImageData(originalImageUrl);
  const hasRedline = !!redlineDataUrl;

  // Compress images to avoid WORKER_LIMIT 546 on the gemini-proxy EF
  const { base64: originalBase64, mimeType: originalMime } = await compressForProxy(
    rawImage.base64, rawImage.mimeType, PROXY_MAX_DIM,
  );

  const systemPrompt = buildModificationPrompt(instructions, cardText, hasRedline);

  // Build imageConfig to preserve resolution & aspect ratio from original generation
  const imageConfig: Record<string, string> = {};
  if (aspectRatio) imageConfig.aspectRatio = aspectRatio;
  if (resolution) imageConfig.imageSize = resolution;

  // Build parts: always include prompt + original image, conditionally include redline
  const parts: any[] = [
    { text: systemPrompt },
    {
      inlineData: {
        mimeType: originalMime,
        data: originalBase64,
      },
    },
  ];

  if (hasRedline) {
    const rawRedline = { base64: extractBase64(redlineDataUrl), mimeType: extractMime(redlineDataUrl) };
    const { base64: redlineBase64, mimeType: redlineMime } = await compressForProxy(
      rawRedline.base64, rawRedline.mimeType, PROXY_MAX_DIM, true,
    );
    parts.push({
      inlineData: {
        mimeType: redlineMime,
        data: redlineBase64,
      },
    });
  }

  const response = await withGeminiRetry(async () => {
    return await callGeminiProxy(
      GEMINI_IMAGE_MODEL,
      [{ parts }],
      {
        ...PRO_IMAGE_CONFIG,
        ...(Object.keys(imageConfig).length > 0 && { imageConfig }),
      },
    );
  });

  // Record Gemini usage
  if (response.usageMetadata) {
    onUsage?.({
      provider: 'gemini',
      model: GEMINI_IMAGE_MODEL,
      inputTokens: response.usageMetadata.promptTokenCount ?? 0,
      outputTokens: response.usageMetadata.candidatesTokenCount ?? 0,
    });
  }

  // Extract the modified image from the proxy response
  let newImageUrl = '';
  if (response.images && response.images.length > 0) {
    const img = response.images[0];
    newImageUrl = `data:${img.mimeType || 'image/png'};base64,${img.data}`;
  }

  if (!newImageUrl) {
    throw new Error(
      'AI did not return a modified image. The model may have returned text instead of an image. Please try again with clearer instructions.',
    );
  }

  return { newImageUrl };
}

// --- Helpers ---

/**
 * Compress an image to reduce payload size for the Edge Function proxy.
 * Prevents WORKER_LIMIT 546 errors caused by large base64 payloads
 * exceeding the Edge Function memory limit.
 *
 * - Opaque images (original card) → downscale + JPEG at 0.85 quality
 * - Transparent images (redline overlay) → downscale only, keep PNG
 */
async function compressForProxy(
  base64: string,
  mimeType: string,
  maxDim: number,
  preserveAlpha = false,
): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('Canvas 2d context unavailable')); return; }
      ctx.drawImage(img, 0, 0, width, height);
      if (preserveAlpha) {
        const dataUrl = canvas.toDataURL('image/png');
        resolve({ base64: dataUrl.split(',')[1], mimeType: 'image/png' });
      } else {
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        resolve({ base64: dataUrl.split(',')[1], mimeType: 'image/jpeg' });
      }
    };
    img.onerror = () => reject(new Error('Failed to load image for compression'));
    img.src = `data:${mimeType};base64,${base64}`;
  });
}

/** Max dimension for images sent through the gemini-proxy EF. */
const PROXY_MAX_DIM = 1280;

/**
 * Convert an image URL to { base64, mimeType }.
 * Handles both data URLs (data:image/png;base64,...) and HTTP(S) URLs
 * (e.g. signed Supabase Storage URLs) by fetching and converting.
 */
async function resolveImageData(url: string): Promise<{ base64: string; mimeType: string }> {
  // Data URL — extract directly
  if (url.startsWith('data:')) {
    return { base64: extractBase64(url), mimeType: extractMime(url) };
  }
  // HTTP(S) URL — fetch and convert to base64
  if (url.startsWith('http://') || url.startsWith('https://')) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
    const blob = await res.blob();
    const mimeType = blob.type || 'image/png';
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);
    return { base64, mimeType };
  }
  // Fallback — assume raw base64
  return { base64: url, mimeType: 'image/png' };
}

export function extractBase64(dataUrl: string): string {
  const commaIndex = dataUrl.indexOf(',');
  if (commaIndex === -1) return dataUrl;
  return dataUrl.substring(commaIndex + 1);
}

export function extractMime(dataUrl: string): string {
  const match = dataUrl.match(/^data:([^;]+);/);
  return match ? match[1] : 'image/png';
}
