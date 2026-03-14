# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

InfoNugget v6.1 — full-stack React app for AI-powered content card generation. Users organize work into Projects > Nuggets > Documents, then use AI to synthesize content cards with generated imagery.

- **Stack**: React 19 + TypeScript 5.8 + Vite 6 + Tailwind CSS 4 + Supabase (auth, DB, storage, edge functions) + Vercel (hosting)
- **AI**: Claude Sonnet 4.6 (via Edge Function proxies) + Gemini 3.1 Flash Image (via Edge Function proxy, model: `gemini-3.1-flash-image-preview`) + Gemini 2.5 Flash (PDF conversion/heading extraction)
- **Auth**: Supabase Auth — email/password + Google OAuth (login required)
- **Persistence**: Supabase PostgreSQL + Storage (production), IndexedDB fallback (legacy)
- **State**: React Context (5 focused contexts under `context/` + composition hook `useAppContext`), no Redux/Zustand
- **Entry**: `index.tsx` → `AuthProvider` → `AuthGate` (local fn) → `LandingPage` | `AuthPage` | `ProfileSetup` | `StorageProvider` → `ToastProvider` → `App`
- **Production URL**: `https://infonugget.vercel.app`

## Build, Test & Lint

```bash
npm run dev              # Dev server, port 3000
npm run build            # Production build (includes tsc)
npx tsc --noEmit         # Type-check only (should be zero errors)

# Tests (Vitest, jsdom environment, 8 test files under tests/)
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

### Backend API Migration (In Progress)

Two AI call patterns coexist. **`utils/api.ts`** defines the new pipeline wrappers; **`utils/ai.ts`** has legacy proxy calls.

| Edge Function | Client wrapper | Purpose | Status |
|---|---|---|---|
| `generate-card` | `generateCardApi()` | Full card pipeline: synthesis → image → storage | Migrated |
| `manage-images` | `manageImagesApi()` | Image CRUD (delete, restore, history) | Migrated |
| `chat-message` | `chatMessageApi()` | Chat + card content via Claude | Migrated |
| `auto-deck` | `autoDeckApi()` | Plan/revise/finalize/produce | Migrated |
| `document-quality` | `documentQualityApi()` | DQAF v2 assessment: 3-stage quality pipeline | Migrated |
| `claude-proxy` | `callClaude()` | Anthropic Messages API | Legacy — still used for synthesis, doc ops |
| `claude-files-proxy` | `uploadToFilesAPI()` | Anthropic Files API | Legacy |
| `gemini-proxy` | `callGeminiProxy()` | Google Gemini SDK (key rotation) | Legacy — modification engine, PDF conversion |

Only `generate-card` and `document-quality` have local source under `supabase/functions/`. The other Edge Functions are deployed remotely only.

All calls: auth token from `supabase.auth.getSession()`, JWT expiry checked with 30s buffer, auto-refresh.

### Card Generation Pipeline

Content Synthesis (Claude, client-side) → Image Generation + Storage (server-side via `generate-card`). Layout planning has been removed — Gemini handles visualization directly. See `hooks/useCardGeneration.ts`. Images are stored as signed Supabase Storage URLs (not blob URLs).

Content synthesis enforces a strict format across ALL detail levels (Executive, Standard, Detailed). Only allowed: short statements, bullet points, numbered lists, tables, quotes (`>`). No inline itemization ("x, y, z and w" must become bullet points). Word counts: Executive 70-100, Standard 200-250, Detailed 450-500. See `utils/prompts/contentGeneration.ts`.

Single-card generation triggers `FolderPickerDialog` for folder placement. Existing card regen bypasses the picker. Batch generation creates folders programmatically.

### Card Folder System

`Nugget.cards` is `CardItem[]` — discriminated union of `Card | CardFolder`. Folders use `kind: 'folder'` with `isCardFolder()` type guard. Tree utilities in `utils/cardUtils.ts`. InsightsCardList renders folders with drag-and-drop using `VisibleItem[]` index.

### 5-Panel Accordion Layout

Dashboard (when no project open) or workspace with 5 mutually exclusive panels controlled by `PanelTabBar`. Only one panel open at a time. **Default panel is Sources** — there is never a state where all panels are collapsed; toggling the active panel or pressing Escape falls back to Sources.

Panel order: Sources | Brief & Quality | Chat | Auto-Deck | Cards & Assets. Portal overlays (`createPortal` to `document.body`). `expandedPanel` values: `'sources' | 'quality' | 'chat' | 'auto-deck' | 'cards'`.

**Click-outside handler** (`App.tsx`): Resets to Sources when clicking outside panels. Excludes: `[data-panel-overlay]`, `[data-panel-strip]`, `[data-breadcrumb-dropdown]`, `header`, and portal-rendered `.fixed` elements.

### Brief & Quality Panel Layout

`SubjectQualityPanel.tsx` — three side-by-side vertical columns (not tabs):
1. **Sources Log** (resizable via `useResizeDrag`, initial 400px, min 160, max 500) — "Status" sub-header + stats bar + log entries
2. **Subject & Brief** (flex-1) — subject textarea (auto-fit) + briefing fields (auto-fit)
3. **Assessment** (flex-1) — "Status" sub-header + Re-run button + verdict stats bar (fixed above scroll) + scrollable report

Resize divider between Sources Log and Subject & Brief (draggable). Static divider between Subject & Brief and Assessment. Status-colored panel border via `effectiveStatus`.

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

### Prompt Anti-Leakage & Anti-Hallucination

Content prepared via `prepareContentBlock()` in `utils/prompts/promptUtils.ts` — strips H1 headings, collapses blank lines, preserves native markdown. Image generation uses a 4-section master prompt template with strict content constraints. Subject generation (`utils/subjectGeneration.ts`) creates 30-40 word domain-specific priming via `buildExpertPriming()`.

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
Shared by `useCardGeneration`, `useInsightsLab`, and `useAutoDeck`. Provides `create`, `createFresh`, `abort`, `clear`, `isAbortError`.

### Gemini Image Config
`PRO_IMAGE_CONFIG` in `utils/ai.ts` — `thinkingLevel: 'Minimal'` (title case per Google docs), `responseModalities: ['TEXT', 'IMAGE']`, default resolution `2K`.

## App.tsx Structure (~1020 lines)

Main orchestrator. Renders `Dashboard` when no project open, full workspace otherwise. Consumes ~14 hooks for card generation, chat, quality checks, card/project/document/image operations, tab management, styling sync, token tracking, and Files API sync. Modals/Dialogs coordinated here: `PdfUploadChoiceDialog`, `PdfProcessorModal`, `StyleStudioModal`, `ZoomOverlay`, `FolderPickerDialog`, `UnsavedChangesDialog`.

## Z-Index Stacking (highest → lowest)

- Folder context menu: `z-[130]`
- Modals/Dialogs: `z-[120]`
- Main Header: `z-[110]`
- Brief & Quality panel / Hard lock overlay: `z-[106]`
- Chat panel: `z-[105]` (strip `z-[2]`)
- Auto-Deck panel: `z-[104]` (strip `z-[1]`)
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
