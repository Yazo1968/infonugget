# CLAUDE.md

## Project Overview

InfoNugget v6.1 — full-stack React app for AI-powered content card generation. Users organize work into Projects > Nuggets > Documents, then use AI to synthesize content cards with generated imagery.

- **Stack**: React 19 + TypeScript 5.8 + Vite 6 + Tailwind CSS 4 + Supabase (auth, DB, storage, edge functions) + Vercel (hosting)
- **AI**: Claude Sonnet 4.6 (via Edge Function proxies) + Gemini 3.1 Flash Image (via Edge Function proxy, model: `gemini-3.1-flash-image-preview`) + Gemini 2.5 Flash (PDF conversion/heading extraction)
- **Auth**: Supabase Auth — email/password + Google OAuth (login required)
- **Persistence**: Supabase PostgreSQL + Storage (production), IndexedDB fallback (legacy)
- **State**: React Context (5 focused contexts under `context/` + composition hook `useAppContext`), no Redux/Zustand
- **Entry**: `index.tsx` → `AuthProvider` → `AuthGate` (local fn) → `LandingPage` | `AuthPage` | `ProfileSetup` | `StorageProvider` → `ToastProvider` → `App`
- **Production URL**: `https://infonugget.vercel.app`

## Build & Run

```bash
npm run dev       # Dev server, port 3000
npm run build     # Production build
npx tsc --noEmit  # Type-check only (should be zero errors)
```

## Environment Variables (`.env.local`, never commit)

- `VITE_SUPABASE_URL` (required) — Supabase project URL
- `VITE_SUPABASE_ANON_KEY` (required) — Supabase anon/public key
- `GEMINI_API_KEY`, `GEMINI_API_KEY_FALLBACK`, `ANTHROPIC_API_KEY` — only needed for local dev without Edge Functions

API keys are stored as **Supabase Edge Function secrets** (not in client bundle). Edge Functions proxy all AI calls.

## Key Architecture

### Backend API Migration (In Progress)

The app is transitioning from client-side AI calls to server-side Edge Function pipelines. **`utils/api.ts`** defines five backend API wrappers:

| Edge Function | Client wrapper | Purpose |
|---|---|---|
| `generate-card` | `generateCardApi()` | Full card pipeline: synthesis → layout → image → storage |
| `manage-images` | `manageImagesApi()` | Image CRUD (delete, restore, history) |
| `chat-message` | `chatMessageApi()` | Chat + card content via Claude (prompt building server-side) |
| `auto-deck` | `autoDeckApi()` | Plan/revise/finalize/produce (prompt building server-side) |
| `document-quality` | `documentQualityApi()` | DQAF v2 assessment: 3-stage quality pipeline (profiling, checks, KPIs) |

**Already migrated** to new APIs: card image generation, chat, auto-deck, document quality assessment.
**Still using old proxies** (`callClaude` via `claude-proxy`): content synthesis (Phase 1), document operations.

**Note**: Only `generate-card` and `document-quality` have local source under `supabase/functions/`. The other Edge Functions (`manage-images`, `chat-message`, `auto-deck`) are deployed remotely and do not have local source in this repo.

### 3-Phase Card Pipeline
Content Synthesis (Claude, client-side) → Layout Planning + Image Generation + Storage (server-side via `generate-card`). See `hooks/useCardGeneration.ts`. Images are stored as signed Supabase Storage URLs (not blob URLs).

### Card Folder System
`Nugget.cards` is `CardItem[]` — discriminated union of `Card | CardFolder`. Folders use `kind: 'folder'` with `isCardFolder()` type guard. Tree utilities in `utils/cardUtils.ts`. InsightsCardList renders folders with drag-and-drop using `VisibleItem[]` index.

### Document Ownership
Documents belong to individual nuggets. Each has `sourceType`: `'markdown'` or `'native-pdf'`.

