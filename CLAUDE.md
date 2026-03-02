# CLAUDE.md

## Project Overview

InfoNugget v6.0 — client-side React SPA for AI-powered content card generation. Users organize work into Projects > Nuggets > Documents, then use AI to synthesize content cards with generated imagery.

- **Stack**: React 19 + TypeScript 5.8 + Vite 6, no backend
- **AI**: Claude Sonnet 4.6 (text/chat via browser fetch) + Gemini Flash/Pro Image (`@google/genai` SDK)
- **Persistence**: IndexedDB (`infonugget-db`), auto-save with debounce
- **State**: React Context (split contexts under `context/`), no Redux/Zustand
- **Entry**: `index.tsx` → `StorageProvider` → `ToastProvider` → `App`

## Build & Run

```bash
npm run dev       # Dev server, port 3000
npm run build     # Production build
npx tsc --noEmit  # Type-check only
```

**Ignore pre-existing TS errors** in `AutoDeckPanel.tsx` and `reference files (unused)/contentGeneration.backup.ts`.

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

## Code Modification Safety

* Never delete/modify code without searching the entire project for all references first.
* Before removing any function/export/file, confirm zero references across all files.
* Work in small batches. After each batch, run the build to confirm nothing is broken.
* If a build fails after a change, immediately revert before continuing.
* For work outside approved remediation batches, report planned changes and wait for approval.
* **When in doubt, leave it. Unused code costs nothing. A broken app costs everything.**

## UI Verification

Do NOT independently test the app or take screenshots. Advise the user to test, or ask them to navigate so you can screenshot.
