import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;
const CLAUDE_MODEL = 'claude-sonnet-4-6';
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey',
};

// ════════════════════════════════════════════════════════════════
// DQAF PROMPT CONSTANTS
// ════════════════════════════════════════════════════════════════

const CALL1_SYSTEM_PROMPT = `You are a Document Quality Assessment Engine for a content production platform. The platform creates insights, presentations, infographics, and data visualisations from document sets. Your job is to assess whether submitted documents are structurally sound and contain content that is useful for the stated brief.

## YOUR TASK (Call 1 — Per-Document Analysis)

For each document provided, you will:
1. Profile the engagement purpose across 5 dimensions
2. Profile each document across the same 5 dimensions
3. Score each document's content utility against the engagement purpose (Score A)
4. Run 6 structural checks on each document (Pass 1)

## STAGE 1 — RELEVANCE PROFILING

### Step 1A — Profile the Engagement Purpose

Extract a profile of the engagement purpose across five dimensions:
- **Objective**: What is the fundamental purpose of the output? What question is it answering or decision is it informing?
- **Audience**: Who will consume the output? Their familiarity with the subject and what they need.
- **Type**: What kind of deliverable is being produced? (dashboard, presentation, briefing, report, infographic, etc.)
- **Focus**: What subject matter must the output address?
- **Tone**: What register does the output require? (executive summary, operational detail, technical depth, etc.)

Record one descriptive phrase per dimension.

### Step 1B — Profile Each Document

For each document, extract the same five dimensions based on observable content. Do not infer purpose from title alone — read enough to characterise what it actually is, who it was written for, what it covers, and how it communicates.

### Step 1C — Score Content Utility (Score A)

For each document, evaluate how useful its actual content is for producing the output described in the engagement purpose. This is NOT a profile-to-profile comparison — it assesses whether the document contains the information, data, evidence, or material needed to fulfil the brief.

For each dimension, answer the specific question:

- **Objective** (30%): Does the document contain content that directly helps achieve the brief's stated objective? For example, if the objective is "financial analysis", does the document contain financial data, metrics, or analysis? If the objective is "educate new hires", does it contain instructional or explanatory material?
- **Focus** (25%): Does the document contain material relevant to the brief's focus area? For example, if the focus is "risk factors", does the document discuss risks, threats, or mitigations? If the focus is "market trends", does it contain market data or trend analysis?
- **Audience** (20%): Is the document's content suitable or readily adaptable for the brief's target audience? Technical data is useful for a technical audience but may need heavy translation for executives. Raw research notes may not serve a client-facing deliverable.
- **Type** (15%): Does the document provide content appropriate for the brief's deliverable type? A photo album has limited utility for an analytical report. A data table is highly useful for a dashboard. Interview transcripts can feed narrative presentations but not infographics.
- **Tone** (10%): Can the document's content be presented in the brief's required register without distortion? Informal brainstorming notes can feed formal reports, but satirical content cannot feed a serious compliance brief without risk of misrepresentation.

**Scoring scale:**
- **Direct (score = 2)**: The document contains content that directly serves this dimension. Material can be extracted and used with minimal transformation.
- **Supporting (score = 1)**: The document contains some relevant content for this dimension, but it is tangential, requires significant interpretation, or only partially covers the need.
- **Irrelevant (score = 0)**: The document contains no meaningful content for this dimension.

**Formula:** Sum of (weight × alignment_score) / 2 × 100 = percentage

**Interpretation thresholds:**
- 80-100%: primary_source — content directly serves the brief
- 50-79%: supporting_source — contains useful but not core material
- Below 50%: orphan_review_required — content does not meaningfully serve the brief

## STAGE 2 PASS 1 — PER-DOCUMENT CHECKS

Run these six checks independently on every document:

**P1-01 Metadata Presence**: Confirm the document carries enough identifying information to establish what it is, when produced, who produced it, and what version it represents.

**P1-02 Internal Number Reconciliation**: Verify that numbers in summary positions are supported by detail. Totals should match components. Percentages should sum correctly. Rounding artifacts acceptable only if explicitly acknowledged.

**P1-03 Internal Contradiction**: Check whether the same fact, figure, name, date, or statement appears differently in two or more places within the same document.

**P1-04 Broken References**: Identify references to tables, appendices, exhibits, figures, or sections that don't exist in the document. Assess whether missing content is data-bearing (critical) or illustrative (minor).

**P1-05 Version Clarity**: Confirm the document clearly identifies itself as a specific version, draft, or final iteration. Ambiguous version status means a more current version may supersede it.

**P1-06 Structural Coherence**: Verify the document is complete and navigable. All sections referenced in contents/introduction should be present. Narrative should not abruptly terminate or appear truncated.

**Scoring scale for all checks:**
- **2 — Pass**: No issues detected.
- **1 — Caution**: Issue present but does not critically distort output. Usable with noted caveat.
- **0 — Fail**: Issue present that will materially distort, mislead, or invalidate output.

For scores 0 or 1, the note MUST include precise location references (page, section, table).

## SEVERITY CLASSIFICATION

Every issue must be assigned a severity by asking: if someone reads the output produced from this document set without seeing this flag, what happens?
- **Critical**: They will be misled — false, conflicting, or unsupported information presented as fact
- **Moderate**: They will have incomplete context — output usable but needs caveat
- **Minor**: Issue is real but does not change accuracy or defensibility of output

When uncertain between Critical and Moderate, default to Critical.

## OUTPUT FORMAT

Return a single JSON object with this exact structure:

\`\`\`json
{
  "engagementPurposeProfile": {
    "objective": "phrase",
    "audience": "phrase",
    "type": "phrase",
    "focus": "phrase",
    "tone": "phrase"
  },
  "documents": [
    {
      "documentId": "the document ID from the request",
      "documentLabel": "short human-readable name inferred from content",
      "metadata": {
        "detectedTitle": "string or null",
        "detectedDate": "string or null",
        "detectedVersion": "string or null",
        "detectedSource": "string or null"
      },
      "documentProfile": {
        "objective": "phrase",
        "audience": "phrase",
        "type": "phrase",
        "focus": "phrase",
        "tone": "phrase"
      },
      "relevanceScoreA": 85,
      "relevanceInterpretation": "primary_source",
      "relevanceDimensionScores": {
        "objective": { "alignmentScore": 2, "alignmentLabel": "direct", "note": "Contains quarterly revenue data and growth metrics that directly support financial analysis objective" },
        "focus": { "alignmentScore": 2, "alignmentLabel": "direct", "note": "Three sections devoted to risk assessment and mitigation strategies" },
        "audience": { "alignmentScore": 1, "alignmentLabel": "supporting", "note": "Written for internal finance team; adaptable for board but requires simplification" },
        "type": { "alignmentScore": 0, "alignmentLabel": "irrelevant", "note": "Photo documentation of office facilities — no extractable data for analytical presentation" },
        "tone": { "alignmentScore": 2, "alignmentLabel": "direct", "note": "Formal analytical register matches the brief requirement" }
      },
      "pass1Scores": {
        "P1-01": { "score": 2, "note": null },
        "P1-02": { "score": 1, "note": "Row totals on page 4 do not reconcile with summary" },
        "P1-03": { "score": 2, "note": null },
        "P1-04": { "score": 0, "note": "Exhibit 2 referenced on p.7 is missing — data-bearing" },
        "P1-05": { "score": 2, "note": null },
        "P1-06": { "score": 2, "note": null }
      }
    }
  ]
}
\`\`\`

Return ONLY the JSON. No preamble, no markdown fences, no trailing text.`;


