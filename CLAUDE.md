# CLAUDE.md

## Project Overview

InfoNugget v6.0 — client-side React SPA for AI-powered content card generation. Users organize work into Projects > Nuggets > Documents, then use AI to synthesize content cards with generated imagery.

- **Stack**: React 19 + TypeScript 5.8 + Vite 6, no backend
- **AI**: Claude Sonnet 4.6 (text/chat via browser fetch) + Gemini Flash/Pro Image (`@google/genai` SDK)
- **Persistence**: IndexedDB (`infonugget-db`), auto-save with debounce
- **State**: React Context (5 focused contexts under `context/` + composition hook `useAppContext`), no Redux/Zustand
- **Entry**: `index.tsx` → `StorageProvider` → `ToastProvider` → `AppProvider` → `App`

## Build & Run

```bash
npm run dev       # Dev server, port 3000
npm run build     # Production build
npx tsc --noEmit  # Type-check only (should be zero errors)
```

## Environment Variables (`.env.local`, never commit)

- `GEMINI_API_KEY` (required), `GEMINI_API_KEY_FALLBACK` (optional), `ANTHROPIC_API_KEY` (required)

## Key Architecture

### 3-Phase Card Pipeline
Content Synthesis (Claude) → Layout Planning (Claude) → Image Generation (Gemini Pro Image). See `hooks/useCardGeneration.ts`.

### Card Folder System
`Nugget.cards` is `CardItem[]` — discriminated union of `Card | CardFolder`. Folders use `kind: 'folder'` with `isCardFolder()` type guard. Tree utilities in `utils/cardUtils.ts`. InsightsCardList renders folders with drag-and-drop using `VisibleItem[]` index.

### Document Ownership
Documents belong to individual nuggets. Each has `sourceType`: `'markdown'` or `'native-pdf'`.

### 6-Panel Layout
Flex row: Projects | Sources | Chat | Auto-Deck | Cards | Assets. First 4 panels use strip buttons + portal overlays (`createPortal` to `document.body`). Shared logic in `hooks/usePanelOverlay.ts`.

### Prompt Anti-Leakage
Content converted via `transformContentToTags()` — markdown to bracketed tags, font names to descriptors, hex to color names. See `utils/prompts/promptUtils.ts`.

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
