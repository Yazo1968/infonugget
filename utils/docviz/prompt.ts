import { DocVizProposal } from '../../types';
import { createLogger } from '../logger';

const log = createLogger('DocVizPrompt');

export const DOCVIZ_SYSTEM_PROMPT =
  'You are a document visual intelligence analyst with deep expertise in data visualization and information design. You scrutinize documents thoroughly to find every opportunity where a visual representation would add genuine analytical value.';

export const DOCVIZ_USER_PROMPT = `Analyse the attached document thoroughly. Identify every section or data point that would benefit from a visual representation — such as a chart, diagram, graph, matrix, flowchart, map, or any other visual format you determine is fit for purpose.

For each section you identify, follow this reasoning process:
1. First, extract the raw data points — what numbers, relationships, sequences, or comparisons exist in the text.
2. Then, evaluate which visual type best reveals the structure and relationships in that data. Consider at least 3 candidate types before choosing the most effective one.
3. Only then, structure the data to suit the chosen visual type.

You have complete freedom to choose any visual type — such as bar charts, radar charts, Sankey diagrams, heatmaps, quadrant matrices, process flows, hierarchy trees, Gantt charts, tornado charts, network diagrams, Venn diagrams, waterfall charts, decision trees, swimlane diagrams, or any other format. Choose the type that most effectively communicates the insight — do not default to simple chart types when a more specialized visual would be more effective.

Return a JSON array. Each element represents one proposed visual.

Every proposal must contain these fields:
- "section_ref": the section or subsection heading exactly as it appears in the document
- "visual_title": a brief content-focused title (2-6 words) describing what the data shows, not the visual type (e.g., "Revenue by Region" not "Bar Chart of Revenue by Region")
- "visual_type": the specific visual type you recommend, using the exact industry-standard name — one type only, no combinations, no qualifiers, no descriptions appended. Correct: "Gantt chart", "Network diagram", "Radar chart". Incorrect: "Gantt/milestone timeline", "Bar chart with trend overlay", "Network diagram showing dependencies".
- "description": one neutral sentence describing what this visual shows — like a figure caption (e.g., "Breakdown of regulatory timelines across three legislative instruments"). Do NOT mention the visual type, chart mechanics, or why the visual is useful — just state what data or relationship it depicts
- "alternative_types": an array of other visual types that could also effectively represent the same data (for example, data suited for a pie chart might also work as a bar chart or treemap). Same naming rule: exact industry-standard names only, one type per entry. Include only when genuinely applicable — do not force alternatives.
- "data": the underlying data extracted from the document, structured as a table with "headers" (array of column name strings) and "rows" (array of arrays, each inner array being one row of values). Structure the columns to suit the proposed visual — for example, a process flow might have columns ["Step", "From", "To", "Condition"], a radar chart might have ["Dimension", "Score", "Basis"], a matrix might have ["Row label", "Column A", "Column B"]. Choose whatever columns best capture the data for the visual. Keep cell values as concise as possible — use the absolute minimum wording needed for the reader to understand the data point. Prefer short labels, abbreviations, and keywords over full sentences. The data will be used to generate a visual, not read as prose.

Rules:
- Use only content explicitly present in the document. Do not infer, assume, or fabricate data points.
- Do not reproduce a table from the document as-is. However, reinterpreting tabular data into a different visual form that reveals new insight is encouraged.
- Do not propose a visual if the document lacks sufficient data to meaningfully populate it.
- Do not include any style, colour, font, or aesthetic instructions.
- If no suitable visuals exist, return an empty array [].

Return only the JSON array. No commentary, no explanation, no wrapping.`;

/**
 * Parse the AI response into DocVizProposal[].
 * Handles optional markdown fencing around JSON.
 */
export function parseDocVizResponse(text: string): DocVizProposal[] {
  let cleaned = text.trim();

  // Strip markdown code fences if present
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  }

  try {
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) {
      log.warn('DocViz response is not an array, wrapping:', typeof parsed);
      return [];
    }
    return parsed as DocVizProposal[];
  } catch (err) {
    log.error('Failed to parse DocViz response:', err);
    throw new Error('Failed to parse visual proposals from AI response');
  }
}