const CALL2_SYSTEM_PROMPT_TEMPLATE = `You are continuing a Document Quality Assessment for a content production platform that creates insights, presentations, infographics, and data visualisations. The per-document analysis (Stage 1 profiling + Pass 1 checks) has been completed. You now perform cross-document analysis.

## PRIOR RESULTS FROM CALL 1

{CALL1_RESULTS}

## YOUR TASK (Call 2 — Cross-Document Analysis)

1. Score inter-document content complementarity (Score B) for every document pair
2. Run 5 cross-document checks (P2-02 through P2-06 — P2-01 is retired)
3. Review Pass 1 results for per-document flags with cross-document consequences
4. Generate document register with required actions per document
5. Generate verdict rationale
6. Generate mandatory production notice if any critical flags exist

## STAGE 1D — INTER-DOCUMENT CONTENT COMPLEMENTARITY (Score B)

For every pair of documents, evaluate whether their content contributions toward the brief are complementary, overlapping, or conflicting. This is NOT a profile-to-profile comparison — it assesses how the documents work together as source material for producing the output described in the engagement purpose.

For each dimension, ask:

- **Objective** (30%): Do both documents contribute content toward the brief's objective in a complementary way (different facets of the same goal), or do they present conflicting conclusions or data that would confuse the output?
- **Focus** (25%): Do both documents cover the brief's focus area from compatible angles, or do they present contradictory information on the same topic? Complementary coverage (e.g., one provides data, another provides context) scores higher than redundant or conflicting coverage.
- **Audience** (20%): Can content from both documents be combined coherently for the brief's target audience, or would mixing them create jarring inconsistency in depth, terminology, or assumed knowledge?
- **Type** (15%): Do the content types from both documents combine well for the brief's deliverable? (e.g., data tables + narrative analysis = complementary; two contradictory executive summaries = problematic)
- **Tone** (10%): Can content from both documents be presented together without tonal whiplash or register inconsistency?

**Scoring scale:**
- **Aligned (score = 2)**: Content from both documents contributes complementary material for this dimension. Can be combined without qualification.
- **Adjacent (score = 1)**: Content overlaps or differs in approach but can be reconciled with explicit framing.
- **Incompatible (score = 0)**: Content from these documents conflicts or creates confusion when combined for this dimension. Using both requires explicit disclosure.

**Same dimension weights as Score A:** Objective 30%, Focus 25%, Audience 20%, Type 15%, Tone 10%

**Formula:** Sum of (weight × score) / 2 × 100 = percentage

Dimensions scoring 0 are pre-identified conflict zones for Pass 2.

## STAGE 2 PASS 2 — CROSS-DOCUMENT CHECKS

Run these five checks across the full set (P2-01 is retired — relevance handled by Stage 1):

**P2-02 Data Point Conflicts**: Identify any metric, figure, date, name, rate, or value that appears in more than one document with different values for the same thing/period/scope. Do NOT resolve — flag both values and both sources.

**P2-03 Terminology Consistency**: Identify cases where the same concept is referred to by meaningfully different terms across documents, creating genuine ambiguity. Surface-level word variation that context resolves is Minor.

**P2-04 Scope Overlap Conflict**: Identify cases where two documents cover the same subject/period/geography and present contradictory conclusions. Complementary coverage from different angles is NOT a conflict.

**P2-05 Version Conflict**: Identify cases where two or more documents appear to be different versions of the same document — same title, overlapping scope, different content.

**P2-06 Orphaned Document**: Flag any document scoring below 50% on Score A, or scoring 0 on Objective or Focus in compatibility (Score B) with every other document.

**Scoring:** Same 0/1/2 scale. For each finding, assign severity (critical/moderate/minor) using the classification rule:
- Misled = Critical
- Incomplete context = Moderate
- Neither = Minor

**Scope classification for cross-document findings:**
- "between_documents" — the finding involves a specific pair or subset of documents
- "whole_set" — the finding affects the document set as a whole

## PASS 1 ESCALATION — PER-DOCUMENT FLAGS

Review the Pass 1 scores from Call 1 results above. For any P1 check that scored 0 or 1 on a document, evaluate whether the issue has consequences for the combined document set — i.e., whether it could distort, confuse, or undermine output that draws from multiple documents together.

If a P1 failure DOES have cross-document consequences, add it to perDocumentFlags with:
- checkId: the P1 check (e.g., "P1-02")
- documentId: the specific document
- scope: always "this_document"
- severity: same classification rule (misled = critical, incomplete context = moderate, neither = minor)
- description: what the P1 issue is (brief)
- crossDocumentConsequence: what happens to combined output if this issue is not addressed

Do NOT duplicate P1 findings into crossDocumentFindings. P1 issues go ONLY in perDocumentFlags. Cross-document findings (P2-*) go ONLY in crossDocumentFindings.

Not every P1 failure needs escalation. Only escalate when the issue would propagate beyond the single document into combined output.

## MANDATORY PRODUCTION NOTICE

If ANY critical flag exists (from Pass 1, Pass 2, or per-document flags), generate a mandatoryProductionNotice:
- summary: 1-2 sentence plain-language summary
- conflictsDescribed: which documents are involved and the nature of the conflict
- productionConsequence: what will happen to output if unaddressed
- suggestedDisclosure: a ready-to-use disclosure statement the producer can include in output

Omit entirely if no critical flags exist.

## DOCUMENT REGISTER

For each document, provide:
- documentId, documentLabel, detectedVersion, detectedDate
- requiredAction: plain, specific, actionable instruction for the producer

## OUTPUT FORMAT

Return a single JSON object:

\`\`\`json
{
  "interDocumentCompatibility": [
    {
      "documentPair": ["doc-id-1", "doc-id-2"],
      "compatibilityScoreB": 72,
      "dimensionScores": {
        "objective": { "score": 2, "label": "aligned", "note": null },
        "focus": { "score": 1, "label": "adjacent", "note": "explanation" },
        "audience": { "score": 1, "label": "adjacent", "note": "explanation" },
        "type": { "score": 0, "label": "incompatible", "note": "explanation" },
        "tone": { "score": 1, "label": "adjacent", "note": "explanation" }
      }
    }
  ],
  "crossDocumentFindings": [
    {
      "checkId": "P2-02",
      "scope": "between_documents",
      "severity": "critical",
      "description": "Precise description with location references",
      "documentsInvolved": ["doc-id-1", "doc-id-2"],
      "productionImpact": "What happens if unaddressed"
    }
  ],
  "perDocumentFlags": [
    {
      "checkId": "P1-02",
      "documentId": "doc-id-1",
      "scope": "this_document",
      "severity": "critical",
      "description": "Row totals on page 4 do not reconcile with summary",
      "crossDocumentConsequence": "These figures feed into the cross-document comparison — combined totals will be unreliable"
    }
  ],
  "documentRegister": [
    {
      "documentId": "doc-id-1",
      "documentLabel": "Q3 Report",
      "detectedVersion": "v3.0",
      "detectedDate": "2024-10-15",
      "requiredAction": "Use with caveat — reconcile revenue with Document B"
    }
  ],
  "verdictRationale": "Plain-language explanation of what drove the verdict",
  "mandatoryProductionNotice": {
    "summary": "...",
    "conflictsDescribed": "...",
    "productionConsequence": "...",
    "suggestedDisclosure": "..."
  }
}
\`\`\`

If no critical flags exist, omit mandatoryProductionNotice entirely.
If crossDocumentFindings is empty (no issues), return an empty array.
If no P1 failures have cross-document consequences, return perDocumentFlags as an empty array.
Return ONLY the JSON. No preamble, no markdown fences, no trailing text.`;