### Document Quality Assessment Framework (DQAF v2)
`hooks/useDocumentQualityCheck.ts` — runs DQAF assessment via `documentQualityApi()` → `document-quality` Edge Function. Three-stage pipeline:
- **Stage 1**: Relevance Profiling — 5-dimension profiling (Objective 30%, Focus 25%, Audience 20%, Type 15%, Tone 10%), Score A per doc, Score B per pair
- **Stage 2**: Pass 1 (6 per-doc structural checks P1-01–P1-06) + Pass 2 (5 cross-doc checks P2-02–P2-06)
- **Stage 3**: KPI computation in code (not AI) — documentRelevanceRate, internalIntegrityRate, crossDocumentConsistencyScore, versionConfidenceRate, structuralCoherenceRate, overallSetReadinessScore

Requires `engagementPurpose` field on Nugget. Returns `DQAFReport` with verdicts (ready/conditional/not_ready). Effective status: `null`/`'green'`/`'amber'`/`'red'`/`'stale'`. Rendered in `components/SubjectQualityPanel.tsx` as a combined subject-editing + quality dashboard panel with internal sidebar (Set Overview, Per Document Detail, Conflicts & Flags, Document Register, Sources Log).

Legacy `QualityReport` type kept as `@deprecated` — old reports auto-detected as stale.

### Annotation Workbench
`components/workbench/` — Canvas-based image annotation and modification system. Components: `AnnotationWorkbench.tsx`, `AnnotationToolbar.tsx`, `AnnotationEditorPopover.tsx`, `CanvasRenderer.ts`. Annotation types: pin, arrow, rectangle, sketch, text, zoom. Uses `hooks/useAnnotations.ts` (state) and `hooks/useVersionHistory.ts` (image version stack, max 10). Modification executed via `utils/modificationEngine.ts` → Gemini.

### Sources Log & Subject Review
Document changes (add, remove, enable, disable, content update) are tracked via `appendDocChangeEvent()` in `AppContext.tsx`. Each event increments `rawEventSeq` on the nugget's `sourcesLogStats`. Pending changes shown in `FootnoteBar` and `SubjectQualityPanel`.

**Toggle cancellation**: Enable/disable events for the same document cancel each other when un-checkpointed (e.g., disable then re-enable = no net change). On cancellation, `rawEventSeq` is decremented and the opposite event is removed from the log.

**Subject review flag** (`subjectReviewNeeded` on Nugget): Set to `true` by `appendDocChangeEvent` on real changes. Cleared by saving or regenerating the subject, or by clicking "Keep" in the subject editor within `SubjectQualityPanel`. On toggle cancellation with no remaining pending changes, the flag also clears. Independent from the sources log — checkpointing the log does NOT clear the subject flag.

**FootnoteBar** (`components/FootnoteBar.tsx`): Thin dynamic notice bar between workspace and footer. Notices: pending source changes (amber), subject review needed (amber), quality stale (amber), quality issues (red). Each notice is clickable — opens the relevant modal/panel. Renders nothing when no notices exist.

### 5-Panel Accordion Layout
Dashboard (when no project open) or workspace with 5 mutually exclusive panels controlled by `PanelTabBar` strip buttons. Only one panel open at a time. **Default panel is Sources** — there is never a state where all panels are collapsed; toggling the active panel or pressing Escape falls back to Sources.

Panel order (left to right): Sources | Brief & Quality | Chat | Auto-Deck | Cards & Assets. Portal overlays (`createPortal` to `document.body`). Shared logic in `hooks/usePanelOverlay.ts`. `expandedPanel` values: `'sources' | 'quality' | 'chat' | 'auto-deck' | 'cards'`.

### ChiselLoader Animation
`components/ChiselLoader.tsx` — branded mining/chisel animation replaces the old spinner during image generation in `AssetsPanel.tsx`. Converted from `logo_animatedt.html`. Features: SVG path morphing (5 frames), crack effects, canvas particle debris, shimmer, conveyor belt slide transitions. Dark-mode aware via `darkMode` prop (colors adapt: rock `#4e4e52`, debris `#a1a1aa`/`#6d6d73`, cracks `#71717a`/`#52525b`; light mode: rock `#262626`). Mining-themed status messages cycle below the animation.

