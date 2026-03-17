# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

InfoNugget v6.1 — full-stack React app for AI-powered content card generation. Users organize work into Projects > Nuggets > Documents, then use AI to synthesize content cards with generated imagery.

- **Stack**: React 19 + TypeScript 5.8 + Vite 6 + Tailwind CSS 4 + Supabase (auth, DB, storage, edge functions) + Vercel (hosting)
- **AI Models**: Claude Sonnet 4.6 (content synthesis, chat, quality) + Gemini 3.1 Flash Image (`gemini-3.1-flash-image-preview`, image generation) + Gemini 2.5 Flash (PDF conversion/heading extraction)
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
| `chat-message` | `chatMessageApi()` | Chat + card content generation via Claude | Remote only |
| `manage-images` | `manageImagesApi()` | Image CRUD (delete, restore, history) | Remote only |
| `document-quality` | `documentQualityApi()` | DQAF v2: 3-stage quality assessment | `supabase/functions/document-quality/` |
| `claude-proxy` | `callClaude()` | Anthropic Messages API | Remote only (legacy) |
| `claude-files-proxy` | `uploadToFilesAPI()` | Anthropic Files API | Remote only (legacy) |
| `gemini-proxy` | `callGeminiProxy()` | Google Gemini SDK (key rotation) | Remote only (legacy) |

All calls: auth token from `supabase.auth.getSession()`, JWT expiry checked with 30s buffer, auto-refresh.

### Multi-Agent Card Generation Pipeline

Three content generation paths exist, all feeding into the same image generation pipeline:

**Path 1 — Sources/Cards panel** (`hooks/useCardGeneration.ts` → `performSynthesis`):
- Claude synthesizes content client-side via `callClaude` (legacy proxy)
- Prompt requests XML output: `<card_content>` + `<layout_directives>` tags
- `parseDirectivesResponse()` extracts content and layout directives
- Directives stored on card's `layoutDirectivesMap`

**Path 2 — Chat panel** (`hooks/useInsightsLab.ts` → `chatMessageApi`):
- Content generated server-side by `chat-message` Edge Function
- No layout directives at synthesis time (generated on-the-fly at image gen)

**Path 3 — Auto-Presentor** (`hooks/useAutoPresentor.ts` → `chatMessageApi`):
- Full deck generated in one prompt via `chat-message` Edge Function
- Prompt built by `utils/autoPresentor/prompt.ts` with LOD config from `utils/deckShared/constants.ts`
- No layout directives at synthesis time (generated on-the-fly at image gen)

**Image generation** (all paths converge in `generateCard` within `useCardGeneration.ts`):
1. Reads `layoutDirectivesMap` for pre-stored directives
2. If none exist (Chat, Auto-Presentor, older cards), generates directives on-the-fly via a small Claude call
3. Passes `layoutDirectives` to `generateCardApi()` → `generate-card` Edge Function
4. EF injects directives as instruction #5 in Gemini's XML-structured prompt
5. Feature flag: `LAYOUT_DIRECTIVES_ENABLED` in `useCardGeneration.ts` — set to `false` to revert to generic instructions

