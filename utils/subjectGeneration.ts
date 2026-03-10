import { UploadedFile, Heading } from '../types';
import { CLAUDE_MODEL } from './constants';
import { callClaude } from './ai';
import { RecordUsageFn } from '../hooks/useTokenUsage';

// ── Subject Generation ──
// Extracts TOC + opening content from documents and calls Claude
// to generate a concise subject sentence for expert priming.

/**
 * Extract a compact summary from a single document: TOC headings + first paragraph
 * under each main heading. For native PDFs, only the heading structure is used.
 */
function extractDocumentSummary(doc: UploadedFile): string {
  const lines: string[] = [`Document: "${doc.name}"`];
  const headings: Heading[] = doc.structure ?? [];

  if (doc.sourceType === 'native-pdf' || !doc.content) {
    // Native PDF: TOC only (no inline content available)
    if (headings.length > 0) {
      lines.push('Table of Contents:');
      for (const h of headings) {
        const indent = '  '.repeat(Math.max(0, h.level - 1));
        const pageLabel = h.page != null ? ` (p.${h.page})` : '';
        lines.push(`${indent}- ${h.text}${pageLabel}`);
      }
    } else {
      lines.push('(No table of contents available)');
    }
  } else {
    // Markdown/text doc: TOC + first paragraph under each H1/H2
    const mainHeadings = headings.filter((h) => h.level <= 2);

    if (mainHeadings.length > 0) {
      lines.push('Structure and key content:');

      for (let i = 0; i < mainHeadings.length; i++) {
        const h = mainHeadings[i];
        const indent = '  '.repeat(Math.max(0, h.level - 1));
        lines.push(`${indent}## ${h.text}`);

        // Extract first paragraph after this heading
        if (h.startIndex != null && doc.content) {
          const afterHeading = doc.content.substring(h.startIndex);
          // Skip past the heading line itself, then grab the first non-empty paragraph
          const match = afterHeading.match(/^[^\n]*\n+([^\n#][^\n]{0,300})/);
          if (match) {
            lines.push(`${indent}  ${match[1].trim()}`);
          }
        }
      }
    } else {
      // No headings — take first 500 chars
      lines.push(doc.content.substring(0, 500));
    }
  }

  return lines.join('\n');
}

/**
 * Build the Claude prompt for subject generation.
 */
function buildSubjectPrompt(docSummaries: string): { system: string; prompt: string } {
  const system =
    'You are a document analyst. Your task is to identify the core subject and domain of the provided documents.';

  const prompt = `Analyze the following document summaries and produce a single sentence (30–40 words) that describes the overall subject and domain of expertise these documents cover.

Requirements:
- Be specific to the actual content — not generic (e.g., "Enterprise zero-trust cybersecurity architecture with focus on cloud-native identity management" not "Technology and security")
- The sentence should be suitable for priming a domain expert to work with this material
- Do not include any preamble, explanation, or quotation marks — output ONLY the sentence

${docSummaries}`;

  return { system, prompt };
}

/**
 * Generate a subject sentence from a set of documents.
 * Uses TOC + opening paragraphs to keep the API call lightweight.
 */
export async function generateSubject(docs: UploadedFile[], recordUsage?: RecordUsageFn): Promise<string> {
  const summaries = docs.map(extractDocumentSummary).join('\n\n---\n\n');
  const { system, prompt } = buildSubjectPrompt(summaries);

  const { text, usage } = await callClaude(prompt, {
    system,
    maxTokens: 150,
  });

  recordUsage?.({
    provider: 'claude',
    model: CLAUDE_MODEL,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: usage.cache_read_input_tokens,
    cacheWriteTokens: usage.cache_creation_input_tokens,
  });

  // Clean up: remove surrounding quotes if present, trim whitespace
  return text.trim().replace(/^["']|["']$/g, '');
}