### Auth Flow & Entry Point
`index.tsx` renders: `AuthProvider` → `AuthGate` (local function, not a separate file). AuthGate handles three pre-auth states:
- **Landing** → `LandingPage` (marketing page with CTAs)
- **Sign In/Up** → `AuthPage` (email + Google OAuth)
- **Profile Setup** → `ProfileSetup` (one-time display_name entry for new users)

After auth + profile check: `StorageProvider` → `ToastProvider` → `App`.

### Dashboard vs Workspace
When `openProjectId` is null, `App` renders `Dashboard.tsx` (project cards, create project, user menu). When a project is open, the full workspace renders.

### Backend Architecture (Supabase)
- **Auth**: `context/AuthContext.tsx` → Supabase Auth (email + Google OAuth). `AuthGate` in `index.tsx` gates app access.
- **Database**: PostgreSQL with RLS — tables: `profiles`, `projects`, `nuggets`, `documents`, `card_images`, `app_state`, `token_usage`, `custom_styles`. All rows scoped to `auth.uid() = user_id`.
- **Storage**: Two buckets: `pdfs` (native PDF files), `card-images` (generated card images). Path prefix: `{user_id}/`.
- **Edge Functions (proxies)**: `claude-proxy` (Messages API), `claude-files-proxy` (Files API), `gemini-proxy` (Gemini SDK with key rotation). Used for direct AI calls.
- **Edge Functions (pipelines)**: `generate-card`, `manage-images`, `chat-message`, `auto-deck`, `document-quality`. Handle full pipelines server-side. Called via `utils/api.ts`.
- **Storage Backend**: `utils/storage/SupabaseBackend.ts` implements `StorageBackend` interface. Cards stored as JSONB on nuggets table. Images uploaded to Storage bucket with signed URLs.
- **Supabase Client**: `utils/supabase.ts` — singleton `createClient` using `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`.

### Prompt Anti-Leakage
Content converted via `transformContentToTags()` — markdown to bracketed tags, font names to descriptors, hex to color names. Tag rendering instruction injected into image prompts to prevent Flash model from rendering `[TITLE]`, `[SECTION]` etc. as visible text. See `utils/prompts/promptUtils.ts`.

## Shared Utilities & Constants

### `utils/constants.ts` — Centralized configuration
- **Model names**: `CLAUDE_MODEL` (`claude-sonnet-4-6`), `GEMINI_IMAGE_MODEL` (`gemini-3.1-flash-image-preview`), `GEMINI_FLASH_MODEL` (`gemini-2.5-flash`) — single source of truth. Always import from here; never hardcode model strings.
- **Retry config**: `API_MAX_RETRIES` (5), `RETRY_BACKOFF_BASE_MS`, `RETRY_JITTER_MAX_MS`, `RETRY_DELAY_CAP_MS`
- **Token budgets**: `CARD_TOKEN_LIMITS` (TitleCard=150, TakeawayCard=350, Executive=143, Standard=338, Detailed=663), `COVER_TOKEN_LIMIT` (256), `CHAT_MAX_TOKENS` (8192), `INITIATE_CHAT_MAX_TOKENS` (512)

### `utils/logger.ts` — Environment-aware logging
`createLogger('ModuleName')` returns `{ debug, log, info, warn, error }`. Debug/log/info are suppressed in production builds. All modules use this instead of raw `console.*`.

### `utils/documentResolution.ts` — Document filtering
`resolveEnabledDocs(docs)` — filters to enabled documents with content available (content, fileId, or pdfBase64). Use for AI-consumption filtering. Do NOT use for display-only counting (HeaderBar, PanelRequirements, SourcesManagerSidebar) where processing-in-progress documents should still appear.

### `hooks/useAbortController.ts` — Abort lifecycle management
Shared `useAbortController()` hook used by `useCardGeneration`, `useInsightsLab`, and `useAutoDeck`. Provides `create`, `createFresh`, `abort`, `clear`, and `isAbortError`.

