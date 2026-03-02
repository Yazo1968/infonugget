import { GEMINI_IMAGE_MODEL } from './constants';
import { withGeminiRetry, PRO_IMAGE_CONFIG, getGeminiAI } from './ai';
import { buildModificationPrompt, buildContentModificationPrompt } from './prompts/imageGeneration';

interface ModificationRequest {
  originalImageUrl: string; // data URL of the original image
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

  // Extract base64 data from data URLs
  const originalBase64 = extractBase64(originalImageUrl);
  const originalMime = extractMime(originalImageUrl);
  const hasRedline = !!redlineDataUrl;

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
    const redlineBase64 = extractBase64(redlineDataUrl);
    const redlineMime = extractMime(redlineDataUrl);
    parts.push({
      inlineData: {
        mimeType: redlineMime,
        data: redlineBase64,
      },
    });
  }

  const response = await withGeminiRetry(async () => {
    const ai = await getGeminiAI();
    return await ai.models.generateContent({
      model: GEMINI_IMAGE_MODEL,
      contents: [
        {
          parts,
        },
      ],
      config: {
        ...PRO_IMAGE_CONFIG,
        ...(Object.keys(imageConfig).length > 0 && { imageConfig }),
      },
    });
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

  // Extract the modified image from the response
  let newImageUrl = '';
  if (response.candidates && response.candidates[0]?.content?.parts) {
    for (const part of response.candidates[0].content.parts) {
      if (part.inlineData) {
        newImageUrl = `data:${part.inlineData.mimeType || 'image/png'};base64,${part.inlineData.data}`;
        break;
      }
    }
  }

  if (!newImageUrl) {
    throw new Error(
      'AI did not return a modified image. The model may have returned text instead of an image. Please try again with clearer instructions.',
    );
  }

  return { newImageUrl };
}

/**
 * Content-only regeneration: sends the original image as a style/layout reference
 * alongside updated text content. No redline map — the AI re-renders the infographic
 * with the new content while preserving the visual style of the reference image.
 */
interface ContentModificationRequest {
  originalImageUrl: string; // reference image for style continuity
  content: string; // the updated synthesis content
  cardText: string | null;
  style?: string;
  palette?: { background: string; primary: string; secondary: string; accent: string; text: string };
  aspectRatio?: string;
  resolution?: string;
}

export async function executeContentModification(
  request: ContentModificationRequest,
  onUsage?: (entry: { provider: 'gemini'; model: string; inputTokens: number; outputTokens: number }) => void,
): Promise<ModificationResult> {
  const { originalImageUrl, content, cardText, style, palette, aspectRatio, resolution } = request;

  const originalBase64 = extractBase64(originalImageUrl);
  const originalMime = extractMime(originalImageUrl);

  const systemPrompt = buildContentModificationPrompt(content, cardText, style, palette);

  const imageConfig: Record<string, string> = {};
  if (aspectRatio) imageConfig.aspectRatio = aspectRatio;
  if (resolution) imageConfig.imageSize = resolution;

  const response = await withGeminiRetry(async () => {
    const ai = await getGeminiAI();
    return await ai.models.generateContent({
      model: GEMINI_IMAGE_MODEL,
      contents: [
        {
          parts: [
            { text: systemPrompt },
            {
              inlineData: {
                mimeType: originalMime,
                data: originalBase64,
              },
            },
          ],
        },
      ],
      config: {
        ...PRO_IMAGE_CONFIG,
        ...(Object.keys(imageConfig).length > 0 && { imageConfig }),
      },
    });
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

  let newImageUrl = '';
  if (response.candidates && response.candidates[0]?.content?.parts) {
    for (const part of response.candidates[0].content.parts) {
      if (part.inlineData) {
        newImageUrl = `data:${part.inlineData.mimeType || 'image/png'};base64,${part.inlineData.data}`;
        break;
      }
    }
  }

  if (!newImageUrl) {
    throw new Error('AI did not return a modified image. Please try again.');
  }

  return { newImageUrl };
}

// --- Helpers ---

export function extractBase64(dataUrl: string): string {
  const commaIndex = dataUrl.indexOf(',');
  if (commaIndex === -1) return dataUrl;
  return dataUrl.substring(commaIndex + 1);
}

export function extractMime(dataUrl: string): string {
  const match = dataUrl.match(/^data:([^;]+);/);
  return match ? match[1] : 'image/png';
}
