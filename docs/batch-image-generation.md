# Batch Image Generation — Reference Document

## Why Batch Mode Matters for InfoNugget

Image generation is the most token-expensive operation in the app. At current rates:

| Resolution | Tokens per image |
|---|---|
| 512 (0.5K) | 747 |
| 1K | 1,120 |
| 2K | 1,120 |
| 4K | 2,000 |

A SmartDeck run generating 15 cards at 2K = 15 x 1,120 = **16,800 image tokens** alone. Add Claude synthesis, Gemini Flash layout directives, and quality checks — a single deck easily hits 25-30k tokens. Multiple decks per day burns through a paid user's budget quickly.

**Batch API offers 50% discount** on all token costs. If image generation is ~60% of total cost, batch mode effectively cuts the overall bill by ~30%.

---

## Gemini Batch API Overview

- **Async processing**: Submit jobs, retrieve results later
- **SLA**: Up to 24 hours (small batches typically complete in minutes)
- **Pricing**: 50% discount vs standard API
- **Throughput**: Millions of requests per job
- **SDK**: `google-genai` >= 1.34.0 (Python), `@google/genai` (JS)

### Compatible Image Models

- `gemini-3.1-flash-image-preview` (current app model — Nano Banana 2)
- `gemini-3-pro-image-preview` (Nano Banana Pro)
- `gemini-2.5-flash-image` (Nano Banana)
- **NOT compatible**: Imagen, Lyria, Veo

### Job States

| State | Meaning |
|---|---|
| `JOB_STATE_PENDING` | Queued, awaiting processing |
| `JOB_STATE_SUCCEEDED` | Completed successfully |
| `JOB_STATE_FAILED` | Processing failed |
| `JOB_STATE_CANCELLED` | Cancelled by user |

---

## Two Submission Methods

### Method 1: File-Based (Recommended for Large Batches)

Best for SmartDeck or Generate Selected with many cards.

**Step 1 — Prepare JSONL input file:**

Each line is a JSON object with a unique `key` and a standard `GenerateContentRequest`:

```jsonl
{"key": "card_1", "request": {"contents": [{"parts": [{"text": "Render an infographic card..."}]}], "generationConfig": {"responseModalities": ["TEXT", "IMAGE"], "imageConfig": {"aspectRatio": "3:2", "imageSize": "2K"}}}}
{"key": "card_2", "request": {"contents": [{"parts": [{"text": "Render an infographic card..."}]}], "generationConfig": {"responseModalities": ["TEXT", "IMAGE"], "imageConfig": {"aspectRatio": "3:2", "imageSize": "2K"}}}}
```

**Step 2 — Upload to Files API:**

```python
uploaded = client.files.upload(
    file='batch_requests.jsonl',
    config=types.UploadFileConfig(display_name='smartdeck-batch')
)
```

**Step 3 — Create batch job:**

```python
job = client.batches.create(
    model="gemini-3.1-flash-image-preview",
    src=uploaded.name,
    config={'display_name': 'smartdeck-deck-1'}
)
```

**Step 4 — Poll for completion:**

```python
while True:
    job = client.batches.get(name=job.name)
    if job.state.name in ('JOB_STATE_SUCCEEDED', 'JOB_STATE_FAILED', 'JOB_STATE_CANCELLED'):
        break
    time.sleep(30)
```

**Step 5 — Download results:**

```python
result_bytes = client.files.download(file=job.dest.file_name)
result_text = result_bytes.decode('utf-8')
for line in result_text.splitlines():
    parsed = json.loads(line)
    # parsed['key'] matches your card ID
    # parsed['response']['candidates'][0]['content']['parts'] contains image data
```

### Method 2: Inline (Convenient for Small Batches)

Best for Generate Selected with 2-5 cards.

```python
requests = [
    {'contents': [{'parts': [{'text': 'Render card 1...'}]}]},
    {'contents': [{'parts': [{'text': 'Render card 2...'}]}]},
]

job = client.batches.create(
    model="gemini-3.1-flash-image-preview",
    src=requests,
    config={'display_name': 'generate-selected-batch'}
)

# After completion:
for resp in job.dest.inlined_responses:
    if resp.response:
        # Extract image from response parts
        pass
    elif resp.error:
        # Handle per-request errors
        pass
```

---

## Multimodal Batch Requests (Images as Input)

The app sends screenshots in some flows (DocViz, annotation workbench modifications). Batch mode supports this via the Files API:

**Step 1 — Upload all input images first:**

```python
uploaded_screenshot = client.files.upload(file="screenshot_card_1.jpg")
```

**Step 2 — Reference in batch request:**

```jsonl
{"key": "card_1", "request": {"contents": [{"parts": [{"text": "Create a chart from this data..."}, {"file_data": {"file_uri": "files/abc123", "mime_type": "image/jpeg"}}]}]}}
```

**Important**: Each input image must be uploaded separately before building the JSONL. For a SmartDeck with 15 cards each needing a screenshot, that's 15 upload calls before the batch submission.

---

## Image Output Format

Gemini returns images as base64-encoded inline data. The model chooses the output format (typically JPEG for infographic content). There is no `outputMimeType` parameter — the `ImageConfig` only supports:

- `aspectRatio`: "1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9", "1:4", "4:1", "1:8", "8:1"
- `imageSize`: "512", "1K", "2K", "4K"

The response MIME type is in `part.inlineData.mimeType` (usually `image/jpeg`).

---

## Integration Architecture for InfoNugget

### Current Flow (Sequential)

```
User triggers SmartDeck/Generate Selected
  → For each card:
    → Claude synthesizes content (client-side or chat-message EF)
    → Gemini Flash generates layout directives (gemini-proxy)
    → generate-card EF: Gemini renders image → uploads to Supabase Storage → inserts card_images row
  → User sees cards appear one by one
```

