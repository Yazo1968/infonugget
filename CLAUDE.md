# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

InfoNugget v6.1 — full-stack React app for AI-powered content card generation. Users organize work into Projects > Nuggets > Documents, then use AI to synthesize content cards with generated imagery.

- **Stack**: React 19 + TypeScript 5.8 + Vite 6 + Tailwind CSS 4 + Supabase (auth, DB, storage, edge functions) + Vercel (hosting)
- **AI Models**: Gemini 2.5 Flash (primary: Chat, SmartDeck, DocViz, domain, briefing via File Search RAG) + Claude Sonnet 4.6 (legacy fallback, content synthesis for Sources path) + Gemini 3.1 Flash Image (`gemini-3.1-flash-image-preview`, image generation)
- **Document RAG**: Gemini File Search — documents uploaded to per-nugget File Search Stores, Gemini queries them natively. No chunk extraction needed. See `docs/gemini-file-search-next-steps.md` for architecture and status.
- **Auth**: Supabase Auth — email/password + Google OAuth (login required)
- **Persistence**: Supabase PostgreSQL + Storage (production), IndexedDB fallback (legacy)
- **State**: React Context (5 focused contexts under `context/` + composition hook `useAppContext`), no Redux/Zustand
- **Entry**: `index.tsx` → `AuthProvider` → `AuthGate` (local fn) → `LandingPage` | `AuthPage` | `ProfileSetup` | `StorageProvider` → `ToastProvider` → `App`
- **Production URL**: `https://infonugget.vercel.app`
- **Supabase Project**: `lpejbdjsrepwsxvqjzyv` (region: eu-west-1)

## Build, Test & Lint

```bash
npm run dev              # Dev server, port 3000
npm run build            # Production build (includes tsc)
npx tsc --noEmit         # Type-check only (should be zero errors)

# Tests (Vitest, jsdom environment)
npx vitest               # Run all tests in watch mode
npx vitest run           # Run all tests once
npx vitest run tests/utils/cardUtils.test.ts   # Run a single test file

# Formatting & Linting
npm run format           # Prettier — format all files
npm run format:check     # Prettier — check only (CI)
npx eslint .             # ESLint with TypeScript, React, and code quality plugins
```

## Environment Variables (`.env.local`, never commit)

- `VITE_SUPABASE_URL` (required) — Supabase project URL
- `VITE_SUPABASE_ANON_KEY` (required) — Supabase anon/public key
- `GEMINI_API_KEY`, `GEMINI_API_KEY_FALLBACK`, `ANTHROPIC_API_KEY` — only needed for local dev without Edge Functions

API keys are stored as **Supabase Edge Function secrets** (not in client bundle). Edge Functions proxy all AI calls.

## Key Architecture

### Edge Functions & API Layer

Two AI call patterns coexist. **`utils/api.ts`** defines pipeline wrappers; **`utils/ai.ts`** has legacy proxy calls.

| Edge Function | Client wrapper | Purpose | Local source |
|---|---|---|---|
| `generate-card` | `generateCardApi()` | Multi-agent card pipeline: synthesis → image → storage | `supabase/functions/generate-card/` |
| `generate-graphics` | `generateGraphicsApi()` | DocViz graphic generation: screenshot + prompt → Gemini image | `supabase/functions/generate-graphics/` |
| `chat-message` | `chatMessageApi()` | Gemini File Search RAG (primary) + Claude fallback. v22. | Remote only |
| `manage-stores` | `createStoreApi()`, `uploadDocumentToStoreApi()`, etc. | File Search Store CRUD + 3-step upload (Files API → ACTIVE → import). v7. | `supabase/functions/manage-stores/` |
| `retrieve-chunks` | `retrieveChunksApi()` | Chunk retrieval via Gemini (may be deprecated — chat-message handles internally) | `supabase/functions/retrieve-chunks/` |
| `manage-images` | `manageImagesApi()` | Image CRUD (delete, restore, history) | Remote only |
| `document-quality` | `documentQualityApi()` | DQAF v2: 3-stage quality assessment | `supabase/functions/document-quality/` |
| `claude-proxy` | `callClaude()` | Anthropic Messages API | Remote only (legacy) |
| `claude-files-proxy` | `uploadToFilesAPI()` | Anthropic Files API | Remote only (legacy — being phased out) |
| `gemini-proxy` | `callGeminiProxy()` | Google Gemini SDK (key rotation) | Remote only (legacy) |

