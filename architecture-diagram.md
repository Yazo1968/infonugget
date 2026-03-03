# InfoNugget Architecture Redesign

## Diagram 1: Current Architecture

```mermaid
graph LR
    UI[Your Browser - UI]
    CG[useCardGeneration - 615 lines]
    IO[useImageOperations - 332 lines]
    PE[usePersistence - Auto-save timers]
    DO[useDocumentOps - Upload and convert]
    IL[useInsightsLab - Chat messages]
    AD[useAutoDeck - Plan and produce]
    Claude[Claude AI]
    Gemini[Gemini AI]
    DB[Supabase Database]
    ST[Supabase Storage]
    FA[Files API]

    UI --> CG
    UI --> IO
    UI --> DO
    UI --> IL
    UI --> AD

    CG --> Claude
    CG --> Gemini
    CG --> FA
    CG --> PE

    IO --> DB
    IO --> ST
    IO --> PE

    IL --> Claude
    IL --> FA
    IL --> PE

    AD --> Claude
    AD --> FA
    AD --> PE

    DO --> Claude
    DO --> FA
    DO --> PE

    PE --> DB
    PE --> ST

    style UI fill:#166534,stroke:#22c55e,color:#fff
    style CG fill:#7f1d1d,stroke:#ef4444,color:#fca5a5
    style IO fill:#7f1d1d,stroke:#ef4444,color:#fca5a5
    style PE fill:#7f1d1d,stroke:#ef4444,color:#fca5a5
    style DO fill:#7f1d1d,stroke:#ef4444,color:#fca5a5
    style IL fill:#7f1d1d,stroke:#ef4444,color:#fca5a5
    style AD fill:#7f1d1d,stroke:#ef4444,color:#fca5a5
    style Claude fill:#3b0764,stroke:#a855f7,color:#c084fc
    style Gemini fill:#3b0764,stroke:#a855f7,color:#c084fc
    style DB fill:#7c2d12,stroke:#f97316,color:#fb923c
    style ST fill:#7c2d12,stroke:#f97316,color:#fb923c
    style FA fill:#7c2d12,stroke:#f97316,color:#fb923c
```

## Diagram 2: Proposed Architecture

```mermaid
graph LR
    UI[Your Browser - UI Only]

    GC[generate-card]
    MI[manage-images]
    PD[process-document]
    CM[chat-message]
    AK[auto-deck]
    SS[sync-state]

    Claude[Claude AI]
    Gemini[Gemini AI]
    DB[Supabase Database]
    ST[Supabase Storage]

    UI -->|one request| GC
    UI -->|one request| MI
    UI -->|one request| PD
    UI -->|one request| CM
    UI -->|one request| AK
    UI -->|one request| SS

    GC --> Claude
    GC --> Gemini
    GC --> DB
    GC --> ST

    MI --> DB
    MI --> ST

    PD --> DB
    PD --> ST

    CM --> Claude
    CM --> DB

    AK --> Claude
    AK --> DB

    SS --> DB

    style UI fill:#166534,stroke:#22c55e,color:#fff
    style GC fill:#1e3a5f,stroke:#3b82f6,color:#60a5fa
    style MI fill:#1e3a5f,stroke:#3b82f6,color:#60a5fa
    style PD fill:#1e3a5f,stroke:#3b82f6,color:#60a5fa
    style CM fill:#1e3a5f,stroke:#3b82f6,color:#60a5fa
    style AK fill:#1e3a5f,stroke:#3b82f6,color:#60a5fa
    style SS fill:#1e3a5f,stroke:#3b82f6,color:#60a5fa
    style Claude fill:#3b0764,stroke:#a855f7,color:#c084fc
    style Gemini fill:#3b0764,stroke:#a855f7,color:#c084fc
    style DB fill:#7c2d12,stroke:#f97316,color:#fb923c
    style ST fill:#7c2d12,stroke:#f97316,color:#fb923c
```

## Diagram 3: Generate Card - Before