### AI Call Routing
Two patterns coexist during the backend migration:

**New pipeline APIs** (via `utils/api.ts`):
- `generateCardApi()` → `generate-card` Edge Function (layout + image + storage)
- `chatMessageApi()` → `chat-message` Edge Function (chat, prompt building server-side)
- `autoDeckApi()` → `auto-deck` Edge Function (plan/revise/finalize/produce)
- `manageImagesApi()` → `manage-images` Edge Function (image CRUD)
- `documentQualityApi()` → `document-quality` Edge Function (DQAF v2 assessment)

**Legacy proxy calls** (via `utils/ai.ts`):
- `callClaude()` → `claude-proxy` Edge Function → Anthropic Messages API (still used for synthesis, document ops)
- `uploadToFilesAPI()` / `deleteFromFilesAPI()` → `claude-files-proxy` → Anthropic Files API
- `callGeminiProxy()` → `gemini-proxy` → Google Gemini SDK (still used for modification engine, PDF conversion)

All calls: auth token from `supabase.auth.getSession()`, JWT expiry checked with 30s buffer, auto-refresh.

### Gemini Image Config
`PRO_IMAGE_CONFIG` in `utils/ai.ts` — shared config for Gemini image generation calls. `thinkingLevel: 'Minimal'` (title case per Google docs), `responseModalities: ['TEXT', 'IMAGE']`. Default resolution: `2K` (same token cost as 1K: 1120 tokens).

### Token Usage Tracking
`hooks/useTokenUsage.ts` — tracks token consumption and cost per AI call. Cost rates: Claude Sonnet 4.6 at $3/$15 input/output per 1M tokens; Gemini image at $0.25/$0.067. Debounce-saves totals to storage backend. `recordUsage` callback passed to all AI-calling hooks.

## App.tsx Structure (~1000 lines)

App.tsx is the main orchestrator. Renders `Dashboard` when no project is open, full workspace otherwise. Key hooks consumed:

- `useTokenUsage` — cost tracking
- `useCardGeneration` — 3-phase card pipeline
- `useStylingSync` — bidirectional toolbar ↔ nugget styling sync
- `useInsightsLab` — chat + Claude API
- `useDocumentQualityCheck` — document quality analysis
- `useCardOperations` — card CRUD
- `useAutoDeck` — auto-deck planning + production
- `useProjectOperations` — project/nugget creation, duplication, copy/move
- `useDocumentOperations` — document CRUD, content generation
- `useImageOperations` — zoom, reference image, image CRUD, downloads
- `useTabManagement` — tab bar state, sync with project nuggets
- `useNuggetCloseTracker` — records `nugget_last_closed_at` on navigation
- `useFilesApiSync` — re-uploads documents with null fileId on nugget open

Extracted components: `HeaderBar`, `NuggetTabBar`, `PanelTabBar`, `SubjectQualityPanel`.
Modals/Dialogs: `PdfUploadChoiceDialog`, `PdfProcessorModal`, `StyleStudioModal`, `ZoomOverlay`, `FolderPickerDialog`, `UnsavedChangesDialog`.

## Important Files