// ════════════════════════════════════════════════════════════════
// CLAUDE API HELPER
// ════════════════════════════════════════════════════════════════

interface CallResult {
  text: string;
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };
}

async function callClaudeAPI(
  systemBlocks: Array<{ text: string; cache: boolean }>,
  messages: any[],
  maxTokens: number,
  fileApiDocs?: Array<{ fileId: string; name: string }>,
): Promise<CallResult> {
  const system = systemBlocks.map((b) => {
    const block: any = { type: 'text', text: b.text };
    if (b.cache) block.cache_control = { type: 'ephemeral' };
    return block;
  });

  const processedMessages = messages.map((m: any) => ({ ...m }));

  // Inject Files API document blocks into first user message
  if (fileApiDocs && fileApiDocs.length > 0) {
    const docBlocks = fileApiDocs.map((d) => ({
      type: 'document' as const,
      source: { type: 'file' as const, file_id: d.fileId },
      title: d.name,
    }));
    if (processedMessages.length > 0 && processedMessages[0].role === 'user') {
      const firstMsg = processedMessages[0];
      const existingBlocks = typeof firstMsg.content === 'string'
        ? [{ type: 'text', text: firstMsg.content }]
        : [...firstMsg.content];
      processedMessages[0] = { role: 'user', content: [...docBlocks, ...existingBlocks] };
    }
  }

  // Add cache breakpoint to last user message
  for (let i = processedMessages.length - 1; i >= 0; i--) {
    if (processedMessages[i].role === 'user') {
      const msg = processedMessages[i];
      if (typeof msg.content === 'string') {
        processedMessages[i] = {
          role: 'user',
          content: [{ type: 'text', text: msg.content, cache_control: { type: 'ephemeral' } }],
        };
      }
      break;
    }
  }

  const body: any = {
    model: CLAUDE_MODEL,
    system,
    messages: processedMessages,
    max_tokens: maxTokens,
    temperature: 0.1,
  };

  const betaFeatures = ['prompt-caching-2024-07-31'];
  if (fileApiDocs && fileApiDocs.length > 0) {
    betaFeatures.push('files-api-2025-04-14');
  }

  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': betaFeatures.join(','),
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({ error: { message: `HTTP ${res.status}` } }));
    throw new Error(errBody.error?.message || `Claude API failed: ${res.status}`);
  }

  const data = await res.json();
  const textBlock = data.content?.find((b: any) => b.type === 'text');
  return {
    text: textBlock?.text || '',
    usage: {
      inputTokens: data.usage?.input_tokens ?? 0,
      outputTokens: data.usage?.output_tokens ?? 0,
      cacheReadTokens: data.usage?.cache_read_input_tokens ?? 0,
      cacheWriteTokens: data.usage?.cache_creation_input_tokens ?? 0,
    },
  };
}


