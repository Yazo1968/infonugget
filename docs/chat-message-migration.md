# chat-message Edge Function — Chunk-Based Retrieval Migration

The `chat-message` Edge Function is deployed remotely only (no local source). This document describes the changes required to support chunk-based retrieval alongside the existing Files API path.

## Current State

- The EF accepts `documents: ChatMessageDocument[]` with optional `fileId` per document
- Documents with `fileId` are injected as Files API document blocks in the Claude Messages API call
- Documents without `fileId` fall back to inline content

## Required Changes

### 1. Accept `retrievedChunks` in request body

Add an optional `retrievedChunks` field to the request body:

```typescript
interface RetrievedChunk {
  text: string;
  documentId: string;
  documentName: string;
  chunkIndex: number;
  relevanceScore?: number;
}
```

The client already sends this field — see `ChatMessageRequest.retrievedChunks` in `utils/api.ts`.

### 2. Build user message with chunks when provided

When `retrievedChunks` is present and non-empty, inject chunks as inline text context instead of Files API document blocks:

```typescript
if (retrievedChunks && retrievedChunks.length > 0) {
  // Format chunks as inline context
  const chunkContext = retrievedChunks.map((c) =>
    `--- Chunk from "${c.documentName}" ---\n${c.text}\n--- End Chunk ---`
  ).join('\n\n');
  const preamble = 'The following are relevant excerpts from the source documents.\n\n';
  // Prepend to user message text
  userText = preamble + chunkContext + '\n\n' + userText;
  // Do NOT add Files API document blocks
} else {
  // Legacy: use Files API document blocks as before
}
```

### 3. Keep Files API fallback

When `retrievedChunks` is absent or empty, the existing Files API path must continue to work unchanged. Both paths coexist.

### 4. Skip `files-api-2025-04-14` beta header when using chunks

When chunks are provided, the `anthropic-beta` header should not include `files-api-2025-04-14` since no Files API document blocks are being sent.

### 5. Actions for all chat actions

Apply chunk-based context for these actions:
- `send_message` — regular chat messages
- `initiate_chat` — initial chat setup
- `compact` — conversation compaction (may not need document context)
- `docviz_analyse` — DocViz analysis (uses custom system prompt)

For `docviz_analyse`, chunks should be injected the same way since it uses the same document context pattern.

## Client-Side Integration

The client (`hooks/useInsightsLab.ts`, `hooks/useSmartDeck.ts`, `hooks/useDocViz.ts`) will need to:
1. Check `nugget.geminiStoreName` before calling `chatMessageApi`
2. Call `retrieveChunksApi` with appropriate query text
3. Pass retrieved chunks in the `retrievedChunks` field of the request

This is a separate task from the EF changes.