**Gemini prompt structure** (XML-tagged sections in `generate-card` EF):
- `<visual_style>` — role priming, style identity, palette, typography, canvas
- `<theme_context>` — domain, content nature, visualization paradigm, visual vocabulary
- `<instructions>` — 5 numbered rules (instruction #5 = layout directives or generic fallback)
- `<exact_text_content>` — card title + synthesized content (markdown stripped of `#`, `##`, `**`)

**Content preparation** (`prepareContentBlock` in `generate-card` EF):
- Strips all markdown heading syntax (`#`, `##`, `###`) — Gemini renders `#` literally
- Strips bold markers (`**`) — Gemini renders `**` literally
- Title passed as plain text, not markdown heading

### Word Count & Token Limits (Aligned Across All Paths)

| Level | Word count | Token limit (Sources) | Token limit (Chat) |
|---|---|---|---|
| Executive | 50-70 | 95 | 250 |
| Standard | 120-150 | 203 | 400 |
| Detailed | 250-300 | 405 | 600 |
| TitleCard | 15-25 | 150 | 150 |
| TakeawayCard | 40-60 | 350 | 350 |

Chat token limits are higher to accommodate the card-suggestions block appended to card responses. Word count ranges are identical across Sources (`contentGeneration.ts`), Chat (`chat-message` EF), and Auto-Presentor (`deckShared/constants.ts`).

### Card Folder System

`Nugget.cards` is `CardItem[]` — discriminated union of `Card | CardFolder`. Folders use `kind: 'folder'` with `isCardFolder()` type guard. Tree utilities in `utils/cardUtils.ts`. InsightsCardList renders folders with drag-and-drop using `VisibleItem[]` index.

### Image Album System

Each card has an **album** per detail level — a collection of generated/modified images stored as `card_images` rows.
- **AlbumImage type**: `{ id, imageUrl, storagePath, label, isActive, createdAt, sortOrder }`
- **Card fields**: `albumMap` (all images), `activeImageMap` (displayed image URL)
- **DB**: `card_images` table with `is_active`, `label`, `sort_order` columns. Partial unique index enforces one active per album.
- **Server-managed**: `generate-card` EF inserts new album rows, `manage-images` EF handles CRUD
- **Show Generation Prompt**: Button in AssetsPanel displays the actual `lastPromptMap` data — the real prompt sent to Gemini for the active image. Shows empty state when no image has been generated.

### 5-Panel Accordion Layout

Dashboard (when no project open) or workspace with 5 mutually exclusive panels controlled by `PanelTabBar`. Only one panel open at a time. **Default panel is Sources** — there is never a state where all panels are collapsed; toggling the active panel or pressing Escape falls back to Sources.

Panel order: Sources | Brief & Quality | Chat | Auto-Presentor | Cards & Assets. Portal overlays (`createPortal` to `document.body`). `expandedPanel` values: `'sources' | 'quality' | 'chat' | 'auto-presentor' | 'cards'`.

**Click-outside handler** (`App.tsx`): Resets to Sources when clicking outside panels. Excludes: `[data-panel-overlay]`, `[data-panel-strip]`, `[data-breadcrumb-dropdown]`, `header`, and portal-rendered `.fixed` elements.

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

- **Database**: PostgreSQL with RLS — tables: `profiles`, `projects`, `nuggets`, `documents`, `card_images`, `app_state`, `token_usage`, `custom_styles`. All rows scoped to `auth.uid() = user_id`.
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
Shared by `useCardGeneration`, `useInsightsLab`, and `useAutoPresentor`. Provides `create`, `createFresh`, `abort`, `clear`, `isAbortError`.

### Gemini Image Config
- `PRO_IMAGE_CONFIG` in `utils/ai.ts`: `thinkingLevel: 'Minimal'`, `responseModalities: ['TEXT', 'IMAGE']`
- Default resolution: `2K` (same token cost as 1K)
- `generate-card` EF uses `thinkingLevel: 'High'` for image generation

## App.tsx Structure (~1020 lines)

Main orchestrator. Renders `Dashboard` when no project open, full workspace otherwise. Consumes ~14 hooks for card generation, chat, quality checks, card/project/document/image operations, tab management, styling sync, token tracking, and Files API sync. Modals/Dialogs coordinated here: `PdfUploadChoiceDialog`, `PdfProcessorModal`, `StyleStudioModal`, `ZoomOverlay`, `FolderPickerDialog`, `UnsavedChangesDialog`.

## Z-Index Stacking (highest to lowest)

- Folder context menu: `z-[130]`
- Modals/Dialogs: `z-[120]`
- Main Header: `z-[110]`
- Brief & Quality panel / Hard lock overlay: `z-[106]`
- Chat panel: `z-[105]` (strip `z-[2]`)
- Auto-Presentor panel: `z-[104]` (strip `z-[1]`)
- Cards/Assets: `z-[103]`
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