### Proposed Batch Flow

```
User triggers SmartDeck/Generate Selected
  → Claude synthesizes all card content (same as today)
  → Gemini Flash generates all layout directives (same as today)
  → NEW: Batch submission Edge Function:
    1. Build JSONL from all cards' prompts + directives
    2. Upload any input images to Gemini Files API
    3. Submit batch job via client.batches.create()
    4. Store job ID in database (new table: batch_jobs)
    5. Return job ID to client
  → Client shows "Generating images in background..." UI
  → NEW: Batch polling mechanism (options):
    a. Client polls a status endpoint every 30s
    b. Supabase Realtime subscription on batch_jobs table
    c. Edge Function cron job that polls and updates
  → When batch completes:
    1. Download results
    2. Extract images, upload each to Supabase Storage
    3. Insert card_images rows
    4. Update batch_jobs status
    5. Client receives notification / updates UI
```

### New Infrastructure Needed

| Component | Purpose |
|---|---|
| `batch_jobs` DB table | Track job ID, status, card mappings, created_at, completed_at |
| `submit-batch` Edge Function | Build JSONL, upload files, create batch job, return job ID |
| `poll-batch` Edge Function | Check job status, download results, store images when complete |
| Client-side batch status UI | Progress indicator, notification when complete |
| `useBatchStatus` hook | Poll or subscribe for batch job updates |

### Database Schema (Proposed)

```sql
CREATE TABLE batch_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  nugget_id TEXT NOT NULL,
  job_name TEXT NOT NULL,          -- Gemini batch job name
  display_name TEXT,
  status TEXT DEFAULT 'pending',   -- pending, processing, succeeded, failed, cancelled
  card_mappings JSONB NOT NULL,    -- [{key: "card_1", cardId: "...", detailLevel: "Standard"}]
  total_cards INT NOT NULL,
  completed_cards INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  error TEXT,
  CONSTRAINT batch_jobs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);

ALTER TABLE batch_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their own batch jobs"
  ON batch_jobs FOR ALL USING (auth.uid() = user_id);
```

---

## When to Use Batch vs Real-Time

| Scenario | Cards | Recommendation |
|---|---|---|
| Single card generation | 1 | Real-time (current flow) |
| Generate Selected (2-3 cards) | 2-3 | Real-time (latency matters more than cost) |
| Generate Selected (4+ cards) | 4+ | Batch (inline method) |
| SmartDeck full deck | 10-30 | Batch (file-based method) |
| Re-generate all images in folder | varies | Batch if 4+ |

### Decision Logic

```
if (cardCount === 1) → real-time
else if (cardCount <= 3) → real-time
else → batch (with user notification that images will generate in background)
```

The threshold of 3 is a suggestion — should be tuned based on actual latency experience. Small batches (5-10 items) typically complete in 1-5 minutes, not hours.

---

## UX Considerations

1. **Don't make batch a user toggle** — decide automatically based on card count
2. **Show clear status**: "Generating 15 images in background..." with progress updates
3. **Allow navigation**: User should be able to work on other things while batch runs
4. **Notify on completion**: Toast notification + update card thumbnails
5. **Handle partial failures**: Some cards in a batch may fail — show which ones and allow retry
6. **Cancel support**: User should be able to cancel a pending batch job

---

## API Methods Reference

| Method | Purpose | JS SDK |
|---|---|---|
| `client.batches.create()` | Create batch job | `ai.batches.create({model, src, config})` |
| `client.batches.get()` | Check job status | `ai.batches.get({name})` |
| `client.batches.list()` | List recent jobs | `ai.batches.list({config: {pageSize}})` |
| `client.batches.cancel()` | Cancel a job | `ai.batches.cancel({name})` |
| `client.files.upload()` | Upload JSONL/images | `ai.files.upload({file, config})` |
| `client.files.download()` | Download results | `ai.files.download({file})` |

---

## Cost Analysis Example

Assuming a paid user generates 5 SmartDecks per week, each with 15 cards at 2K resolution:

| | Real-Time | Batch | Savings |
|---|---|---|---|
| Tokens per deck | 15 x 1,120 = 16,800 | Same | — |
| Cost per deck | 16,800 tokens x rate | 16,800 tokens x rate x 0.5 | 50% |
| Weekly (5 decks) | 84,000 tokens | 84,000 tokens (half price) | 42,000 tokens worth |
| Monthly | 336,000 tokens | 336,000 tokens (half price) | 168,000 tokens worth |

The savings scale linearly with usage. For heavy users, batch mode can cut the image generation bill in half.

---

## Open Questions for Implementation

1. **JS SDK support**: The batch examples in the docs are Python-heavy. Need to verify `@google/genai` JS SDK has full batch support for Edge Functions (Deno runtime).
2. **Edge Function timeout**: Polling within a single EF invocation won't work (timeout limits). Need a separate polling mechanism.
3. **Files API in Deno**: Verify file upload/download works in Supabase Edge Function Deno runtime.
4. **Prompt structure**: The current `generate-card` EF assembles prompts with XML tags. The batch JSONL would need the same prompt assembly logic extracted into a shared function.
5. **Album integration**: Batch results need to create `card_images` rows and update `albumMap` — same as the current per-card flow but done in bulk after batch completion.
6. **Error handling**: What happens when 3 out of 15 cards fail in a batch? Retry just those 3? Show partial results?
7. **Concurrent batches**: Can a user have multiple batch jobs running? UI implications.

---

*Last updated: 2026-03-20*
*Source: https://ai.google.dev/gemini-api/docs/batch-api*
*Notebook: https://colab.research.google.com/github/google-gemini/cookbook/blob/main/quickstarts/Batch_mode.ipynb*
