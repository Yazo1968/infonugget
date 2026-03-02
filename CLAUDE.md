# CLAUDE.md

## Project Overview

InfoNugget v6.1 — full-stack React app for AI-powered content card generation. Users organize work into Projects > Nuggets > Documents, then use AI to synthesize content cards with generated imagery.

- **Stack**: React 19 + TypeScript 5.8 + Vite 6 + Supabase (auth, DB, storage, edge functions) + Vercel (hosting)
- **AI**: Claude Sonnet 4.6 (via Edge Function proxy) + Gemini 3.1 Flash Image (via Edge Function proxy, model: `gemini-3.1-flash-image-preview`)
- **Auth**: Supabase Auth — email/password + Google OAuth (login required)
- **Persistence**: Supabase PostgreSQL + Storage (production), IndexedDB fallback (offline/legacy)
- **State**: React Context (5 focused contexts under `context/` + composition hook `useAppContext`), no Redux/Zustand
- **Entry**: `index.tsx` → `AuthProvider` → `AuthGate` → `StorageProvider` → `ToastProvider` → `AppProvider` → `App`
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

### 3-Phase Card Pipeline
Content Synthesis (Claude) → Layout Planning (Claude) → Image Generation (Gemini 3.1 Flash Image). See `hooks/useCardGeneration.ts`.

### Card Folder System
`Nugget.cards` is `CardItem[]` — discriminated union of `Card | CardFolder`. Folders use `kind: 'folder'` with `isCardFolder()` type guard. Tree utilities in `utils/cardUtils.ts`. InsightsCardList renders folders with drag-and-drop using `VisibleItem[]` index.

### Document Ownership
Documents belong to individual nuggets. Each has `sourceType`: `'markdown'` or `'native-pdf'`.

### 6-Panel Layout
Flex row: Projects | Sources | Chat | Auto-Deck | Cards | Assets. First 4 panels use strip buttons + portal overlays (`createPortal` to `document.body`). Shared logic in `hooks/usePanelOverlay.ts`.

### Backend Architecture (Supabase)
- **Auth**: `context/AuthContext.tsx` → Supabase Auth (email + Google OAuth). `AuthGate` in `index.tsx` gates app access.
- **Database**: PostgreSQL with RLS — tables: `profiles`, `projects`, `nuggets`, `documents`, `card_images`, `app_state`, `token_usage`, `custom_styles`. All rows scoped to `auth.uid() = user_id`.
- **Storage**: Two buckets: `pdfs` (native PDF files), `card-images` (generated card images). Path prefix: `{user_id}/`.
- **Edge Functions**: Three JWT-verified proxies — `claude-proxy` (Messages API), `claude-files-proxy` (Files API), `gemini-proxy` (Gemini SDK with key rotation). URLs constructed from `VITE_SUPABASE_URL`.
- **Storage Backend**: `utils/storage/SupabaseBackend.ts` implements `StorageBackend` interface (~47 methods). Cards stored as JSONB on nuggets table. Images uploaded to Storage bucket with signed URLs.
- **Supabase Client**: `utils/supabase.ts` — singleton `createClient` using `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`.

### Prompt Anti-Leakage
Content converted via `transformContentToTags()` — markdown to bracketed tags, font names to descriptors, hex to color names. Tag rendering instruction injected into image prompts to prevent Flash model from rendering `[TITLE]`, `[SECTION]` etc. as visible text. See `utils/prompts/promptUtils.ts`.

## Shared Utilities & Constants

### `utils/constants.ts` — Centralized configuration
- **Model names**: `CLAUDE_MODEL`, `GEMINI_IMAGE_MODEL`, `GEMINI_FLASH_MODEL` — single source of truth for all AI model identifiers. Always import from here; never hardcode model strings.
- **Retry config**: `API_MAX_RETRIES`, `RETRY_BACKOFF_BASE_MS`, `RETRY_JITTER_MAX_MS`, `RETRY_DELAY_CAP_MS`
- **Token budgets**: `CARD_TOKEN_LIMITS` (keyed by detail level), `COVER_TOKEN_LIMIT`, `CHAT_MAX_TOKENS`

### `utils/logger.ts` — Environment-aware logging
`createLogger('ModuleName')` returns `{ debug, log, info, warn, error }`. Debug/log/info are suppressed in production builds. All modules use this instead of raw `console.*`.

### `utils/documentResolution.ts` — Document filtering
`resolveEnabledDocs(docs)` — filters to enabled documents with content available (content, fileId, or pdfBase64). Use for AI-consumption filtering. Do NOT use for display-only counting (HeaderBar, PanelRequirements, SourcesManagerSidebar) where processing-in-progress documents should still appear.

### `hooks/useAbortController.ts` — Abort lifecycle management
Shared `useAbortController()` hook used by `useCardGeneration`, `useInsightsLab`, and `useAutoDeck`. Provides `create`, `createFresh`, `abort`, `clear`, and `isAbortError`.

### AI Call Routing
All AI calls go through Supabase Edge Function proxies (no client-side API keys):
- **Claude**: `callClaude()` in `utils/ai.ts` → `claude-proxy` Edge Function → Anthropic Messages API
- **Claude Files**: `uploadToFilesAPI()` / `deleteFromFilesAPI()` → `claude-files-proxy` Edge Function → Anthropic Files API
- **Gemini**: `callGeminiProxy()` in `utils/ai.ts` → `gemini-proxy` Edge Function → Google Gemini SDK (server-side)
- Auth token from `supabase.auth.getSession()` passed as `Authorization: Bearer` header

### Gemini Image Config
`PRO_IMAGE_CONFIG` in `utils/ai.ts` — shared config spread into every Gemini image generation call. `thinkingLevel: 'Minimal'` (title case per Google docs), `responseModalities: ['TEXT', 'IMAGE']`. Default resolution: `2K` (same token cost as 1K: 1120 tokens). Image config (`aspectRatio`, `imageSize`) set per-call in `useCardGeneration.ts`.

## App.tsx Structure (~974 lines)

App.tsx is the main orchestrator. Several concerns are extracted into dedicated hooks and components:

- **`components/HeaderBar.tsx`** — Breadcrumb navigation, dark mode toggle, usage dropdown. Contains its own local state (dropdown visibility, refs, click-outside effects).
- **`hooks/useTabManagement.ts`** — Tab bar state, sync with project nuggets, tab CRUD handlers.
- **`hooks/useStylingSync.ts`** — Bidirectional toolbar ↔ nugget styling sync. Uses `skipStylingWritebackRef` to prevent feedback loops.

## Code Modification Safety

* Never delete/modify code without searching the entire project for all references first.
* Before removing any function/export/file, confirm zero references across all files.
* Work in small batches. After each batch, run the build to confirm nothing is broken.
* If a build fails after a change, immediately revert before continuing.
* For work outside approved remediation batches, report planned changes and wait for approval.
* **When in doubt, leave it. Unused code costs nothing. A broken app costs everything.**

## UI Verification

Do NOT independently test the app or take screenshots. Advise the user to test, or ask them to navigate so you can screenshot.