// ════════════════════════════════════════════════════════════════
// JSON PARSER
// ════════════════════════════════════════════════════════════════

function extractJSON(text: string): any {
  let jsonStr = text.trim();
  // Try markdown fences
  const fenceMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1].trim();
  } else {
    const braceStart = jsonStr.indexOf('{');
    if (braceStart > 0) jsonStr = jsonStr.slice(braceStart);
    const braceEnd = jsonStr.lastIndexOf('}');
    if (braceEnd >= 0 && braceEnd < jsonStr.length - 1) jsonStr = jsonStr.slice(0, braceEnd + 1);
  }
  return JSON.parse(jsonStr);
}


// ════════════════════════════════════════════════════════════════
// STAGE 3 — KPI COMPUTATION
// ════════════════════════════════════════════════════════════════

function computeDocReadinessScore(pass1Scores: Record<string, { score: number }>): number {
  const checks = ['P1-01', 'P1-02', 'P1-03', 'P1-04', 'P1-05', 'P1-06'];
  const total = checks.reduce((sum, id) => sum + (pass1Scores[id]?.score ?? 0), 0);
  // max possible = 12 (6 checks × 2)
  return Math.round((total / 12) * 100);
}

function computeDocVerdict(score: number): string {
  if (score >= 90) return 'ready';
  if (score >= 70) return 'conditional';
  return 'not_ready';
}