```mermaid
graph TD
    B1[User clicks Generate] --> B2[Build synthesis prompt]
    B2 --> B3[Upload docs to Files API]
    B3 --> B4[Call Claude for content]
    B4 --> B5[Build planner prompt]
    B5 --> B6[Call Claude for layout]
    B6 --> B7[Build image prompt]
    B7 --> B8[Call Gemini for image]
    B8 --> B9[Retry if empty response]
    B9 --> B10[Store base64 in browser memory]
    B10 --> B11[Wait 1.5 seconds for auto-save]
    B11 --> B12[Upload to Storage and save to DB]
    B12 --> B13[Show image - might break on refresh]

    style B1 fill:#166534,stroke:#22c55e,color:#fff
    style B2 fill:#7f1d1d,stroke:#ef4444,color:#fca5a5
    style B3 fill:#7f1d1d,stroke:#ef4444,color:#fca5a5
    style B4 fill:#7f1d1d,stroke:#ef4444,color:#fca5a5
    style B5 fill:#7f1d1d,stroke:#ef4444,color:#fca5a5
    style B6 fill:#7f1d1d,stroke:#ef4444,color:#fca5a5
    style B7 fill:#7f1d1d,stroke:#ef4444,color:#fca5a5
    style B8 fill:#7f1d1d,stroke:#ef4444,color:#fca5a5
    style B9 fill:#7f1d1d,stroke:#ef4444,color:#fca5a5
    style B10 fill:#7f1d1d,stroke:#ef4444,color:#fca5a5
    style B11 fill:#7f1d1d,stroke:#ef4444,color:#fca5a5
    style B12 fill:#7f1d1d,stroke:#ef4444,color:#fca5a5
    style B13 fill:#7c2d12,stroke:#f97316,color:#fb923c
```

## Diagram 4: Generate Card - After

```mermaid
graph TD
    A1[User clicks Generate] --> A2[Send one request to generate-card API]
    A2 --> A3[Server does everything: Synthesis then Plan then Image then Upload then Save]
    A3 --> A4[Returns image URL]
    A4 --> A5[Show image - always works on refresh]

    style A1 fill:#166534,stroke:#22c55e,color:#fff
    style A2 fill:#1e3a5f,stroke:#3b82f6,color:#60a5fa
    style A3 fill:#1e3a5f,stroke:#3b82f6,color:#60a5fa
    style A4 fill:#1e3a5f,stroke:#3b82f6,color:#60a5fa
    style A5 fill:#166534,stroke:#22c55e,color:#fff
```

## Diagram 5: What Stays vs What Moves

```mermaid
graph TD
    direction TB

    S1[React components - STAYS]
    S2[User input handling - STAYS]
    S3[Panel layout - STAYS]
    S4[Dark mode toggle - STAYS]
    S5[Loading spinners - STAYS]

    M1[Prompt building - MOVES TO SERVER]
    M2[AI API calls - MOVES TO SERVER]
    M3[Image upload and storage - MOVES TO SERVER]
    M4[Version history - MOVES TO SERVER]
    M5[Document processing - MOVES TO SERVER]
    M6[Auto-save and persistence - MOVES TO SERVER]
    M7[Retry logic - MOVES TO SERVER]
    M8[Orphan cleanup - MOVES TO SERVER]
    M9[Serialization - MOVES TO SERVER]

    style S1 fill:#166534,stroke:#22c55e,color:#fff
    style S2 fill:#166534,stroke:#22c55e,color:#fff
    style S3 fill:#166534,stroke:#22c55e,color:#fff
    style S4 fill:#166534,stroke:#22c55e,color:#fff
    style S5 fill:#166534,stroke:#22c55e,color:#fff
    style M1 fill:#1e3a5f,stroke:#3b82f6,color:#60a5fa
    style M2 fill:#1e3a5f,stroke:#3b82f6,color:#60a5fa
    style M3 fill:#1e3a5f,stroke:#3b82f6,color:#60a5fa
    style M4 fill:#1e3a5f,stroke:#3b82f6,color:#60a5fa
    style M5 fill:#1e3a5f,stroke:#3b82f6,color:#60a5fa
    style M6 fill:#1e3a5f,stroke:#3b82f6,color:#60a5fa
    style M7 fill:#1e3a5f,stroke:#3b82f6,color:#60a5fa
    style M8 fill:#1e3a5f,stroke:#3b82f6,color:#60a5fa
    style M9 fill:#1e3a5f,stroke:#3b82f6,color:#60a5fa
```