### Components
- `App.tsx` (~1000 lines) — Main orchestrator, panel layout, modal coordination
- `components/AssetsPanel.tsx` — Image generation area, ChiselLoader animation, reference images, prompt view
- `components/AuthPage.tsx` — Login/signup (email + Google OAuth)
- `components/AutoDeckPanel.tsx` — Auto-Deck briefing and review
- `components/CardRow.tsx` — Individual card row in InsightsCardList
- `components/CardsPanel.tsx` — Card editor with TipTap
- `components/ChatPanel.tsx` — Chat interface
- `components/ChiselLoader.tsx` — Branded mining animation for image generation loading state
- `components/Dashboard.tsx` — Project dashboard (shown when no project is open)
- `components/Dialogs.tsx` — Shared dialogs: `ManifestModal`, `UnsavedChangesDialog`, `DocumentChangeNotice`, `ReferenceMismatchDialog`
- `components/DocumentEditorModal.tsx` — Full-screen markdown document editor
- `components/ErrorBoundary.tsx` — React error boundary wrapper
- `components/FindReplaceBar.tsx` — Find & replace toolbar for document editor
- `components/FolderPickerDialog.tsx` — Folder selection dialog for card moves
- `components/FolderRow.tsx` — Folder row in InsightsCardList
- `components/FootnoteBar.tsx` — Dynamic workspace status notices (pending source changes, subject review, quality issues)
- `components/FormatToolbar.tsx` — TipTap formatting toolbar
- `components/HeaderBar.tsx` — Workspace header, dark mode, usage dropdown
- `components/InsightsCardList.tsx` — Card list sidebar with folder support, drag-and-drop
- `components/LandingPage.tsx` — Pre-auth marketing page
- `components/LoadingScreen.tsx` — App loading spinner
- `components/LogoIcon.tsx` — SVG logo component
- `components/NuggetCreationDialog.tsx` — Nugget creation form
- `components/NuggetTabBar.tsx` — Nugget tab strip for open project
- `components/PanelRequirements.tsx` — Panel prerequisite checks (e.g., "add documents first")
- `components/PanelTabBar.tsx` — 5-panel strip buttons (Sources, Brief & Quality, Chat, Auto-Deck, Cards & Assets)
- `components/PdfProcessorModal.tsx` — PDF processor (viewer + bookmarks + actions)
- `components/PdfUploadChoiceDialog.tsx` — PDF upload method selection
- `components/PdfViewer.tsx` — PDF rendering component
- `components/ProfileSetup.tsx` — One-time profile setup for new users
- `components/SourcesManagerSidebar.tsx` — Document list sidebar in Sources panel
- `components/SourcesPanel.tsx` — PDF viewer, TOC editing with draft mode
- `components/StorageProvider.tsx` — Initializes storage backend, provides `storage` singleton
- `components/StyleStudioModal.tsx` — Visual style configuration
- `components/SubjectQualityPanel.tsx` — Combined subject editing + DQAF quality dashboard + sources log (replaces old separate QualityPanel/SubjectEditModal/SourcesLogModal)
- `components/ToastNotification.tsx` — Toast notification system (`useToast` hook)
- `components/ZoomOverlay.tsx` — Full-screen image zoom
- `components/workbench/` — Annotation system: `AnnotationWorkbench`, `AnnotationToolbar`, `AnnotationEditorPopover`, `CanvasRenderer`

### Hooks
- `hooks/useAbortController.ts` — Shared abort lifecycle
- `hooks/useAnnotations.ts` — Annotation state (pins, arrows, rectangles, sketches)
- `hooks/useAutoDeck.ts` — Auto-Deck via `autoDeckApi`
- `hooks/useCardGeneration.ts` — 3-phase pipeline (synthesis client-side, rest server-side)
- `hooks/useCardOperations.ts` — Card/folder CRUD
- `hooks/useDocumentEditing.ts` — Document editor state and save logic
- `hooks/useDocumentFindReplace.ts` — Find & replace state for document editor
- `hooks/useDocumentOperations.ts` — Document CRUD, content generation
- `hooks/useDocumentQualityCheck.ts` — DQAF v2 assessment via `documentQualityApi`
- `hooks/useFilesApiSync.ts` — Re-uploads documents with null fileId to Files API
- `hooks/useFocusTrap.ts` — Focus trap for modals/dialogs
- `hooks/useImageOperations.ts` — Image CRUD, zoom, downloads (single + ZIP)
- `hooks/useInsightsLab.ts` — Chat via `chatMessageApi`
- `hooks/useNuggetCloseTracker.ts` — Records `nugget_last_closed_at` timestamp
- `hooks/usePanelOverlay.ts` — Shared overlay panel logic (animation, resize, positioning)
- `hooks/usePersistence.ts` — Debounced auto-save to storage backend
- `hooks/useProjectOperations.ts` — Project/nugget creation, duplication, copy/move
- `hooks/useResizeDrag.ts` — Drag-to-resize for panel overlays
- `hooks/useStylingSync.ts` — Bidirectional toolbar ↔ nugget styling sync
- `hooks/useTabManagement.ts` — Tab bar state, sync with project nuggets
- `hooks/useTokenUsage.ts` — Token/cost tracking with storage persistence
- `hooks/useVersionHistory.ts` — Image version stack (max 10 entries)

