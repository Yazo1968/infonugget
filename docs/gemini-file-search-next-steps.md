# Gemini File Search — Next Steps

## What's Working
- **Gemini File Search Store**: create, delete, upload, import (manage-stores EF v7)
- **Chat**: Gemini direct RAG — no Claude middleman (chat-message EF v22)
- **Domain generation**: via Gemini File Search
- **Briefing generation**: via Gemini File Search
- **SmartDeck**: passes geminiStoreName, Gemini handles retrieval
- **DocViz**: passes geminiStoreName, Gemini handles retrieval
- **Status indicator**: spinner (importing) → green dot (ready) → red dot (error) in Sources panel

## Outstanding Issues

### 1. Spinner doesn't resolve to green dot
- The manage-stores EF polls until ACTIVE + import done, but takes 20+ seconds
- If the document is already in the store (from a previous upload), the upload is redundant
- **Fix**: Before uploading, call `list-documents` to check if the document is already in the store. Skip upload if it exists. Set green dot immediately.

### 2. TOC extraction — manual trigger needed
- Automatic TOC extraction was removed (was crashing the pipeline)
- Need a "Generate TOC" button in the bookmarks panel
- On click: send prompt to Gemini File Search via chat-message EF, parse response into bookmarks
- The prompt that works (tested in Chat): "I need the document table of the actual detailed table of content including main sections, sub-sections, sub-sub sections etc."
- Display the response as-is in the bookmarks panel (rendered markdown table)
- Consider: structured output (responseMimeType + responseJsonSchema) for clean JSON — but test if it works with File Search tool first

### 3. Duplicate uploads to same store
- Each upload creates a NEW file in Gemini Files API + imports to store
- Multiple uploads of the same document create duplicates in the store (confirmed: 3 docs in one store)
- **Fix**: Check by display name before uploading. If exists, skip.

### 4. Legacy code cleanup
- Files API (`claude-files-proxy`, `claude-files-proxy` EF, `uploadToFilesAPI`) still called in parallel
- Remove Files API upload from the fast path (only keep as fallback for nuggets without a store)
- Remove `retrieveChunksApi` calls (replaced by Gemini direct in chat-message EF)
- Clean up `parseHeadingsFromResponse` function (no longer used)
- Remove debug toasts and console logs added during development

### 5. SmartDeck needs comprehensive retrieval
- Currently sends one query — Gemini retrieves relevant chunks for that query
- SmartDeck needs full document coverage for deck generation
- May need: multiple queries, or a very broad system prompt that tells Gemini to use all available content

### 6. Token/cost tracking gap
- Gemini File Search calls (via chat-message EF) return `inputTokens` and `outputTokens`
- But the `manage-stores` EF calls (upload, import) are not tracked
- Embedding costs ($0.15/1M tokens at indexing) not reflected in the meter

### 7. Supabase dev branch cleanup
- Dev branch `file-search-migration` (xtpmutfvizpfhnflnoxq) still exists
- Cost: $0.01344/hour
- Delete when migration is stable

## Architecture Reference

```
Upload PDF
  → Supabase Storage (raw file, display)
  → manage-stores EF: upload to Gemini Files API → poll ACTIVE → import to File Search Store
  → Green dot when ready

Query (Chat, SmartDeck, DocViz, Domain, Briefing)
  → chat-message EF: Gemini generateContent with fileSearch tool
  → Gemini reads documents natively from store
  → Returns response directly (no Claude)
  → Claude only used as legacy fallback (no geminiStoreName)
```

## Edge Functions

| EF | Version | Purpose |
|---|---|---|
| manage-stores | v7 | Store CRUD + 3-step file upload (upload → ACTIVE → import) |
| retrieve-chunks | v2 | Chunk retrieval (may be deprecated — chat-message handles retrieval internally) |
| chat-message | v22 | Gemini direct RAG when geminiStoreName provided, Claude fallback otherwise |
| generate-card | v67 | Unchanged — needs migration to use Gemini for content synthesis |
| document-quality | v14 | Unchanged — needs migration |