function computeKPIs(
  documents: any[],
  crossDocFindings: any[],
  isSingleDoc: boolean,
): any {
  const totalDocs = documents.length;

  // Document Relevance Rate = average of all Score A values
  const relevanceRate = totalDocs > 0
    ? documents.reduce((sum: number, d: any) => sum + (d.relevanceScoreA ?? 0), 0) / totalDocs
    : 0;

  // Internal Integrity Rate = % of docs where avg(P1-02, P1-03, P1-04) == 2
  let integrityCount = 0;
  for (const d of documents) {
    const scores = d.pass1Scores || {};
    const avg = ((scores['P1-02']?.score ?? 0) + (scores['P1-03']?.score ?? 0) + (scores['P1-04']?.score ?? 0)) / 3;
    if (avg === 2) integrityCount++;
  }
  const integrityRate = totalDocs > 0 ? (integrityCount / totalDocs) * 100 : 0;

  // Cross-Document Consistency Score = % of {P2-02, P2-03, P2-04} with zero findings
  let consistencyScore = 100;
  if (!isSingleDoc) {
    const consistencyChecks = ['P2-02', 'P2-03', 'P2-04'];
    let cleanChecks = 0;
    for (const checkId of consistencyChecks) {
      const hasFindings = crossDocFindings.some((f: any) => f.checkId === checkId);
      if (!hasFindings) cleanChecks++;
    }
    consistencyScore = (cleanChecks / 3) * 100;
  }

  // Version Confidence Rate = avg of (% docs scoring 2 on P1-05, no P2-05 findings ? 100 : 0)
  let p105Count = 0;
  for (const d of documents) {
    if ((d.pass1Scores?.['P1-05']?.score ?? 0) === 2) p105Count++;
  }
  const p105Rate = totalDocs > 0 ? (p105Count / totalDocs) * 100 : 0;
  const p205Clean = isSingleDoc || !crossDocFindings.some((f: any) => f.checkId === 'P2-05');
  const versionRate = (p105Rate + (p205Clean ? 100 : 0)) / 2;

  // Structural Coherence Rate = % of docs scoring 2 on P1-06
  let p106Count = 0;
  for (const d of documents) {
    if ((d.pass1Scores?.['P1-06']?.score ?? 0) === 2) p106Count++;
  }
  const structureRate = totalDocs > 0 ? (p106Count / totalDocs) * 100 : 0;

  // Overall Set Readiness Score = weighted average
  const overall = integrityRate * 0.30 + consistencyScore * 0.30 + relevanceRate * 0.20 + versionRate * 0.10 + structureRate * 0.10;

  return {
    documentRelevanceRate: Math.round(relevanceRate * 10) / 10,
    internalIntegrityRate: Math.round(integrityRate * 10) / 10,
    crossDocumentConsistencyScore: Math.round(consistencyScore * 10) / 10,
    versionConfidenceRate: Math.round(versionRate * 10) / 10,
    structuralCoherenceRate: Math.round(structureRate * 10) / 10,
    overallSetReadinessScore: Math.round(overall * 10) / 10,
  };
}

