import { QualityReport } from '../../types';

// ─────────────────────────────────────────────────────────────────
// Document Quality Check — Prompt Builders
// ─────────────────────────────────────────────────────────────────
// Builds prompts for the document quality analysis pipeline and
// warning blocks for downstream injection into chat/auto-deck.
// ─────────────────────────────────────────────────────────────────

/**
 * Build the system prompt for the document quality check.
 * Instructs Claude to analyze all active documents, cluster them
 * by topic, detect conflicts, and return structured JSON.
 */
export function buildQualityCheckPrompt(documentNames: string[]): string {
  const docList = documentNames.map((n, i) => `  ${i + 1}. "${n}"`).join('\n');

  return `You are a document integrity analyst. Your task is to analyze a set of documents and produce a structured quality report.

**Documents to analyze:**
${docList}

**Your analysis tasks:**

1. **Topic Clustering** — Group the documents by their primary subject matter. Each cluster should have:
   - A concise subject label (2-6 words)
   - A one-sentence description of what the cluster covers
   - The list of document names that belong to it
   - Whether this cluster is "isolated" (has no meaningful relationship to any other cluster)

   Rules:
   - A document belongs to exactly one cluster
   - Do NOT force connections between unrelated documents — if a document covers a completely different domain, it gets its own single-document cluster marked as isolated
   - Only mark a cluster as isolated if it genuinely shares no common domain, theme, or context with other clusters
   - Two documents discussing different aspects of the same broad field (e.g., healthcare policy + medical research) are related — only truly unrelated domains should be isolated

2. **Conflict Detection** — Identify genuine contradictions between documents where:
   - Two or more documents make conflicting factual claims about the same specific topic
   - The claims are mutually exclusive (not just different perspectives or emphasis)

   For each conflict, provide:
   - A description of what the conflict is about
   - For each conflicting document: the document name, the specific claim, and where in the document it appears (section heading, paragraph reference, or page area)
   - A recommendation for how the user could resolve it

   Rules:
   - Only flag genuine factual contradictions (different numbers, opposing conclusions about the same thing)
   - Do NOT flag: different opinions, different emphasis, complementary information, or information gaps
   - Be specific with citations — reference the actual section or location in the document

**Output format — return ONLY valid JSON matching this exact structure:**

\`\`\`json
{
  "clusters": [
    {
      "subject": "string",
      "description": "string",
      "documentNames": ["string"],
      "isolated": false
    }
  ],
  "conflicts": [
    {
      "description": "string",
      "entries": [
        {
          "documentName": "string",
          "claim": "string",
          "location": "string"
        }
      ],
      "recommendation": "string"
    }
  ]
}
\`\`\`

Return ONLY the JSON. No preamble, no explanation, no markdown fences around it. Just the raw JSON object.`;
}

/**
 * Build a warnings block for injection into downstream prompts (chat, auto-deck).
 * Returns null if there are no active warnings (green, or red but not dismissed).
 */
export function buildQualityWarningsBlock(report?: QualityReport): string | null {
  if (!report) return null;
  if (report.status !== 'red') return null;
  if (!report.dismissed) return null;

  const issues: string[] = [];

  const isolatedClusters = report.clusters.filter((c) => c.isolated);
  if (isolatedClusters.length > 0) {
    issues.push(`${isolatedClusters.length} unrelated document cluster(s)`);
  }
  if (report.conflicts.length > 0) {
    issues.push(`${report.conflicts.length} conflict(s)`);
  }

  if (issues.length === 0) return null;

  return `The document quality check found ${issues.join(' and ')}. When relevant, add a brief footnote formatted exactly as: <i class="qn">See Quality Check panel for details.</i>`;
}
