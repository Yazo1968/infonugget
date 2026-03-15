import { UploadedFile, Heading } from '../types';
import { CLAUDE_MODEL } from './constants';
import { callClaude } from './ai';
import { RecordUsageFn } from '../hooks/useTokenUsage';

// ── Domain Generation ──
// Extracts TOC + opening content from documents and calls Claude
// to generate structured domain context for expert priming and image generation.

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
 * Build the Claude prompt for domain generation.
 */
function buildDomainPrompt(docSummaries: string): { system: string; prompt: string } {
  const system =
    'You are a document analyst. Your task is to profile the provided documents across four dimensions: domain, content nature, visualization paradigm, and visual vocabulary.';

  const prompt = `Analyze the following document summaries and produce exactly 4 bullet points:

- Domain: The specific industry sector and knowledge area
- Content nature: The fundamental type of content (how information is structured and communicated)
- Visualization paradigm: The best overall approach to visualize this type of content as slides
- Visual vocabulary: Start with the broad illustration type, then "such as" followed by general visual components and design elements applicable across all sections (not specific to any one topic within the content)

Here are examples across different content types:

Example A — Corporate strategy document:
- Domain: Enterprise cloud infrastructure strategy
- Content nature: Analytical and persuasive
- Visualization paradigm: Conceptual frameworks with relationship mapping and strategic matrices
- Visual vocabulary: Infographics such as segmented framework diagrams, competitive positioning matrices, layered architecture visuals, milestone roadmaps, callout statistics

Example B — Children's storybook:
- Domain: Children's literature and early education
- Content nature: Narrative and storytelling
- Visualization paradigm: Scene illustration with narrative flow and character staging
- Visual vocabulary: Children book illustrations such as expressive character portraits, coastal scenery, warm and moody lighting, handwritten-style text elements, atmospheric vignettes

Example C — Financial quarterly report:
- Domain: Corporate financial reporting and investor relations
- Content nature: Analytical and data-heavy
- Visualization paradigm: Data dashboard with metric hierarchy and trend visualization
- Visual vocabulary: Data visualizations such as KPI callout cards, trend arrows, tabular summaries, variance indicators, comparative bar charts

Example D — Software engineering guide:
- Domain: Full-stack web development and DevOps
- Content nature: Instructional and procedural
- Visualization paradigm: Process diagrams with sequential flow and annotated components
- Visual vocabulary: Technical diagrams such as annotated architecture visuals, numbered step sequences, terminal-style code blocks, connection flowlines, component callouts

Example E — Medical research paper:
- Domain: Clinical oncology and immunotherapy research
- Content nature: Analytical and evidence-based
- Visualization paradigm: Data dashboard with evidence hierarchy and comparative analysis
- Visual vocabulary: Scientific illustrations such as patient cohort diagrams, molecular pathway visuals, forest plots, comparative outcome charts, annotated evidence panels

Requirements:
- Be specific to the actual documents — not generic
- Each bullet point should be a concise phrase (8-15 words)
- Visual vocabulary must start with the broad illustration type followed by "such as" and general visual components applicable across the entire content, not elements tied to specific sections or topics
- Do not include any preamble, explanation, or quotation marks
- Output ONLY the 4 bullet points, each starting with "- "

${docSummaries}`;

  return { system, prompt };
}

/**
 * Generate domain context from a set of documents.
 * Uses TOC + opening paragraphs to keep the API call lightweight.
 * Returns structured 4-line domain profile (domain, content nature,
 * visualization paradigm, visual vocabulary).
 */
export async function generateDomain(docs: UploadedFile[], recordUsage?: RecordUsageFn): Promise<string> {
  const summaries = docs.map(extractDocumentSummary).join('\n\n---\n\n');
  const { system, prompt } = buildDomainPrompt(summaries);

  const { text, usage } = await callClaude(prompt, {
    system,
    maxTokens: 300,
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