All calls: auth token from `supabase.auth.getSession()`, JWT expiry checked with 30s buffer, auto-refresh.

### Multi-Agent Card Generation Pipeline

Three content generation paths exist, all feeding into the same image generation pipeline:

**Path 1 — Sources/Cards panel** (`hooks/useCardGeneration.ts` → `performSynthesis`):
- Claude synthesizes content client-side via `callClaude` (legacy proxy)
- Prompt requests XML output: `<card_content>` only (no layout directives at synthesis time)
- Directives generated on-the-fly via Gemini Flash before image generation

**Path 2 — Chat panel** (`hooks/useInsightsLab.ts` → `chatMessageApi`):
- Content generated server-side by `chat-message` Edge Function
- No layout directives at synthesis time (generated on-the-fly at image gen)

**Path 3 — SmartDeck** (`hooks/useSmartDeck.ts` → `chatMessageApi`):
- Full deck generated in one prompt via `chat-message` Edge Function
- Prompt built by `utils/smartDeck/prompt.ts` with LOD config from `utils/deckShared/constants.ts`
- No layout directives at synthesis time (generated on-the-fly at image gen)

**Image generation** (all paths converge in `generateCard` within `useCardGeneration.ts`):
1. Generates layout directives on-the-fly via Gemini Flash (`callGeminiProxy`) for all paths
2. Passes `layoutDirectives` to `generateCardApi()` → `generate-card` Edge Function
3. EF injects directives as instruction #5 in Gemini's XML-structured prompt
4. Layout directives are always generated for non-cover cards; cached in `card.layoutDirectivesMap[level]`