### Utils
- `utils/api.ts` — Backend Edge Function wrappers (generateCardApi, chatMessageApi, autoDeckApi, manageImagesApi, documentQualityApi)
- `utils/ai.ts` — Legacy AI clients, retry logic, Files API helpers, PRO_IMAGE_CONFIG, DEFAULT_STYLING
- `utils/cardUtils.ts` — Tree-manipulation utilities for CardItem[]
- `utils/constants.ts` — Model names, retry config, token budgets
- `utils/documentHash.ts` — Content hashing for change detection
- `utils/documentResolution.ts` — Document filtering for AI consumption
- `utils/fileProcessing.ts` — File reading/processing helpers
- `utils/formatTime.ts` — Time/date formatting utilities
- `utils/geometry.ts` — Path simplification for sketch annotations
- `utils/logger.ts` — Environment-aware logging
- `utils/markdown.ts` — Markdown parsing/rendering helpers
- `utils/modificationEngine.ts` — Image modifications via Gemini (annotation workbench)
- `utils/naming.ts` — Unique name generation, name collision check
- `utils/pdfBookmarks.ts` — PDF bookmark extraction and processing
- `utils/pdfLoader.ts` — PDF.js loading and initialization
- `utils/redline.ts` — Redline map generation from annotations
- `utils/sanitize.ts` — HTML sanitization for rendered content
- `utils/subjectGeneration.ts` — AI-powered subject/brief generation
- `utils/supabase.ts` — Supabase client singleton
- `utils/tokenEstimation.ts` — Token count estimation for prompts
- `utils/autoDeck/` — Auto-deck parsers (`parsers.ts`) and constants (`constants.ts`)
- `utils/prompts/` — Prompt builders: `contentGeneration`, `coverGeneration`, `documentConversion`, `imageGeneration`, `promptUtils`
- `utils/storage/StorageBackend.ts` — `StorageBackend` interface definition
- `utils/storage/SupabaseBackend.ts` — Supabase persistence (primary)
- `utils/storage/IndexedDBBackend.ts` — IndexedDB persistence (legacy/fallback)
- `utils/storage/serialize.ts` — Serialization helpers

### Context
- `context/AppContext.tsx` — Composition hook `useAppContext()` + `AppProvider` (wraps all 5 sub-contexts internally)
- `context/AuthContext.tsx` — Supabase Auth state, session management, `useAuth()` hook
- `context/ProjectContext.tsx` — Project state + operations
- `context/NuggetContext.tsx` — Nugget state + operations
- `context/SelectionContext.tsx` — Selection state (project/nugget/doc IDs, `selectionLevel`, `selectEntity`)
- `context/StyleContext.tsx` — Styling options + dark mode
- `context/ThemeContext.tsx` — Theme provider

### Types
- `types.ts` — All interfaces. Key types: `Card`, `CardFolder`, `CardItem`, `Nugget` (includes `subjectReviewNeeded`, `sourcesLogStats`, `docChangeLog`, `engagementPurpose`, `dqafReport`), `Project`, `Document`, `StylingOptions`, `DetailLevel`, `DQAFReport`, `DQAFDocumentAssessment`, `DQAFKPIs`, `DQAFCrossDocFinding`, `DQAFCompatibilityRecord`, `DQAFProductionNotice`, `Annotation` (union), `AutoDeckBriefing`, `ParsedPlan`, `PlannedCard`, `SourcesLogStats`, `DocChangeEvent`. Legacy: `QualityReport` (@deprecated)

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

Do NOT independently test the app or take screenshots. Advise the user to test, or ask them to navigate so you can screenshot.
