# Session Memory

## Recent Changes (2026-03-24)

### Image Generation Pipeline — Screenshot-Based
- Replaced text-based layout directives with screenshot-based approach
- Card content rendered as HTML, screenshotted via `html-to-image`, sent to Gemini as inline image
- Layout directives generation removed entirely (no more on-the-fly Gemini Flash call)
- Layout directives no longer cached — each generation is fresh
- Screenshot preview button in toolbar (dev mode only)
- Long paragraphs auto-split at sentence boundaries in screenshot CSS
- `generate-card` EF updated: new prompt structure with `<visual_style>`, `<theme_context>`, `<image_title_specs>` (no title text), screenshot as inline data
- Cover cards (TitleCard/TakeawayCard) still use text-based prompt

### SmartDeck Improvements
- Domain-expert role priming in prompt: "You are a top tier expert in the domain of {domain first line}"
- Content significance hierarchy analysis (primary/secondary/supportive)
- "Let AI suggest" button: single API call returns card count recommendations for all 3 LODs
- LOD selector redesigned as unified table (LOD | Min | Max) with AI suggestions
- Expert judgment elevated as overarching factor in card count suggestion prompt
- Renamed: Cover Card → Title Card, Closing Card → Takeaway Card
- Word counts updated: Executive 60-80, Standard 120-170, Detailed 250-300

### DocViz — Two-Column Layout + Section-Scoped Analysis
- Two-column layout: sections list (left 300px) + visual analysis (right)
- Sections derived from document bookmarks (H1 headings)
- One section analyzed at a time — centered "Analyse Section" button when not yet analyzed
- Analysis via `chat-message` EF with `docviz_analyse` action (extended thinking, Files API)
- Section results merge incrementally with existing proposals
- Section kebab menu: Download JSON, Delete
- Proposal row kebab menu: Generate/Regenerate, Rename (inline edit), Delete
- Generate dropdown in toolbar: Generate Active, Generate Selected
- Inline error banner preserves existing proposals on failure
- Removed: Document Section column (redundant with section name in header)

### Edit Mode Cleanup
- Removed dead content-modification path (executeContentModification, buildContentModificationPrompt)
- Removed experimental visual spec / JSON extraction feature
- Simplified annotation workbench to annotation + global instruction only

### Bug Fixes
- Fixed nugget auto-select: guard effect in AppContext ensures valid nugget selected when project opens
- Fixed project deletion errors: NOT NULL constraint on cards, removed legacy image_history column refs
- Fixed deletion cleanup: removed unsupported delete_all_albums EF action
- Debounced heading parse in editor (300ms) to reduce typing lag on large documents

### UI/UX
- NuggetCreationDialog simplified: name input only, removed document upload zone
- Sources log: individual changes now show when the document action occurred (not just checkpoint time)
- Dashboard kebab menu: fixed transparency and z-index stacking issues

## Supabase Deployment Notes
- `chat-message` EF now has local source at `supabase/functions/chat-message/index.ts`
- Deploy via: `npx supabase functions deploy chat-message --project-ref lpejbdjsrepwsxvqjzyv --no-verify-jwt`
- `generate-card` EF also deployed with `--no-verify-jwt` (handles auth internally via `verifyUser()`)
- Supabase CLI installed as dev dependency (`npm install supabase --save-dev`)

## User Preferences
- Per CLAUDE.md: do NOT independently take screenshots from preview server — ask user to provide
- Console log checks and type-checking are fine to run independently
- User prefers explicit commit/push requests rather than automatic commits