**Gemini prompt structure** (XML-tagged sections in `generate-card` EF):
- `<visual_style>` — role priming, style identity, palette, typography, canvas
- `<theme_context>` — domain, content nature, visualization paradigm, visual vocabulary
- `<instructions>` — 5 numbered rules (instruction #5 = layout directives or generic fallback)
- `<image_title>` — title spec with reserved height, font, size (% of canvas width), position; values injected from `TITLE_SPEC_TABLE` keyed by aspect ratio. Title is separated from body content to improve rendering consistency. Cover cards (TitleCard/TakeawayCard) skip this block. Bullet-point format (not sentence).
- `<exact_text_content>` — body content only (no title); markdown stripped of `#`, `##`, `**`

**Title spec table** (`TITLE_SPEC_TABLE` in `generate-card` EF):
- Maps aspect ratio → `{ reservedHeight, fontSize, x, y }` (all percentages)
- Landscape (16:9): 10% reserved, 3.2% font. Portrait (9:16): 6% reserved, 4.2% font.
- Font name + color injected from style settings (`fonts.primary`, `palette.text`)

**Content preparation** (`prepareContentBlock` in `generate-card` EF):
- Strips all markdown heading syntax (`#`, `##`, `###`) — Gemini renders `#` literally
- Strips bold markers (`**`) — Gemini renders `**` literally
- Title NOT included in content block (moved to `<image_title>` spec)

### Word Count & Token Limits (Aligned Across All Paths)

| Level | Word count | Token limit (Sources) | Token limit (Chat: content) | Chat: + suggestions headroom |
|---|---|---|---|---|
| Executive | 50-70 | 95 | 95 | 95 + 120 = 215 |
| Standard | 120-150 | 203 | 203 | 203 + 120 = 323 |
| Detailed | 250-300 | 405 | 405 | 405 + 120 = 525 |
| TitleCard | 15-25 | 150 | 150 | 150 + 120 = 270 |
| TakeawayCard | 40-60 | 350 | 350 | 350 + 120 = 470 |

Content token limits are now **aligned** across Sources and Chat (v12). Chat `maxTokens` = content limit + `SUGGESTIONS_HEADROOM` (120 tokens) so the model stays within word count while still having room for the `card-suggestions` fenced block. Word count ranges are identical across Sources (`contentGeneration.ts`), Chat (`chat-message` EF), and SmartDeck (`deckShared/constants.ts`).

**Chat card suggestions stripping**: Client-side `stripSuggestionsBlock()` in `ChatPanel.tsx` and defensive strips in `useCardOperations.ts` ensure the `card-suggestions` fenced block never contaminates `synthesisMap` storage.

### Card Folder System

`Nugget.cards` is `CardItem[]` — discriminated union of `Card | CardFolder`. Folders use `kind: 'folder'` with `isCardFolder()` type guard. Tree utilities in `utils/cardUtils.ts`. InsightsCardList renders folders with drag-and-drop using `VisibleItem[]` index.

**DOCX Export**: Folder kebab menu → "Download Content" exports selected cards as `.docx` via `utils/exportDocx.ts`. Uses `docx` + `file-saver` packages. Dual font system: Calibri (metadata/structure) + Cambria (card content). Includes cover section, documents log table, and per-card content with metadata tables. Prop threading: `App.tsx` → `CardsPanel` → `InsightsCardList`.

### Image Album System

Each card has an **album** per detail level — a collection of generated/modified images stored as `card_images` rows.
- **AlbumImage type**: `{ id, imageUrl, storagePath, label, isActive, createdAt, sortOrder }`
- **Card fields**: `albumMap` (all images), `activeImageMap` (displayed image URL)
- **DB**: `card_images` table with `is_active`, `label`, `sort_order` columns. Partial unique index enforces one active per album.
- **Server-managed**: `generate-card` EF inserts new album rows, `manage-images` EF handles CRUD
- **Show Generation Prompt**: Button in AssetsPanel displays the raw `lastPromptMap` data (monospace `<pre>` format) — the actual prompt text sent to Gemini for the active image. Shows empty state when no image has been generated. DocViz also displays `lastPrompt` per proposal inline. **Both gated behind `profile.devMode`** — only visible when the user's `dev_mode` column in `profiles` table is `true`.

### DocViz (Document Visualization)

`components/DocVizPanel.tsx` + `hooks/useDocViz.ts` — AI-powered document visual analysis and chart/diagram generation.

**Analysis pipeline**:
1. User selects a single document within the current nugget (separate from active documents in other panels)
2. Claude (via `claude-proxy` with extended thinking) analyses the document and proposes visuals with structured data
3. Proposals displayed in an expandable table: Section | Visual | Type (dropdown with alternatives) | Generate button
4. Analysis prompt: `utils/docviz/prompt.ts` — two-step reasoning (extract data first, then evaluate visual types)

**Image generation pipeline** (screenshot-based):
1. User clicks Generate → `html-to-image` captures the data section (subtitle + table) as a PNG screenshot
2. XML-structured prompt assembled with injections: visual type, title, subtitle, footnote, style (fonts, technique, composition, mood, palette, canvas from shared `stylingOptions`)
3. Screenshot image + text prompt sent to `generate-graphics` EF → Gemini Image renders the chart/diagram
4. No intermediate AI reformatting — Gemini reads the data directly from the screenshot

**Prompt structure** (`generate-graphics` EF, XML-tagged):
- `<visual_spec>` — visual type, title (`visual_title`), subtitle (`description`), footnote (`section_ref`), rendering rules
- `<visual_style>` — fonts (title + body), technique, composition, mood, palette, canvas orientation
- Screenshot image attached as inline data
- Prompt displayed inline per proposal (gated behind `profile.devMode`)

**DocViz proposal fields**: `section_ref` (document heading as footnote), `visual_title` (brief, type-agnostic — no visual type in title), `visual_type` (chart/diagram type), `description` (neutral one-line subtitle — no visual-type-specific language), `alternative_types`, `data` (headers + rows)

**Shared with Cards & Assets**: `StyleToolbar` component — same Style Studio, style selector, aspect ratio, resolution. Same `stylingOptions` on the nugget. Different prompt and generation pipeline.

**Persistence**: `docVizResult` stored as JSONB on the nugget record (same pattern as Chat messages). Survives refresh, logout, redeployment. Image URLs stored per proposal.

**DOCX Export**: `utils/exportDocViz.ts` — exports document markdown with generated images inserted at matching section locations. Section matching via `section_ref` (exact → contains → fuzzy). PDF documents converted to markdown on-the-fly via `convertPdfBase64ToMarkdown()`. Numbered figure captions, headers, footers, page numbers.

### 8-Panel Accordion Layout

Dashboard (when no project open) or workspace with 8 mutually exclusive panels controlled by `PanelTabBar`. Only one panel open at a time. **Default panel is Sources** — there is never a state where all panels are collapsed; toggling the active panel or pressing Escape falls back to Sources.

Panel order: Sources | Brief & Quality | Chat | SmartDeck | DocViz | Cards & Images | Composer. Portal overlays (`createPortal` to `document.body`). `expandedPanel` values: `'sources' | 'quality' | 'chat' | 'smart-deck' | 'docviz' | 'cards' | 'composer'`.

**Click-outside handler** (`App.tsx`): Resets to Sources when clicking outside panels. Excludes: `[data-panel-overlay]`, `[data-panel-strip]`, `[data-breadcrumb-dropdown]`, `header`, and portal-rendered `.fixed` elements.

**Nugget Tab Bar** (`NuggetTabBar.tsx`): Horizontal tabs for nugget selection within the open project. Each tab has a dropdown menu (Close Tab, Rename, Duplicate, Delete — no separate "x" close button). "+" button opens a dropdown: "Create new" (opens `NuggetCreationDialog`) or "Open existing" (shows closed tabs). Delete confirmation dialog at `z-[120]`. Managed by `useTabManagement` hook.

### Brief & Quality Panel Layout

`SubjectQualityPanel.tsx` — three side-by-side vertical columns (not tabs):
1. **Sources Log** (resizable via `useResizeDrag`, initial 400px, min 160, max 500) — "Status" sub-header + stats bar + log entries
2. **Subject & Brief** (flex-1) — subject textarea (auto-fit) + briefing fields (auto-fit)
3. **Assessment** (flex-1) — "Status" sub-header + Re-run button + verdict stats bar (fixed above scroll) + scrollable report

### Section Header Pattern

All panels share a consistent section header: `h-[36px]` with colored `w-[36px]` icon container (different blue shades per section), `bg-white dark:bg-zinc-900`, `border-b`, `text-[13px] font-bold uppercase tracking-wider`.

### Stats Bar Pattern

Sources Log and Assessment both use a compact stats bar: `rounded-lg px-3 py-1.5`, columns with `text-[8px]` labels + `text-[9-10px]` values, vertical `w-px h-5` dividers. Background: `bg-zinc-800` (dark) / `bg-zinc-100` (light). Stats bar is fixed above scrollable content (`shrink-0 px-4 pb-2` wrapper).

### Document Quality Assessment Framework (DQAF v2)

`hooks/useDocumentQualityCheck.ts` → `documentQualityApi()` → `document-quality` Edge Function. Three-stage pipeline:
- **Stage 1**: Relevance Profiling (5 dimensions, weighted scores per doc and per pair)
- **Stage 2**: Pass 1 (6 per-doc structural checks) + Pass 2 (5 cross-doc checks)
- **Stage 3**: KPI computation in code (not AI)

Requires `engagementPurpose` on Nugget. Returns `DQAFReport` with verdicts (ready/conditional/not_ready). Status: `null`/`'green'`/`'amber'`/`'red'`/`'stale'`. Rendered in `SubjectQualityPanel.tsx`.

### Sources Log & Subject Review

Document changes tracked via `appendDocChangeEvent()` in `AppContext.tsx`. Each event increments `rawEventSeq` on `Nugget.sourcesLogStats`.

**Toggle cancellation**: Enable/disable events for the same document cancel each other when un-checkpointed — removes opposite event, decrements `rawEventSeq`.

**Subject review flag** (`subjectReviewNeeded` on Nugget): Set `true` on real changes. Cleared by saving/regenerating subject or clicking "Keep" in SubjectQualityPanel. Independent from sources log — checkpointing the log does NOT clear the subject flag.

**FootnoteBar** (`components/FootnoteBar.tsx`): Dynamic notice bar between workspace and footer. Notices: pending source changes (amber), subject review needed (amber), quality stale (amber), quality issues (red). Each clickable — opens relevant panel.

### Auth Flow & App Entry

`index.tsx` → `AuthProvider` → `AuthGate` (local function, not a separate file):
- Pre-auth: `LandingPage` (marketing) or `AuthPage` (sign in/up) or `ProfileSetup` (one-time)
- Post-auth: `StorageProvider` → `ToastProvider` → `App`

When `openProjectId` is null, `App` renders `Dashboard.tsx`. When a project is open, the full workspace renders.

### Backend Architecture (Supabase)

- **Database**: PostgreSQL with RLS — tables: `profiles` (with `dev_mode` boolean), `projects`, `nuggets`, `documents`, `card_images`, `app_state`, `token_usage`, `custom_styles`. All rows scoped to `auth.uid() = user_id`.
- **Storage**: Two buckets: `pdfs` (native PDF files), `card-images` (generated card images). Path prefix: `{user_id}/`.
- **Storage Backend**: `utils/storage/SupabaseBackend.ts` implements `StorageBackend` interface. Cards stored as JSONB on nuggets table.
- **Supabase Client**: `utils/supabase.ts` — singleton `createClient` using env vars.

### Prompt Architecture

**Content synthesis** (`utils/prompts/contentGeneration.ts`):
- Strict format: only headings, short statements, bullet points, numbered lists, tables, quotes (`>`)
- No inline itemization ("x, y, z and w" must become bullet points)
- XML output format: `<card_content>` + `<layout_directives>` tags
- `parseDirectivesResponse()` in `useCardGeneration.ts` safely extracts both; falls back to raw content if tags missing

**Image generation** (`generate-card` EF):
- `prepareContentBlock()` strips markdown syntax (`#`, `##`, `**`) — Gemini renders them literally
- `assembleRendererPrompt()` builds XML-tagged prompt with `<visual_style>`, `<instructions>`, `<exact_text_content>`
- Layout directives injected as instruction #5 when available; generic "analyze logical relationships" fallback otherwise

**Anti-hallucination**: "Render ONLY the text provided" constraint. Content wrapped in `<exact_text_content>` tags. Domain/theme context in separate `<theme_context>` block.

**Subject generation** (`utils/subjectGeneration.ts`): 30-40 word domain-specific priming via `buildExpertPriming()`.

### Style Studio

`components/StyleStudioModal.tsx` — custom visual style editor. AI-generated or manual styles with palette, fonts, technique, composition, mood fields. Textareas auto-resize via `autoResize()` + refs. No `maxLength` HTML attribute — soft char limits enforced in `onChange` guards that allow deletions when over limit (AI generation can exceed limits). Styles persisted to `custom_styles` Supabase table. AI style generation (`generateStyleWithAI` in `ai.ts`) is instructed to use exact Google Fonts names for font fields.

### Generate Selected (Cards & Assets Panel)

"Generate Selected" button in AssetsPanel is **scoped to the active card's folder**. Uses `findParentFolder(allItems, activeCard.id)` to find the containing folder, then filters to selected cards within that folder only. Falls back to all selected cards if active card is at root level.

### SmartDeck Folder Naming

SmartDeck-generated folders are prefixed with `"Deck- "` followed by the nugget name (e.g., `"Deck- Market Analysis"`).

### Composer Panel

`components/ComposerPanel.tsx` — Export composition panel with branding support. Two-column layout: Settings (left, 280px fixed) and Cards (right, flex).

**Settings column:**
- Folder selector — dropdown to pick card folder for export
- Branding — logo upload (drag/drop or click, PNG/SVG/WebP), 9-point position grid, size slider (5-50%), opacity slider (10-100%). Logo composited onto images client-side via Canvas API at export time. Original images never modified.
- Footer — toggle + font size slider (0.8-2.5% of image width). Three-part layout: left (project — nugget), center (page number), right (date). Shown as overlay preview on thumbnails and zoom. Persisted as `HeaderFooterSettings` JSONB on `projects` table (`header_footer` column).
- Export buttons — DOCX (content), ZIP (images), PDF (images). All scoped to selected folder and selected images.

**Cards column:**
- Bento grid layout — cards displayed as blocks with thumbnails (170px), grouped by card. Select/deselect via checkboxes. Click thumbnail to zoom.
- Zoom overlay — shows full-size image with interactive logo overlay. User can drag logo to reposition and drag corner handle to resize. Per-image custom positions stored as `customOverrides` in `BrandingSettings`. "Apply to all" button copies current logo position/size to all selected images.

**Branding data model:**
- `BrandingSettings` on `Project` — `logoUrl`, `logoStoragePath`, `position` (9-point grid), `sizePercent`, `opacity`, `customOverrides` (per-image `LogoOverride`).
- `HeaderFooterSettings` on `Project` — `enabled`, `fontSize` (% of image width, default 1.2).
- Both persisted as JSONB columns (`branding`, `header_footer`) on `projects` table.
- When custom overrides exist, position grid shows "User defined (N)" with no highlighted position. Clicking a grid position shows confirmation dialog before clearing overrides.

**Export pipeline:**
- `exportImagesToZip` (`utils/exportImages.ts`) — fetches raw images, converts data URLs to blobs without `fetch()` (CSP-safe), packages as ZIP via JSZip
- `exportImagesToPdf` (`utils/exportImagesPdf.ts`) — one image per page, preserves aspect ratio, via jsPDF. Footer overlay (project-nugget, page number, date) when enabled.
- Both apply logo compositing via Canvas API when branding is active, respecting per-image overrides

### Annotation Workbench

`components/workbench/` — Canvas-based image annotation and modification. Types: pin, arrow, rectangle, sketch, text, zoom. State in `hooks/useAnnotations.ts`, version stack in `hooks/useVersionHistory.ts` (max 10). Modifications via `utils/modificationEngine.ts` → Gemini.

## Shared Utilities & Constants

### `utils/constants.ts` — Centralized configuration
- **Model names**: `CLAUDE_MODEL`, `GEMINI_IMAGE_MODEL`, `GEMINI_FLASH_MODEL` — single source of truth. Always import from here; never hardcode model strings.
- **Token budgets**: `CARD_TOKEN_LIMITS`, `COVER_TOKEN_LIMIT`, `CHAT_MAX_TOKENS`, `INITIATE_CHAT_MAX_TOKENS`
- **Retry config**: `API_MAX_RETRIES` (5), backoff/jitter/cap constants

### `utils/logger.ts` — Environment-aware logging
`createLogger('ModuleName')` returns `{ debug, log, info, warn, error }`. Debug/log/info suppressed in production. Use instead of raw `console.*`.

### `utils/documentResolution.ts` — Document filtering
`resolveEnabledDocs(docs)` — filters to enabled documents with content available. Use for AI-consumption filtering. Do NOT use for display-only counting (HeaderBar, PanelRequirements, SourcesManagerSidebar).

**Known gap**: `resolveOrderedDocs()` only checks content availability, does NOT check `enabled` flag.

### `hooks/useAbortController.ts` — Abort lifecycle
Shared by `useCardGeneration`, `useInsightsLab`, and `useSmartDeck`. Provides `create`, `createFresh`, `abort`, `clear`, `isAbortError`.

### Gemini Image Config
- `PRO_IMAGE_CONFIG` in `utils/ai.ts`: `thinkingLevel: 'Minimal'`, `responseModalities: ['TEXT', 'IMAGE']`
- Default resolution: `2K` (same token cost as 1K)
- `generate-card` EF uses `thinkingLevel: 'High'` for image generation

## App.tsx Structure (~1130 lines)

Main orchestrator. Renders `Dashboard` when no project open, full workspace otherwise. Consumes ~14 hooks for card generation, chat, quality checks, card/project/document/image operations, tab management, styling sync, token tracking, and Files API sync. Modals/Dialogs coordinated here: `PdfUploadChoiceDialog`, `PdfProcessorModal`, `StyleStudioModal`, `ZoomOverlay`, `FolderPickerDialog`, `UnsavedChangesDialog`.

## Z-Index Stacking (highest to lowest)

- Composer zoom overlay: `z-[130]`
- Folder context menu: `z-[130]`
- Modals/Dialogs: `z-[120]`
- Main Header: `z-[110]`
- Brief & Quality panel / Hard lock overlay: `z-[106]`
- Chat panel: `z-[105]` (strip `z-[2]`)
- SmartDeck panel: `z-[104]` (strip `z-[1]`)
- Composer panel: `z-[103]`
- DocViz panel: `z-[103]`
- Cards & Images: `z-[102]`
- FootnoteBar / Footer: `z-[102]`

## Code Modification Safety

* Never delete/modify code without searching the entire project for all references first.
* Before removing any function/export/file, confirm zero references across all files.
* Work in small batches. After each batch, run the build to confirm nothing is broken.
* If a build fails after a change, immediately revert before continuing.
* For work outside approved remediation batches, report planned changes and wait for approval.
* **When in doubt, leave it. Unused code costs nothing. A broken app costs everything.**

## UI Verification

Do NOT independently take screenshots from the preview server. If a screenshot is needed, ask the user to provide one. Console log checks and type-checking (`npx tsc --noEmit`) are fine to run independently.

## Known Tech Debt

- Backend API migration incomplete (synthesis still client-side via legacy `claude-proxy` for Sources path)
- `chat-message` EF deployed remotely only — no local source file
- Legacy `cardUrlMap`/`imageHistoryMap` types kept as deprecated for backward compat
- `resolveOrderedDocs()` doesn't check `enabled` flag
- Annotation workbench modifications create local album entries (no server-side storage upload yet)
- Hardcoded token cost rates in `useTokenUsage`

## Data Integrity Rules

* When adding a new field to a type that gets persisted, ensure both `save*()` and `load*()` in `SupabaseBackend.ts` include the field. Missing fields in upserts silently null out existing data.
* When renaming enum/union values (e.g., trigger types, status codes), migrate existing data in the DB — old values will crash the UI if the rendering code uses strict lookups without guards.
* The `TriggerConfig` map in `SubjectQualityPanel.tsx` must stay in sync with the `SourcesLogTrigger` type. Any new trigger value must be added to both.
* Project-nugget relationships are stored as `nugget_ids` on the `projects` table, NOT via `project_id` on `nuggets`. Always update the project's `nugget_ids` array when adding/removing nuggets.