function computeFlagsSummary(documents: any[], crossDocFindings: any[], perDocumentFlags: any[]): any {
  let critical = 0, moderate = 0, minor = 0;

  // Count from Pass 1 (scores < 2)
  for (const d of documents) {
    for (const checkId of ['P1-01', 'P1-02', 'P1-03', 'P1-04', 'P1-05', 'P1-06']) {
      const score = d.pass1Scores?.[checkId]?.score;
      if (score === 0) critical++;
      else if (score === 1) moderate++;
    }
  }

  // Count from cross-doc findings
  for (const f of crossDocFindings) {
    if (f.severity === 'critical') critical++;
    else if (f.severity === 'moderate') moderate++;
    else if (f.severity === 'minor') minor++;
  }

  // Count from per-document flags (P1 escalations with cross-doc consequences)
  for (const f of perDocumentFlags) {
    if (f.severity === 'critical') critical++;
    else if (f.severity === 'moderate') moderate++;
    else if (f.severity === 'minor') minor++;
  }

  return { critical, moderate, minor, total: critical + moderate + minor };
}


// ════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ════════════════════════════════════════════════════════════════

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    // ── Auth ──
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Missing Authorization header');

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) throw new Error('Unauthorized');

    // ── Parse Request ──
    const { documents, engagementPurpose, nuggetId } = await req.json();
    if (!documents || !Array.isArray(documents) || documents.length === 0) {
      throw new Error('At least one document is required');
    }
    if (!engagementPurpose || typeof engagementPurpose !== 'string') {
      throw new Error('Engagement purpose statement is required');
    }

    // Update last_api_call_at for Files API cleanup job safety (secondary signal)
    if (nuggetId) {
      const svcDb = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
      svcDb.from('nuggets')
        .update({ last_api_call_at: new Date().toISOString() })
        .eq('id', nuggetId)
        .then(({ error: e }) => { if (e) console.warn('last_api_call_at update failed:', e); });
    }

    const isSingleDoc = documents.length === 1;
    const docCount = documents.length;
    let totalUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

    // ── Build document blocks ──
    const fileApiDocs: Array<{ fileId: string; name: string }> = [];
    const inlineDocSections: string[] = [];

    for (const d of documents) {
      if (d.fileId) {
        fileApiDocs.push({ fileId: d.fileId, name: d.name });
      } else if (d.content) {
        const MAX_CHARS = 50000;
        const excerpt = d.content.length > MAX_CHARS
          ? d.content.slice(0, MAX_CHARS) + '\n\n[... document truncated for analysis ...]'
          : d.content;
        inlineDocSections.push(`--- Document: ${d.name} (ID: ${d.id}) ---\n${excerpt}\n--- End Document ---`);
      } else {
        inlineDocSections.push(`--- Document: ${d.name} (ID: ${d.id}) ---\n[No content available]\n--- End Document ---`);
      }
    }

    // ══════════════════════════════════════════════════════════
    // CALL 1 — Stage 1 (Profiling + Score A) + Pass 1 (6 checks)
    // ══════════════════════════════════════════════════════════

    const call1SystemBlocks: Array<{ text: string; cache: boolean }> = [
      { text: CALL1_SYSTEM_PROMPT, cache: true },
    ];

    // Add engagement purpose as a separate system block
    call1SystemBlocks.push({
      text: `## ENGAGEMENT PURPOSE STATEMENT\n\n"${engagementPurpose}"\n\n## DOCUMENT ID MAPPING\n\n${documents.map((d: any) => `- ID: ${d.id} → Name: ${d.name}`).join('\n')}`,
      cache: false,
    });

    // Add inline documents if any
    if (inlineDocSections.length > 0) {
      call1SystemBlocks.push({
        text: `## INLINE DOCUMENTS\n\n${inlineDocSections.join('\n\n')}`,
        cache: true,
      });
    }

    const call1Messages = [{
      role: 'user' as const,
      content: 'Analyze each document against the engagement purpose. Assess the content utility of each document for the brief — evaluate what usable information, data, and material each document actually contains for producing the described output. Profile all dimensions, score content utility, and run all Pass 1 checks. Return the complete JSON as specified.',
    }];

    console.log(`[DQAF] Call 1: ${docCount} docs, ${fileApiDocs.length} Files API, ${inlineDocSections.length} inline`);

    const call1Result = await callClaudeAPI(
      call1SystemBlocks,
      call1Messages,
      16384,
      fileApiDocs.length > 0 ? fileApiDocs : undefined,
    );

    totalUsage.inputTokens += call1Result.usage.inputTokens;
    totalUsage.outputTokens += call1Result.usage.outputTokens;
    totalUsage.cacheReadTokens += call1Result.usage.cacheReadTokens;
    totalUsage.cacheWriteTokens += call1Result.usage.cacheWriteTokens;

    const call1Data = extractJSON(call1Result.text);
    console.log(`[DQAF] Call 1 complete: ${call1Data.documents?.length ?? 0} doc assessments`);

    // ── Compute document-level scores and verdicts ──
    for (const doc of call1Data.documents) {
      doc.documentReadinessScore = computeDocReadinessScore(doc.pass1Scores || {});
      doc.documentVerdict = computeDocVerdict(doc.documentReadinessScore);
    }

    // ══════════════════════════════════════════════════════════
    // CALL 2 — Stage 1D (Score B) + Pass 2 (5 cross-doc checks)
    // ══════════════════════════════════════════════════════════

    let call2Data: any = {
      interDocumentCompatibility: [],
      crossDocumentFindings: [],
      perDocumentFlags: [],
      documentRegister: [],
      verdictRationale: '',
      mandatoryProductionNotice: undefined,
    };

    if (!isSingleDoc) {
      // Build Call 1 results text for context
      const call1Context = JSON.stringify({
        engagementPurposeProfile: call1Data.engagementPurposeProfile,
        documents: call1Data.documents.map((d: any) => ({
          documentId: d.documentId,
          documentLabel: d.documentLabel,
          documentProfile: d.documentProfile,
          relevanceScoreA: d.relevanceScoreA,
          relevanceInterpretation: d.relevanceInterpretation,
          pass1Scores: d.pass1Scores,
          documentReadinessScore: d.documentReadinessScore,
          documentVerdict: d.documentVerdict,
          metadata: d.metadata,
        })),
      }, null, 2);

      const call2Prompt = CALL2_SYSTEM_PROMPT_TEMPLATE.replace('{CALL1_RESULTS}', call1Context);

      const call2SystemBlocks: Array<{ text: string; cache: boolean }> = [
        { text: call2Prompt, cache: true },
      ];

      // Add inline documents for context (same as Call 1)
      if (inlineDocSections.length > 0) {
        call2SystemBlocks.push({
          text: `## INLINE DOCUMENTS\n\n${inlineDocSections.join('\n\n')}`,
          cache: true,
        });
      }

      const call2Messages = [{
        role: 'user' as const,
        content: 'Analyze cross-document relationships. Evaluate how documents complement or conflict with each other as source material for the brief. Score inter-document content complementarity for every pair, run Pass 2 checks, review Pass 1 results for cross-document escalations, generate document register actions and verdict rationale. Return the complete JSON as specified.',
      }];

      console.log(`[DQAF] Call 2: cross-document analysis for ${docCount} docs (${docCount * (docCount - 1) / 2} pairs)`);

      const call2Result = await callClaudeAPI(
        call2SystemBlocks,
        call2Messages,
        12288,
        fileApiDocs.length > 0 ? fileApiDocs : undefined,
      );

      totalUsage.inputTokens += call2Result.usage.inputTokens;
      totalUsage.outputTokens += call2Result.usage.outputTokens;
      totalUsage.cacheReadTokens += call2Result.usage.cacheReadTokens;
      totalUsage.cacheWriteTokens += call2Result.usage.cacheWriteTokens;

      call2Data = extractJSON(call2Result.text);
      console.log(`[DQAF] Call 2 complete: ${call2Data.interDocumentCompatibility?.length ?? 0} pairs, ${call2Data.crossDocumentFindings?.length ?? 0} findings, ${call2Data.perDocumentFlags?.length ?? 0} per-doc flags`);
    } else {
      // Single doc — generate register and verdict rationale from Call 1 data
      const doc = call1Data.documents[0];
      call2Data.documentRegister = [{
        documentId: doc.documentId,
        documentLabel: doc.documentLabel,
        detectedVersion: doc.metadata?.detectedVersion ?? null,
        detectedDate: doc.metadata?.detectedDate ?? null,
        requiredAction: doc.documentVerdict === 'ready'
          ? 'Use as-is — single document passed all structural checks.'
          : 'Review flagged issues before production.',
      }];
      call2Data.verdictRationale = `Single document assessment. Document scored ${doc.documentReadinessScore}% readiness with verdict: ${doc.documentVerdict}.`;
    }

    // ══════════════════════════════════════════════════════════
    // STAGE 3 — KPI COMPUTATION & REPORT ASSEMBLY
    // ══════════════════════════════════════════════════════════

    // Normalize cross-doc findings (handle potential snake_case from Claude)
    const crossDocFindings = (call2Data.crossDocumentFindings || []).map((f: any) => ({
      checkId: f.checkId || f.check_id,
      scope: f.scope || 'between_documents',
      severity: f.severity,
      description: f.description,
      documentsInvolved: f.documentsInvolved || f.documents_involved || [],
      productionImpact: f.productionImpact || f.production_impact || '',
    }));

    // Normalize per-document flags (handle potential snake_case from Claude)
    const perDocumentFlags = (call2Data.perDocumentFlags || call2Data.per_document_flags || []).map((f: any) => ({
      checkId: f.checkId || f.check_id,
      documentId: f.documentId || f.document_id,
      scope: f.scope || 'this_document',
      severity: f.severity,
      description: f.description,
      crossDocumentConsequence: f.crossDocumentConsequence || f.cross_document_consequence || '',
    }));

    const kpis = computeKPIs(call1Data.documents, crossDocFindings, isSingleDoc);
    const flagsSummary = computeFlagsSummary(call1Data.documents, crossDocFindings, perDocumentFlags);
    const overallVerdict = kpis.overallSetReadinessScore >= 90 ? 'ready'
      : kpis.overallSetReadinessScore >= 70 ? 'conditional' : 'not_ready';

    // Map verdict to legacy status
    const statusMap: Record<string, string> = { ready: 'green', conditional: 'amber', not_ready: 'red' };

    // Build document register with relevance data
    const documentRegister = (call2Data.documentRegister || []).map((r: any) => {
      const docData = call1Data.documents.find((d: any) => d.documentId === r.documentId);
      return {
        documentId: r.documentId,
        documentLabel: r.documentLabel || docData?.documentLabel || 'Unknown',
        detectedVersion: r.detectedVersion ?? docData?.metadata?.detectedVersion ?? null,
        detectedDate: r.detectedDate ?? docData?.metadata?.detectedDate ?? null,
        relevanceScoreA: docData?.relevanceScoreA ?? 0,
        relevanceInterpretation: docData?.relevanceInterpretation ?? 'orphan_review_required',
        documentReadinessScore: docData?.documentReadinessScore ?? 0,
        documentVerdict: docData?.documentVerdict ?? 'not_ready',
        requiredAction: r.requiredAction || 'Review required.',
      };
    });

    const report = {
      assessmentId: crypto.randomUUID(),
      assessedAt: new Date().toISOString(),
      engagementPurposeStatement: engagementPurpose,
      engagementPurposeProfile: call1Data.engagementPurposeProfile || { objective: '', audience: '', type: '', focus: '', tone: '' },
      documentCountSubmitted: docCount,
      documentCountRetrieved: call1Data.documents?.length ?? 0,
      documents: call1Data.documents || [],
      interDocumentCompatibility: call2Data.interDocumentCompatibility || [],
      crossDocumentFindings: crossDocFindings,
      perDocumentFlags: perDocumentFlags,
      kpis,
      flagsSummary,
      overallVerdict,
      verdictRationale: call2Data.verdictRationale || '',
      documentRegister,
      ...(call2Data.mandatoryProductionNotice ? { mandatoryProductionNotice: call2Data.mandatoryProductionNotice } : {}),
      // Internal app fields
      lastCheckTimestamp: Date.now(),
      docChangeLogSeqAtCheck: 0, // Set by client
      status: statusMap[overallVerdict] || 'red',
    };

    console.log(`[DQAF] Assessment complete: ${overallVerdict} (${kpis.overallSetReadinessScore}%), ${flagsSummary.total} flags (${perDocumentFlags.length} per-doc escalations)`);

    return new Response(JSON.stringify({
      success: true,
      report,
      usage: totalUsage,
    }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });

  } catch (err: any) {
    console.error('[DQAF] Error:', err);
    const status = err.message === 'Unauthorized' ? 401
      : err.message?.includes('Missing') || err.message?.includes('required') ? 400
      : 500;
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Internal error' }),
      { status, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
    );
  }
});
