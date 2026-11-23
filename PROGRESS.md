# Mantis — Build Progress

Specification: **Mantis Web-First Personal Coding AI Agent**
Primary Device: **Galaxy Tab A9 / A9+ (8 GB RAM, Android 16)** • Secondary: **Chromebook (Browser-Only)**
Hosting: **GitHub Pages** • Persistence: **Supabase (Publishable Key + Auth + RLS)**

---

## Phase 1 — Foundation (Web + Memory) — Verified

- Dark tablet-ready UI shell, secret hygiene (`.gitignore` + `.env.example`), relative Vite build paths (`base: './'`).
- Phase 1 Supabase schema (`knowledge_folders`, `knowledge_entries`, `chat_messages`) with `GRANT` privileges and Postgres RLS (`auth.uid() = user_id`).
- Single-user Supabase Auth gate, starter folder seeding, `TeachPanel`, `KnowledgeBrowser`, and memory-retrieval `ChatWorkspace`.

---

## Phase 2 — Teaching & GitHub Awareness

- **Step 2.1 (Build Fix — Updated)**: Diagnosed `ERESOLVE` peer conflict between `vite@8.3.8` and `esbuild@^0.25.0` under strict `npm install` + missing `package-lock.json`. Updated `.github/workflows/deploy.yml` to **Node 22** and `npm install --legacy-peer-deps --no-audit --no-fund`.
- **Step 2.2**: Added `supabase/schema_phase2.sql` (`github_connections`, `repo_files`, `chat_messages.cited_repo_paths`).
- **Step 2.3**: Added Quick-Teach templates, clickable tag suggestions, and safe folder removal.
- **Step 2.4**: Added read-only GitHub connector (`src/lib/github.ts`, `GitHubPanel`) and synced async connection inputs cleanly.
- **Step 2.5**: Added repo-aware Chat retrieval and file citation chips.

---

## Phase 3 — Code Help & Suggestions

### Step 3.1 — Phase 3 Database Schema (`code_suggestions`)
- **Status**: Ready for User Execution
- **Summary**:
  - Created `supabase/schema_phase3.sql` for persistent code proposals (`pending`, `approved`, `rejected`), rationale, original/proposed snapshots, user feedback, and PR URL tracking with RLS and `GRANT` permissions.
- **Verification**: Run `supabase/schema_phase3.sql` (or copy it inside **GitHub → Suggestions** or **Settings**) once in Supabase SQL Editor and tap **Verify Phase 3 Tables**.

### Step 3.2 — Line-by-Line Diff Engine & Code Analyzer
- **Status**: Completed
- **Summary**:
  - Built `src/lib/diff.ts` (LCS line diff, hunk collapsing, `+`/`-` stats, and unified `.patch` export) and `src/components/DiffViewer.tsx`.
  - Built `src/lib/suggestions.ts` to inspect indexed repository files against safety/accessibility/TypeScript/SQL/workflow rules and relevant Knowledge entries, or scaffold new code proposals.
- **Verification**: `npm run build` and `npm run lint` pass cleanly.

### Step 3.3 — Approval-Gated Suggestion Queue & Guarded PR Workflow
- **Status**: Completed & Verified by User
- **Summary**:
  - Built `SuggestionsPanel` inside **GitHub → Suggestions** (plus one-tap **Propose Improvement** from any repo file and `/suggest <file>` in **Chat / Work**).
  - Enforces explicit **Approve** / **Reject** review before unlocking write/export actions (**Copy Unified Patch**, **Copy Patched File**, or **Open Pull Request** on a new `mantis/*` branch — never committing directly to `main`).
  - Updated `MemoryReadinessMetrics` to honestly include reviewed and approved suggestions.

---

## Phase 4 — Guarded Self-Improvement

### Step 4.1 — Phase 4 Database Schema (`self_audit_runs` + `suggestion_kind`)
- **Status**: Ready for User Execution
- **Summary**:
  - Created `supabase/schema_phase4.sql` to track self-audit runs (`repo_label`, `branch`, `files_scanned`, `findings_count`, `health_score`, `summary`) and tag `code_suggestions` with `suggestion_kind` (`code_help` vs `self_improvement`) under Postgres `GRANT`s and `auth.uid() = user_id` RLS.
- **Verification**: Run `supabase/schema_phase4.sql` (copyable from **GitHub → Self-Improve** or **Settings**) once in Supabase SQL Editor and tap **Verify Phase 4 Tables**.

### Step 4.2 — Read-Only Self-Audit Engine (`src/lib/selfImprove.ts`)
- **Status**: Completed
- **Summary**:
  - Audits Mantis's own codebase (using indexed files when connected to `studiosmobile092-code/Mantis`, or fetching a read-only GitHub snapshot on demand) for security, tablet accessibility, workflow/SQL reliability, bundle chunking, and Knowledge rule alignment.
  - Marks sensitive infrastructure files (`.github/workflows/*`, `supabase/*`, `vite.config.ts`, `package.json`) as `HIGH-GUARD`.

### Step 4.3 — Guarded Self-Improve Panel & Prior-Phase Polish
- **Status**: Completed (Awaiting User Verification)
- **Summary**:
  - Built `SelfImprovePanel` under **GitHub → Self-Improve** plus `/self-audit` command in **Chat / Work**.
  - Enforces strict no-unrestricted-self-modification policy: read-only scan → staged diff in `Suggestions` → explicit user **Approve** → patch export or `mantis/*` Pull Request only.
  - Added tag filtering in **Knowledge**, last-synced timestamp in **GitHub → Repository**, and **Save Lesson** from reviewed suggestions back into **Teach Mantis**.
- **Verification**: Run **GitHub → Self-Improve → Run Mantis Self-Audit** (or `/self-audit` in Chat), tap **Stage Diff for Review** on a finding, and verify it lands in **Suggestions** as `Pending Review`.

---

## Phase 5 — Real AI Brain, Live Capture & Trainable Memory

### Step 5.1 — Zero-Secret Cloudflare Worker AI Proxy (`cloudflare/worker.js`)
- **Status**: Completed (Awaiting User Cloudflare Deployment)
- **Summary**:
  - Built `cloudflare/worker.js` (plus optional `supabase/functions/mantis-brain/index.ts` mirror) to proxy Hugging Face coding/reasoning models (`Qwen/Qwen2.5-Coder-32B-Instruct`, `Qwen/Qwen2.5-72B-Instruct`, `meta-llama/Llama-3.3-70B-Instruct`, `deepseek-ai/DeepSeek-R1-Distill-Qwen-32B`) with automatic model fallback.
  - Verifies the signed-in user's Supabase JWT + optional `ALLOWED_EMAIL` on every call so neither `HF_TOKEN` nor Supabase Secret keys ever appear in frontend code or GitHub.
  - Exposes `/health`, `/ai/chat` (with `[LEARN: ...]` auto-learning directives), `/ai/distill`, `/ai/suggest`, and `/extract-url` (YouTube captions + clean web article text).
  - Embedded one-click **Copy Worker Code** and connection tester inside **Settings**.
- **Verification**: Deploy `cloudflare/worker.js` to Cloudflare Workers, set `HF_TOKEN` Secret and `ALLOWED_EMAIL` Variable, paste Worker URL into **Settings**, and tap **Save & Test AI Brain**.

### Step 5.2 — Live Screen/Caption OCR, YouTube/Article & Voice Capture (`Capture` Tab)
- **Status**: Completed (Awaiting User Verification)
- **Summary**:
  - Built `src/components/CapturePanel.tsx`, `src/lib/ocrCapture.ts` (`tesseract.js` local Web Worker with `bottom_captions` / `center_article` / `full` frame cropping + contrast enhancement), and `src/lib/textDistiller.ts` (rolling YouTube caption deduplicator + offline fallback distiller).
  - **Chromebook / Desktop**: Supports live `getDisplayMedia` screen/tab recording with real-time rolling caption deduplication.
  - **Galaxy Tab A9+ (Android Chrome)**: Automatically provides Android-compatible workarounds: **YouTube / Article URL** extraction via the Worker, **Screenshot / Camera / Clipboard (`Ctrl+V`) OCR**, **Live Mic** Web Speech transcription, and bulk transcript paste.
  - Auto-distills captured text into structured Knowledge entries and saves them directly to Supabase.
- **Verification**: Open the **Capture** tab, test **YouTube / Article URL** or **Screenshots & Live Mic**, and verify new entries appear under **Knowledge → Captured Learning**.

### Step 5.3 — Trainable Memory Reinforcement, Synced Preferences & Bundle Split
- **Status**: Completed (Awaiting User Verification)
- **Summary**:
  - Created `supabase/schema_phase5.sql` adding `recall_count` and `confidence_score` to `knowledge_entries` and creating `user_preferences` (syncing AI Brain URL, model, and capture interval across devices with RLS + `GRANT`s).
  - Upgraded `src/lib/memory.ts` with character-trigram fuzzy matching and confidence-score weighting, plus **Helpful** feedback reinforcement and `[LEARN:]` auto-save in `ChatWorkspace`.
  - Upgraded **GitHub → Suggestions** to use `/ai/suggest` when connected to the Cloudflare AI Brain (with deterministic static fallback offline).
  - Configured `vite.config.ts` vendor chunk splitting (`vendor-supabase`, `vendor-icons`, `vendor-ocr`, `vendor-react`) and replaced `__dirname` for clean ESM builds.
- **Verification**: Run `supabase/schema_phase5.sql` in Supabase SQL Editor, test **Chat / Work** with AI Brain connected, tap **Helpful** on an answer, and confirm GitHub Pages workflow deploys cleanly.

### Step 5.4 — Mantis Studio Overhaul, Built-in AI Lead Engine & Chromebook Failover
- **Status**: Completed
- **Summary**:
  - **Built-in AI Lead Engine (`src/lib/mantisBrain.ts`)**: Built deterministic rule/fact mining (`mineKnowledgeFromText`), indexed Concept Graph & co-occurrence clustering (`computeKnowledgeGrowth`), and grounded synthesis (`synthesizeBuiltInReply`) that leads every Studio turn instantaneously while delegating optional deep distillation & code help to Cloud Assist (**Ask Cloud Assist** button or **Cloud Auto** toggle).
  - **Pro IDE Studio GUI**: Overhauled layout into a three-pane obsidian developer studio (`TopBar`, collapsible **Left `StudioExplorer`**, **Central Workbench `ChatWorkspace` / inline `TeachPanel`**, and **Right `LiveMonitorPanel`** showing active engine route, live Supabase knowledge velocity counters, concept links, and timestamped Learning Activity Feed).
  - **Chromebook Non-`.dev` Failover (`supabase/functions/mantis-brain/index.ts` & `src/lib/aiBrain.ts`)**: Upgraded the Supabase Edge Function (`*.supabase.co/functions/v1/mantis-brain`) to full parity with `cloudflare/worker.js` and added automatic dual-endpoint failover + `backup_brain_url` / `prefer_built_in_first` in `supabase/schema_phase5.sql` and `SettingsPanel` (with 1-tap auto-fill and copy).
  - **YouTube/Article URL & Mic/OCR Reliability**: Added YouTube InnerTube `/youtubei/v1/player` + balanced `captionTracks` + oEmbed metadata fallback and `r.jina.ai` article fallback to both backends and browser client fallback; rebuilt continuous `SpeechRecognition` with `interimResults = true` + Android auto-restart loop + live Web Audio `AnalyserNode` 16-bar mic meter; added grayscale luminance frame-diff gating + live crop thumbnail preview in `ocrCapture.ts` and `CapturePanel.tsx`.
- **Verification**: Run `npm run lint`, `npm run build`, and secret scan across `src/`, `cloudflare/`, and `supabase/`. In Supabase SQL Editor, run updated `supabase/schema_phase5.sql` once, and optionally deploy `supabase/functions/mantis-brain/index.ts` via Supabase Dashboard Edge Functions Editor to unlock AI Assist & URL ingestion on `.dev`-blocked Chromebooks.

### Step 5.5 — Tablet-Safe Edge Function Split & Backup Route 401 Fix
- **Status**: Completed
- **Summary**:
  - Split `supabase/functions/mantis-brain` into four tiny modules (`helpers.ts` ~10.5 KB, `providers.ts` ~4.3 KB, `routes.ts` ~5.6 KB, and a 3-line `index.ts` without remote `jsr:` imports) so Supabase's web editor on Android tablet Chrome never stalls or crashes when replacing `index.ts`.
  - Updated `src/lib/schemaText.ts` and `src/components/SettingsPanel.tsx` with dedicated 1-tap copy buttons for all four files.
  - Fixed `src/lib/aiBrain.ts` so `/health` probes run headerless (preventing Supabase gateway HTTP 401s on `apikey` / `Bearer` headers), never pass `sb_publishable_...` inside `Authorization: Bearer`, and automatically refresh expiring Supabase JWTs via `supabase.auth.getSession()` / `refreshSession()` on 401.
- **Verification**: Run `npm run lint` and `npm run build`, then tap **Save & Test Both Routes** in Mantis **Settings** on the Chromebook.

---

## Phase 6 — Professional Polish & Pro IDE Upgrade

### Group 1 — Knowledge Save Reliability, Trust Weighting & Offline Queue (Items 1, 5, 28 + Phase 6 SQL)
- **Status**: Completed (Ready for Tablet & Chromebook Verification)
- **Summary**:
  - **Save Feedback & Optimistic Rollback (`src/lib/knowledgeSync.ts`, `src/App.tsx`, `src/components/TeachPanel.tsx`)**: Every Knowledge save now inserts/updates optimistically for instant UI response, displays live `Saving…` → `Saved ✓` or `Failed – Retry` (with one-tap Retry), prevents short-window duplicate saves via title + content hash deduplication, and guarantees valid `user_id` and `folder_id`.
  - **Offline Resilience (Item 28)**: Network/offline failures automatically queue non-critical Knowledge writes locally (`Offline — queued to sync`) and auto-flush whenever connectivity returns (plus manual **Sync Queued Now** in Settings).
  - **Captured vs Trusted Knowledge (Item 5)**: Added `raw | reviewed | trusted` lifecycle, status filter tabs (`All / Trusted / Reviewed / Raw`), visual status badges, and one-tap **Mark as Trusted** in `KnowledgeBrowser`. Updated `retrieveRelevantKnowledge` (`src/lib/memory.ts`) so **Trusted** entries carry strong priority, **Reviewed** entries carry medium weight, and **Raw** entries are excluded from AI answers by default.
  - **Optional Phase 6 SQL with Safe Fallback (`supabase/schema_phase6.sql`)**: Added idempotent Phase 6 SQL (`status`, `source_url`, `extracted_at` on `knowledge_entries`; `theme`, `accent_color` on `user_preferences`) copyable in **Settings**, with automatic schema fallback + local metadata persistence if not yet run in Supabase.
- **Verification**:
  1. Open **Studio → Teach** on your Galaxy Tab or Chromebook, save a rule, and confirm immediate **Saving… → Saved ✓** feedback and instant appearance in **Knowledge**.
  2. Double-tap save or re-submit the exact same entry within 30s and confirm no duplicate entry is created.
  3. Open **Knowledge**, filter by **Trusted / Reviewed / Raw**, tap **Mark as Trusted** on any non-trusted entry, and ask a question in **Studio** to confirm Trusted knowledge answers first while Raw entries are excluded.
  4. *(Optional cross-device sync)* Open **Settings → Phase 6 Polish SQL**, copy and run it once in Supabase SQL Editor, then click **Sync** in the top bar.

### Group 2 — URL / Article Extraction Upgrade & Editable Preview (Items 2, 27)
- **Status**: Completed (Ready for Tablet & Chromebook Verification)
- **Summary**:
  - Upgraded `src/lib/aiBrain.ts` (`cleanExtractedArticleText`, `htmlToReadableText`, `extractUrlViaBrain`) to strip web navigation, cookie/share clutter, and inline link noise while preserving headings and fenced code blocks, and to attach `extractedAt` timestamps.
  - Added `src/components/CaptureReviewModal.tsx` and refactored URL & Paste workflows in `src/components/CapturePanel.tsx` so extracted links and pasted articles ALWAYS open in an editable preview (Title, Content, Folder, Tags, Status `Reviewed`/`Trusted`, `Single Entry` vs `Split Concepts`, `source_url`, and `extracted_at`) before saving.

### Group 3 — OCR Pipeline Speed, ROI Crop & Preview Confirmation (Items 3, 25)
- **Status**: Completed (Ready for Tablet & Chromebook Verification)
- **Summary**:
  - Upgraded `src/lib/ocrCapture.ts` with ROI cropping (`full`, `center_article`, `bottom_captions`), a fast lower-resolution pass first (~900px max edge for screenshots / 960px cap for live screen capture), and an optional **Refine High-Res** second pass with contrast sharpening.
  - Removed all silent OCR auto-saving from both Screenshot OCR and Live Screen OCR in `src/components/CapturePanel.tsx`. Recognized text now opens in `CaptureReviewModal` with cropped image preview, confidence badge (`Good` / `Fair` / `Low` + `%`), ROI switcher, **Refine High-Res**, and explicit **Save to Knowledge** / **Discard** actions.

### Group 4 — Mic Record → Transcribe → Review → Save Flow (Item 4)
- **Status**: Completed (Ready for Tablet & Chromebook Verification)
- **Summary**:
  - Replaced continuous auto-saving microphone capture in `src/components/CapturePanel.tsx` with a manual **Start Recording** → live meter & interim transcript → **Stop & Review Transcript** flow (preserving trailing interim words).
  - Pre-fills transcripts cleanly as **`Conversation – [Date]`** inside `CaptureReviewModal` so the user can edit, pick folder/status, and confirm **Save to Knowledge** or **Discard** before anything writes to Supabase.
- **Verification (Groups 2–4)**:
  1. **URL Preview & Edit**: Open **Capture → YouTube & Article Links**, paste any article or YouTube link, tap **Extract & Preview**, edit the title/text, confirm **Save to Knowledge**, and verify `source_url` ("Source" link) appears on the saved entry in **Knowledge**. Repeat and tap **Discard** to confirm nothing is saved.
  2. **OCR Preview & High-Res Refine**: Open **Capture → Mic & Screenshot OCR**, pick a Crop Focus Region, upload or `Ctrl+V` paste a screenshot, inspect the cropped thumbnail and confidence (`Good` / `Fair` / `Low`), optionally tap **Refine High-Res**, then **Save to Knowledge** or **Discard**.
  3. **Mic Review Flow**: Tap **Start Recording**, speak a sentence, tap **Stop & Review Transcript**, confirm the pre-filled **`Conversation – [Date]`** modal opens with your editable transcript, and save or discard cleanly.

### Groups 5–9 — Pro IDE Polish, Themes, Onboarding, Lazy Performance & AI Multi-Voice + Auto-Folders (Items 6–30)
- **Status**: Completed & Build Verified
- **Summary**:
  - **Multi-Theme System & Semantic Tokens (`index.html`, `src/index.css`, `src/lib/theme.ts`, `src/components/SettingsPanel.tsx`)**: Added zero-flash pre-paint theme initialization and `Dark` (Emerald default) / `Dim` / `Light` theme modes plus `Emerald` / `Blue` / `Violet` / `Amber` / `Rose` accents synced locally and to Supabase `user_preferences`.
  - **AI-Assisted Multi-Voice Speech Engine (`src/lib/speechEngine.ts`, `src/lib/aiBrain.ts`, `src/components/CapturePanel.tsx`, `src/components/CaptureReviewModal.tsx`)**: Upgraded microphone capture to flush interim Android Chrome speech on `onend` with a fast `75ms` reconnect loop, `maxAlternatives = 3`, Web Audio noise-suppression + `AnalyserNode` spectral centroid acoustic speaker clustering, connected AI transcript cleanup & speaker labeling (`Speaker 1:`, `Speaker 2:`, etc.), and inline speaker relabeling inside the Review modal.
  - **AI Auto-Folders (`src/lib/autoFolders.ts`, `src/lib/aiBrain.ts`, `src/components/TeachPanel.tsx`, `src/components/CaptureReviewModal.tsx`, `src/App.tsx`)**: Added semantic topic routing and automatic folder creation (e.g., `"definition of turkey"` → `Food`, `"how to say hello"` → `Greetings`, `"used in speech"` → `Language & Speech`) using connected AI with deterministic fallback and singular/plural deduplication across Teach, Capture, Chat One-Tap Save, and Chat Auto-Mine.
  - **Workbench Navigation & Polish (`src/components/TopBar.tsx`, `src/components/CommandPalette.tsx`, `src/components/OnboardingGuide.tsx`, `src/components/ChatWorkspace.tsx`, `src/components/KnowledgeBrowser.tsx`, `src/components/DiffViewer.tsx`, `src/App.tsx`)**: Added `Ctrl/Cmd+K` Command Palette, collapsible Left Explorer (`Ctrl/Cmd+B`) and Right Live Monitor, interactive System Connection popover, `<60s` 3-step Onboarding Guide, Chat scroll-up **Jump to latest** + IME-safe Enter + One-Tap **Auto-Store**, Knowledge **Bulk Select Mode** (`Mark Trusted`, `Move Folder`, inline `Delete`), `Propose-Only · Approval Required` diff guardrails, `React.lazy` route splitting, and `React.memo` list optimization.
- **Verification (Groups 5–9 + AI Speech + Auto-Folders)**:
  1. **Multi-Voice Mic & Auto-Folder**: Open **Capture → Mic & Screenshot OCR**, tap **Start Recording**, let two people speak (or pause and change tone), tap **Stop & Review Transcript**, confirm `Speaker 1:` / `Speaker 2:` labels + relabel buttons appear, pick **Auto-Create Topic Folder (AI)**, and save.
  2. **Teach AI Auto-Folder**: Open **Studio → Teach**, pick the **Word / Definition** template, enter `"Definition of turkey"`, keep folder on **Auto-Create Topic Folder (AI)** (or tap **AI Detect**), and save — confirm **`Food`** is auto-created in **Knowledge**.
  3. **Command Palette & Themes**: Press `Ctrl+K` (or tap **Cmd+K** in the top bar), switch themes (`Dark` / `Dim` / `Light`), toggle Explorer (`Ctrl+B`), or open **Settings → Workspace Theme & Accent** to pick an accent color and reload to verify zero flash.

---

### Post-Phase 6 Debugging, Mic Overhaul, Pro IDE Polish & Security Audit
- **Status**: Completed & Build/Lint Verified
- **Summary**:
  - **Chromebook `"signal is aborted without reason"` Fix (`src/lib/aiBrain.ts`, `cloudflare/worker.js`, `supabase/functions/mantis-brain/*`)**: Passed explicit `Error` abort reasons to every `AbortController.abort(...)` call, bounded every upstream LLM provider/model call to explicit timeouts (`8500ms` per model, `4500ms` OpenRouter discovery, `9000ms` Ollama), wrapped `/ai/verify` and 401 refresh attempts in `try/catch` with human-readable normalization (`normalizeFetchError`), and fast-failed `.workers.dev` `/health` probes on Chromebooks (`5000ms`) so failover to `.supabase.co/functions/v1/mantis-brain` never throws silent abort exceptions.
  - **Live Microphone & Speech Reliability Overhaul (`src/components/CapturePanel.tsx`, `src/lib/speechEngine.ts`)**: Removed competing simultaneous `getUserMedia` audio capture that locked Android Chrome & Chromebook microphones during `SpeechRecognition`; replaced it with event-driven signal metering (`onaudiostart`, `onsoundstart`, `onspeechstart`, `onspeechend`), duplicate-safe turn appending (`appendDedupedSpeechTurn`) eliminating OCR-style truncation, Pause/Resume control, Recognition Language selector, guarded exponential retry backoff, and a 12s silent-stall watchdog + conversational turn-break detection.
  - **Remaining Pro IDE PDF Polish**:
    - **3-Column Knowledge Explorer (`src/components/KnowledgeBrowser.tsx`)**: Upgraded to `Folders | Compact Selectable Note List | Focused Reader & Inline Editor` (`lg:grid-cols-[220px_300px_1fr]`) with `/` search focus and `ArrowUp`/`ArrowDown` keyboard note navigation.
    - **Prose vs Code & Touch Comfort (`src/components/ChatWorkspace.tsx`, `src/components/StudioExplorer.tsx`, `src/components/LiveMonitorPanel.tsx`, `src/components/CaptureReviewModal.tsx`)**: Added fenced code-block parsing with language header and 1-click Copy buttons plus inline code chips, and raised compact buttons to `min-h-[40px]`.
    - **Settings Readiness & Power Shortcuts (`src/components/SettingsPanel.tsx`, `src/components/CommandPalette.tsx`, `src/App.tsx`)**: Added `Connected / Optional / Needs Setup` readiness checklist at the top of Settings, plus `Alt+N` (Teach Rule) and `Ctrl/Cmd+Shift+M` (Toggle Right Context Monitor).
  - **Comprehensive Security Audit & Fixes (`walkthrough.md`)**: Blocked unsafe link schemes (`sanitizeExternalHttpUrl`), hardened backend URL extraction against private/metadata/loopback/redirect SSRF (`isSafePublicHttpUrl`, `safePublicFetch`), enforced strict `resolveAllowedOrigin` CORS allowlisting, validated GitHub repo/path inputs (`sanitizeRepoPath`), and sanitized `localStorage` offline queue payloads.
- **Verification**:
  1. **Chromebook Settings Test**: On Chromebook, open **Settings → Save & Test Both Routes** — primary `.workers.dev` cleanly fails over without `"signal is aborted without reason"` and connects cleanly via your `.supabase.co/functions/v1/mantis-brain` route.
  2. **Mic Recording**: Open **Capture → AI Mic & Screenshot OCR**, pick your language, tap **Start Recording**, test **Pause / Resume**, speak a few sentences (with pauses for dialogue), and tap **Stop & AI Review** — confirm zero mic freezes, duplicate lines, or dropped trailing words.
  3. **3-Pane Knowledge & Shortcuts**: Open **Knowledge** on wide screen (`Folders` / `Note List` / `Reader`), press `/` to search and `↑` / `↓` to step through entries; press `Alt+N` to jump to **Teach** or `Ctrl+Shift+M` to toggle the right Context Monitor.

---

## Major Upgrade Phases 1–6 — Frontier Precision Workstation & Portable AI Studio

- **Status**: Completed & Build/Lint Verified
- **Summary**:
  1. **Phase 1 (Vulkan WebGPU + Web Workers + Int8 Vectors)**: Added `src/lib/gpuCompute.ts` (WebGPU Dawn/Vulkan probe + WGSL batch cosine shader), `src/lib/vectorStore.ts` (384-d Int8 scalar quantization reducing vector RAM by 75% + LRU IndexedDB cache), and `src/lib/computeWorker.ts` + `src/lib/workerClient.ts` (off-thread BM25 + Int8 RRF + MMR Hybrid Search, LCS diffing, and RAM profiling).
  2. **Phase 2 (VS Code + Grok Workstation UI Fusion)**: Added VS Code-inspired `ActivityRail`, slim `TopBar` with `Ctrl+K` Command Bar & compute popover, `24px` operational `StatusFooter`, and refactored `ChatWorkspace` into a Grok clean editorial canvas (`max-w-[78ch]`, 1px rules, zero AI speech bubbles, windowed virtualized stream, and inline Omnibar composer).
  3. **Phase 3 (Teacher–Student Distillation Loop & Contradiction Guard)**: Added `src/lib/scratchEngine.ts` (zero-`eval` recursive-descent math parser for `"1+1"` etc., persistent `ScratchSkillRule` intent cache, confidence scoring) and `distillLessonWithTeacher` in `src/lib/aiBrain.ts` so prompts Scratch cannot answer trigger connected Cloud Teacher distillation into reusable offline skills + Knowledge folders, guarded by Worker-backed Contradiction detection.
  4. **Phase 4 (Interactive Concept Graph & Smart-Assassin Mode)**: Added 60fps Canvas2D `ConceptGraphCanvas` with settle-pause power saving, pan/zoom/drag, and orphan note checks, plus `AssassinBriefCard` for `/execute <goal>` parallel context + static safety gate + approval-gated diff staging.
  5. **Phase 5 (Frontier DPO Arena, Evals & Self-Optimizer)**: Added `src/lib/trainingStore.ts` and `TrainingPanel` with A/B DPO ranking (`dpo_train.jsonl`), PII/secret-scrubbed SFT curation, automated Eval Suite (`hi`, `1+1`, secret hygiene, custom cases), and live JS Heap / Int8 RAM Profiler with 1-click duplicate pruning & approval-gated code optimization diffs.
  6. **Phase 6 (Custom Model Naming & Portable Export Studio)**: Added `src/lib/modelExporter.ts` and `ExportStudioPanel` with custom Model Card naming, isolated round-trip bundle verifier (`Verify Export Bundle`), 1-click standalone Drop-In Chatroom App (`.html`), Chatroom Runtime SDK, `.mantisbrain.json`, `sft_train.jsonl` / `dpo_train.jsonl`, Free Colab T4 Unsloth/TRL QLoRA notebook (`.ipynb`), and Ollama `Modelfile`.
- **Verification**:
  1. Run `npm run lint && VITE_BASE_PATH=./ npm run build` cleanly with 0 errors.
  2. In **Studio Workbench**, type `hi` and `1+1` (`Scratch Leads` mode) and confirm instant math parsing & Teacher-to-Scratch distillation; switch to **Concept Graph** tab to inspect linked Folders, Concepts, and Repo nodes.
  3. Run `/execute Improve error handling in App.tsx` to preview parallel context + static checks inside **Smart-Assassin Execution Brief**, then click **Approve & Stage Diff** or **Reject & Log DPO**.
  4. Open **Training** (`DPO Arena`, `Eval Bench → Run All Evals`, `RAM & Self-Opt`), then open **Export**, customize your Model Name, click **Verify Export Bundle**, and download **Standalone Chatroom App (.html)** to test your named model in any browser tab completely offline.

---

## Debug, Polish & Daily-Driver Upgrade Plan (3 Phases)

### Phase 1 out of 3 — Core Reliability, Compute Pipeline, Advanced Speech Studio & Theme/Touch Polish
- **Status**: Completed & Verified
- **Summary**:
  - **Compute, WebGPU (Vulkan Dawn) & Memory Store (`src/lib/gpuCompute.ts`, `src/lib/vectorStore.ts`, `src/lib/computeWorker.ts`, `src/lib/workerClient.ts`)**: Reused cached IndexedDB connections, added incremental vector `put()` updates and bounded LRU eviction, deduplicated WebGPU device initialization with `requestAdapterInfo()` fallback and `WeakMap` pipeline caching, added worker delta tracking + transferable `matrixBuffer`, and wired `webGpuBatchCosine` onto hybrid search (`>= 64` entries).
  - **AI Resilience, Retrieval, Math & Deterministic Training (`src/lib/aiBrain.ts`, `src/lib/memory.ts`, `src/lib/scratchEngine.ts`, `src/lib/textDistiller.ts`, `src/lib/trainingStore.ts`, `src/App.tsx`)**: Normalized silent `AbortError` failures and replaced brittle JSON parsing with `parseJsonObjectFromAiReply`; retained 2-letter technical tokens (`ai`, `ui`, `db`, `ts`) while filtering English filler stopwords; tightened natural-language math regex/percentage/number-word parsing; passed `recordUsage: false` on automated evals/duels; fixed deterministic proposal IDs (`opt-dup`, `opt-raw`), universal folder inference, `foldersRef` stale closures, optimistic-ID skip in memory reinforcement, and dead DPO rejection storage overwrite.
  - **Advanced Multi-Voice Speech Studio (`src/lib/speechEngine.ts`, `src/components/CapturePanel.tsx`)**: Fixed short-turn deduplication, added manual + Auto Detect multi-voice speaker switching, HiDPI `<canvas>` live spectrum/cadence visualizer with automatic Android/Chromebook `audio-capture` fallback, domain-lexicon alternative reranker, browser locale auto-initialization across 13 locales, recording duration clock, word counter, and `localStorage` draft recovery.
  - **Semantic Light/Dim/Dark Contrast & 40px+ Touch Ergonomics (`src/index.css`, `src/components/*`)**: Added `--m-warn*`, `--m-danger*`, and `--m-info*` tokens across Light/Dim/Dark themes, updated `ConceptGraphCanvas` theme compliance and `Plus Jakarta Sans` / `JetBrains Mono` typography, upgraded inline chat prose formatting, and raised interactive controls across the UI to `>= 40px` touch targets.

### Phase 2 out of 3 — Learning Loop & Daily-Driver Retrieval Upgrade
- **Status**: Completed & Verified
- **Summary**:
  - **Daily-Driver Retrieval & WebGPU Reranking (`src/lib/memory.ts`, `src/lib/mantisBrain.ts`, `src/lib/computeWorker.ts`, `src/lib/workerClient.ts`)**: Replaced naive substring token matching with word-safe exact-boundary scoring (`matchTokenStrength`) so 2–3 letter technical tokens (`ai`, `ui`, `db`, `ts`) never falsely match inside unrelated English words (`maintain`, `build`, `components`); wired `rerankHybridWithGpuScores` so WebGPU cosine similarity scores actually participate in RRF ranking before slicing results; skipped unnecessary matrix allocation when GPU is inactive; and upgraded `mineKnowledgeFromText` + `/teach` to route through semantic `inferFolderDeterministically` auto-folders.
  - **Cross-Note Contradiction Detection & Interactive Resolution (`src/lib/computeWorker.ts`, `src/App.tsx`, `src/types/mantis.ts`)**: Fixed polarity classification so negated phrases (`Never use eval`) do not falsely trigger positive polarity; expanded checks to both `trusted` and `reviewed` notes (plus entry updates with self-exclusion); and upgraded the Contradiction Guard bar into a side-by-side resolution panel with **Demote Old Note to Raw (Keep New)**, **Inspect Old Note**, and **Keep Both (Dismiss)**.
  - **Multi-Turn Curriculum Drills, Skill Editing & Low-Confidence Feedback (`src/lib/scratchEngine.ts`, `src/lib/aiBrain.ts`, `src/components/TrainingPanel.tsx`, `src/components/ChatWorkspace.tsx`, `src/App.tsx`)**: Added `analyzeCurriculumCoverage` + `generateCurriculumDrillWithTeacher` inside a new **Curriculum** tab to discover uncovered Knowledge/Eval gaps, generate 3-turn Teacher-Student drills, and mint Scratch skills, SFT turns, and Eval cases; added inline editing (`updateScratchSkill`) and live `usageCount` state syncing; fixed preceding user-turn resolution across stream pagination windows; added low-confidence detection with an inline **Fix Answer** skill-teaching drawer; and added Omnibar `/` slash-command autocomplete (`ArrowUp`/`ArrowDown`/`Tab`) plus `ArrowUp` last-prompt recall.

### Phase 3 out of 3 — Final Daily-Driver Hardening, Mobile Tablet Polish & Export Verification
- **Status**: Completed & Verified
- **Summary**:
  - **Offline Queue Coalescing & Conflict Resolution (`src/lib/knowledgeSync.ts`, `src/App.tsx`, `src/components/SettingsPanel.tsx`, `src/components/StatusFooter.tsx`)**: Coalesced offline edits/status changes directly into queued `optimistic-*` inserts or latest `update_entry`/`update_status` payloads while preserving `baseUpdatedAt`; added cross-device `updated_at` conflict detection with inline server title/timestamp comparison, **Overwrite Server**, **Discard**, and **Sync Queued Now** controls inside **Settings**; migrated fallback trust metadata (`migrateEntryMetaFallback`) from optimistic IDs to real DB UUIDs on sync; handled Phase 6 column fallbacks cleanly; and made the footer's offline pending pill jump straight to Settings.
  - **Mobile Tablet & Virtual-Keyboard Hardening (`src/App.tsx`, `src/components/AuthGate.tsx`, `src/components/TopBar.tsx`, `src/components/ActivityRail.tsx`, `src/components/KnowledgeBrowser.tsx`)**: Replaced `h-screen` / `min-h-screen` with `h-[100dvh]` / `min-h-[100dvh]` so Android Chrome's on-screen keyboard never clips the composer on Galaxy Tab A9/A9+; clamped `TopBar` engine popover width (`w-[min(20rem,calc(100vw-2rem))]`); added safe-area bottom inset and pending code badge on mobile `ActivityRail`; and turned `KnowledgeBrowser` Folders into a compact wrapping strip on `< lg` screens with bounded note-list height (`max-h-[42vh]`) so portrait tablet users reach the Note Reader effortlessly.
  - **Portable Export Runtime Parity, Secret Scrubbing & Smoke Verification (`src/lib/modelExporter.ts`, `src/components/ExportStudioPanel.tsx`)**: Scrubbed `sb_secret_*` and `hf_*` patterns across portable bundles, SFT/DPO JSONL datasets, and Ollama `Modelfile`; aligned the standalone JS runtime (`createMantisRuntime`) vectorizer with `encodeDenseVector384` (unigrams, `_tok_` trigrams, bigrams) plus word-boundary trigger matching and zero-`eval` math evaluation; upgraded `generateDropInChatHtml` with `100dvh`, HTML-escaped metadata, starter chips, `>= 44px` controls, and safe DOM `textContent` rendering; synced `ExportStudioPanel` drafts when `modelCard` updates externally; and verified all 6 checks inside `runExportedBundleSmokeTest` (fixing the `'hi'` false-boundary test phrase so word-boundary isolation passes reliably).
- **Verification**:
  1. `npx tsx` Phase 1–3 assertion suite (`knowledgeSync` coalescing/conflicts, word-safe retrieval, `tryEvaluateMathExpression`, secret redaction, Colab v4 notebook, HTML XSS check, and `runExportedBundleSmokeTest`) passed cleanly (`ALL_PHASE_1_TO_3_ASSERTIONS_PASSED`).
  2. `VITE_BASE_PATH=./ npm run build`, `compile_applet`, and `npm run lint` pass with zero errors.
  3. Manual daily-driver verification: resize browser to `~800×1280` (Galaxy Tab A9+ portrait) and `~1366×768` (Chromebook), verify Knowledge folders strip + `100dvh` composer, edit a note offline to inspect **Settings → Offline Sync Queue**, and open **Export → Verify Export Bundle** before downloading **Standalone Chatroom App (.html)**.

---

## 6-Phase Anthropic Workbench & Real Neural Training Roadmap

### Phase 1 out of 6 — Pro Workstation Redesign, Tablet Zero-Scroll Shell & Clutter Purge
- **Status**: Completed & Build/Lint Verified
- **Summary**:
  - **Anthropic Workbench + Linear Monochrome Palette (`src/index.css`)**: Calibrated obsidian dark (`#090B0E`), dim (`#0D1016`), and paper light (`#FAFAFA`) theme tokens with crisp `1px` hairlines, `.mantis-drawer-in` slide animation, and zero visual clutter.
  - **3-Mode Zero-Scroll `100dvh` Shell & Slide-Over Inspector (`src/types/mantis.ts`, `src/components/TopBar.tsx`, `src/components/InspectorDrawer.tsx`, `src/App.tsx`)**: Replaced the 7-icon `ActivityRail`, permanent dual sidebars, and bottom `StatusFooter` with a strict 3-zone `48px` `TopBar` (`Train & Chat` | `Memory & Data` | `Eval & Export`), slim `44px` mode sub-navigation, `Ctrl+I`/`Ctrl+B` slide-over `InspectorDrawer` (`Runtime & Storage`, `Folders`, `Active Concepts`, `Repo Quick Access`, `Recent Session Events`, `Settings`, `Sync`, `Theme`), and updated `CommandPalette` (`Ctrl+K`).
  - **Streamlined Chat & Per-Turn Clutter Purge (`src/components/ChatWorkspace.tsx`, `src/components/AssassinBriefCard.tsx`, `src/components/OnboardingGuide.tsx`)**: Anchored a single scrollable stream (`flex-1 min-h-0`) above a pinned keyboard-safe composer, replaced the 7-button message header with `Operator`/`Mantis · HH:MM`, plain-text low-confidence notices, one contextual primary action, and a `···` overflow menu, unboxed inline citation links, and moved the starter checklist into the empty stream state.
  - **Portrait Tablet Master-Detail Memory & Clean Terminology (`src/components/KnowledgeBrowser.tsx`, `src/components/TrainingPanel.tsx`)**: Added `< lg` list-to-reader pane switching (`← Back to Notes`) so tablet users read/edit notes immediately without scrolling past lists, and replaced prototype/game labels (`Smart-Assassin` → `Parallel Patch`, `DPO Arena` → `Preference Eval`).
- **Queued Phases**: Phase 3 (Hybrid Local LLM Engine — supporting BOTH lightweight 8 GB-safe models AND higher-capacity, smarter local/teacher models for faster learning) · Phase 4 (Strict Blind Eval Gate, Critique & Synthetic Drills) · Phase 5 (Hybrid Student-Teacher Curriculum & Self-Audit) · Phase 6 (Portable Model Packaging & Export Parity).
- **Verification**:
  1. `npm run lint` (`tsc --noEmit`), `compile_applet`, and `VITE_BASE_PATH=./ npm run build` pass cleanly with zero errors.
  2. Resize viewport to tablet portrait (`~800×1280`): verify the `88px` sticky top bar, zero-scroll `Train & Chat` stream with pinned composer, `Inspector` slide-over drawer (`Ctrl+I`), message `···` overflow menu, and `Memory & Data → Memories` `← Back to Notes` detail navigation.

### Phase 2 out of 6 — True Zero-Knowledge Neural Student Core & Checkpoint Engine
- **Status**: Completed & Build/Assertion Verified
- **Summary**:
  - **Blank-Slate Zero Knowledge (`src/lib/scratchEngine.ts`, `src/lib/neuralStudent.ts`)**: Removed pre-baked greeting defaults (`baseGreetings`) so `ckpt-000` starts at genuinely `0` gradient steps and `0` BPE vocabulary tokens, reporting `isUntrained: true` (`confidence: 0`) on unseen prompts until taught or trained. Only safe deterministic math expression parsing remains built in as a pure tool.
  - **Dynamic Subword BPE + Worker-Trained Neural Student (`src/lib/neuralStudent.ts`, `src/lib/computeWorker.ts`, `src/lib/workerClient.ts`, `src/types/mantis.ts`)**: Built an off-thread BPE merge trainer + Float32 MLP & LoRA adapter (`EMBEDDING_DIM=32`, `HIDDEN_DIM=48`, `LORA_RANK=8`) with reserved OOD reject boundary class (`__oom_ood__`), analytical backpropagation, gradient clipping (`5.0`), AdamW optimizer (`lr=0.032`, `wd=1e-4`), real Shannon entropy/cross-entropy telemetry, and top activated subword attributions.
  - **Immutable IndexedDB Checkpoint & Profile Registry (`src/lib/neuralStudent.ts`)**: Persists `ckpt-000`, `ckpt-001`, ... locally in IndexedDB (`mantis_neural_ckpts_v1`, auto-pruned at 24 snapshots with `ckpt-000` preserved) supporting **Step-Training**, **1-Click Rollback**, **Clone Profile**, and **Blank-Slate Reset (`0` steps)**.
  - **Physical Student-Only Isolation Gate (`src/lib/aiBrain.ts`, `src/lib/trainingStore.ts`, `src/App.tsx`)**: Added `setStudentIsolationLock(boolean)` inside `aiBrain.ts` so outbound cloud/teacher calls physically throw `Blocked by Student-Only Isolation` before `fetch` during **Student Isolated** chat turns and `'scratch'` eval runs.
  - **Pro Training & Turn Inspection UI (`src/components/LossSparkline.tsx`, `src/components/TopBar.tsx`, `src/components/InspectorDrawer.tsx`, `src/components/ChatWorkspace.tsx`, `src/components/TrainingPanel.tsx`, `src/App.tsx`)**: Added SVG loss convergence sparkline (`tabular-nums`), active `ckpt-###` badge in `TopBar`, neural metrics + checkpoint rollback/clone/reset in `InspectorDrawer` and `TrainingPanel → Neural Core`, per-turn `ckpt-### · Conf · Loss · 0 Cloud Calls` telemetry + `Subwords:` attribution in `ChatWorkspace`, and inline `Save & Step-Train` + `Re-test Prompt` workflow.
- **Note for Phase 3 (User Preference Recorded — Do Not Implement Until Phase 3)**:
  - Expand Phase 3 beyond only lightweight/small-RAM Q4 WebGPU models to support **BOTH lightweight 8 GB-safe local options AND more complex, higher-RAM / smarter models & teachers** so Mantis learns as fast and powerfully as available hardware allows.
- **Verification**:
  1. Verified via headless `npx tsx` assertion run: `ckpt-000` reports `0` steps, `0` BPE vocab, and `isUntrained: true`; training 24 epochs on `"hi" -> "Hello operator"` grows BPE vocab (`12`), lowers cross-entropy loss (`0.4581 -> 0`), recalls trained prompt while rejecting unseen `"zqxw_unknown_999"` (`oodConf: 0`), restores `ckpt-000` on rollback, and throws under `setStudentIsolationLock(true)`.
  2. Test in browser: open **Eval & Export → Training & Evals → Neural Core** to confirm `ckpt-000 (0 steps)`, ask `"hi"` in **Student Isolated** chat mode to confirm zero hardcoded knowledge, click **Fix Answer → Save & Step-Train** + **Re-test Prompt**, inspect **Inspector (`Ctrl+I`)** Loss Sparkline, and test **Rollback** / **Blank-Slate Reset**.

### Phase 3 out of 6 — Dual-Tier On-Device Local LLM Runtime (`q4` WebGPU + Complex Models) & 8 GB RAM Memory Guard
- **Status**: Completed & Build/Assertion Verified
- **Summary**:
  - **Dual-Tier Local Q4 WebGPU/WASM Engine (`src/lib/localLlmEngine.ts`, `src/lib/gpuCompute.ts`, `src/types/mantis.ts`, `vite.config.ts`)**: Integrated `@huggingface/transformers` (`vendor-transformers` lazy dynamic chunk) with WebGPU `q4f16`/`q4` execution, automatic CPU/WASM fallback, Browser Cache API persistence (`transformers-cache`), cancellable progress downloads, hardware capability probing (`probeHardwareCapabilities`: `deviceMemoryGb`, JS Heap, `shader-f16`, `maxBufferSizeMb`), and both **Tier 1 Lightweight 8 GB-Safe** (`SmolLM2-135M`, `SmolLM2-360M`, `Qwen2.5-0.5B`) and **Tier 2 Complex / High-Capacity** (`Llama-3.2-1B`, `Qwen2.5-Coder-1.5B`, `Qwen2.5-3B`) Q4 models.
  - **8 GB Memory Guard & Capture Auto-Unload (`src/lib/localLlmEngine.ts`, `src/components/CapturePanel.tsx`, `src/App.tsx`)**: Added `evaluateModelMemorySafety` blocking oversized high-RAM weights on `<= 8 GB` devices or high JS heap pressure unless manually overridden, single-model residency disposal on swaps, and `autoUnloadBeforeHeavyTask` automatically releasing heavy local LLM buffers before Screenshot/High-Res OCR and Screen Capture.
  - **Student Neural Adapter Bridge & Isolated Streaming (`src/components/ChatWorkspace.tsx`, `src/App.tsx`, `src/components/TopBar.tsx`, `src/components/InspectorDrawer.tsx`)**: Added **Local Q4** composer mode (`0 Cloud Calls` under `setStudentIsolationLock(true)`), grounding local Q4 generation with active `ckpt-###` targets, BPE subword bias terms, Hybrid BM25+Int8 memories, live token streaming (`tok/s`, generated token count, **Stop** control), and `InspectorDrawer` / `TopBar` runtime status & load/unload controls.
  - **Dual-Tier Training Workbench & Frontier Teachers (`src/components/TrainingPanel.tsx`, `src/lib/aiBrain.ts`, `src/components/SettingsPanel.tsx`, `cloudflare/worker.js`, `supabase/functions/mantis-brain/providers.ts`)**: Added **Local Q4 Models** tab with hardware metrics, Tier 1 & Tier 2 selectors, **Override 8 GB Guard** toggle, browser cache reset, Student Adapter preview, and streaming `tok/s` benchmark; upgraded Teacher selector with smart frontier models (`DeepSeek-R1`, `DeepSeek-V3.2`, `Qwen2.5-72B-Instruct`, `Qwen2.5-Coder-32B-Instruct`, `Llama-3.3-70B-Instruct`) plus explicit high-capacity `ollama/*` tags (`ollama/qwen2.5-coder:14b`, `ollama/deepseek-r1:14b`) honored end-to-end across Worker/Edge/Ollama backends.
- **Verification**:
  1. Headless `npx tsx` verification passed (`ALL_PHASE_3_ASSERTIONS_PASSED`): confirmed dual-tier catalog (`lightweight-8gb` + `complex-high-ram`), 8 GB Memory Guard blocking/override/workstation headroom checks, Student Adapter prompt/checkpoint/bias embedding, and `DeepSeek-R1`/`DeepSeek-V3.2` + `ollama/*` tag parsing.
  2. Run `npm run lint && VITE_BASE_PATH=./ npm run build` cleanly with lazy `vendor-transformers` chunking and zero hardcoded secrets.
  3. In browser: open **Eval & Export → Training & Evals → Local Q4 Models**, click **Probe Hardware**, test **SmolLM2-360M Q4** (`Load Weights` + **Stream Benchmark**) or pick a smart frontier Teacher (`DeepSeek-R1` / `DeepSeek-V3.2` / `ollama/qwen2.5-coder:14b`) in **Settings**, and test **Local Q4** mode in **Train & Chat** (verifying `0 Cloud Calls` and live `tok/s`).

### Phase 4 out of 6 — Frontier Post-Training Loop (Blind Eval Gate, Constitutional Critique & Synthetic Drills)
- **Status**: Completed & Build/Assertion Verified
- **Summary**:
  - **Held-Out Blind Eval Harness & Anti-Leakage Gate (`src/types/mantis.ts`, `src/lib/trainingStore.ts`, `src/lib/memory.ts`)**: Added explicit `blind` / `regression` / `training` splits, unseen `paraphraseProbes`, OOD `expectUntrainedRefusal` verification, and `detectEvalLeakage` flagging exact overlap against learned skills and SFT/DPO pairs under `setStudentIsolationLock(true)` isolation.
  - **Constitutional Principles & Critique Loop (`src/lib/constitutionalEngine.ts`, `src/lib/aiBrain.ts`, `src/components/ChatWorkspace.tsx`)**: Added editable `ConstitutionalPrinciple` rubric rules (`DEFAULT_CONSTITUTIONAL_PRINCIPLES`) plus hybrid deterministic + Teacher judge (`runConstitutionalCritique` / `critiqueStudentReplyWithTeacher`) with inline **Constitutional Critique** (`···` menu), `1px` violation/revision trace, auto-logged secret-scrubbed DPO preference pairs, and one-tap **Step-Train Revision**.
  - **Weighted DPO Feedback & 30% Anti-Forgetting Replay (`src/lib/neuralStudent.ts`)**: Upgraded `trainNeuralBatchCore` with bounded sample gradient weighting (`0.25..2.5`), `1.85x` priority for approved DPO winners, negative-loser demotion, and ~30% rehearsal replay across converged `activeCheckpoint.targets`.
  - **Synthetic Failure-Mining Flywheel & Checkpoint Regression Gate (`src/lib/aiBrain.ts`, `src/lib/trainingStore.ts`, `src/components/TrainingPanel.tsx`, `src/components/InspectorDrawer.tsx`, `src/App.tsx`)**: Added **Mine Failures & Train Flywheel** running `Baseline Blind Eval → generateSyntheticFailureDrillsWithTeacher → Candidate Batch Training → Post-Train Blind Eval`, using `evaluateCheckpointPromotion` to block promotion and roll back automatically if `passRate` drops or any regression case fails; upgraded **Critique & DPO** and **Blind Eval & Mining** tabs with hairline SFT/DPO batch ledger controls (filter, search, batch approve, deduplicate, scrub secrets) and Inspector pass-rate metrics.
  - **Anti-Poisoning Knowledge Guard (`src/lib/mantisBrain.ts`)**: Hardened `mineKnowledgeFromText` to reject raw secrets (`sb_secret_*`, `hf_*`, `ghp_*`, `Bearer`), JS/TS stack trace frames regardless of token order, and trivial low-signal fragments.
- **Verification**:
  1. Headless `npx tsx` verification passed (`ALL_PHASE_4_ASSERTIONS_PASSED`): verified blank-slate OOD pass (`eval-ood-refusal`) and zero leakage on `executeEvalSuite`, `detectEvalLeakage` overlap catching, `runConstitutionalCritique` secret scrubbing + DPO pair logging, `1.85x` weighted training + replay retention, `evaluateCheckpointPromotion` regression rollback gate, and `mineKnowledgeFromText` anti-poisoning guards.
  2. Verified `compile_applet`, `npm run lint` (`tsc --noEmit`), `VITE_BASE_PATH=./ npm run build`, and static secret/XSS scan cleanly.
  3. In browser:
     - Open **Eval & Export → Training & Evals → Blind Eval & Mining** and click **Run Blind Eval** to inspect isolated `blind` / `regression` scores, paraphrase probe results, and leakage flags.
     - Ask a question in **Train & Chat**, open the message `···` menu → **Constitutional Critique**, inspect rule violations & revised answer, and click **Step-Train Revision** to train `ckpt-###` on the `1.85x` DPO pair.
     - Click **Mine Failures & Train Flywheel** inside **Blind Eval & Mining** to generate synthetic drills on weak cases and verify Before/After pass deltas and automatic regression gating.

### Phase 5 out of 6 — Unified Memory, Capture Studio & Benchmark-Gated Self-Optimization
- **Status**: Completed & Build/Assertion Verified
- **Summary**:
  - **Capture Studio & Pipeline Bug Fixes (`src/lib/ocrCapture.ts`, `src/lib/aiBrain.ts`, `src/components/CapturePanel.tsx`, `src/components/CaptureReviewModal.tsx`)**: Added an 18 MB OCR image-size ceiling (`MAX_OCR_IMAGE_BYTES`) and 25s Tesseract timeout (`recognizeCanvasWithTimeout`) with clean worker recovery; fixed `htmlToReadableText` to preserve `<pre><code>` indentation and `language-*` fences while bounding raw DOM input (`450_000` chars); added a 10-minute / 24-entry LRU cache (`urlExtractionCache`) for extracted URLs and a 200 KB text limit (`enforceTextBlobLimit`) with inline truncation notices; surfaced cropped pixel dimensions and OCR zone-change notices inside `CaptureReviewModal`.
  - **Voice-to-Training & Speech Buffer Guard (`src/lib/speechEngine.ts`, `src/components/CapturePanel.tsx`, `src/App.tsx`)**: Upgraded `cleanSentencePunctuation` with pronoun/contraction normalization, bounded recording buffers (`capSpeechBuffers`: max 240 turns / 160 KB) for 8 GB tablets, and added **Generate SFT Pair(s)** (`extractSftPairsFromTranscript` -> `handleAddVoiceTrainingBatch`) directly turning spoken captures into scrubbed SFT pairs + 8-epoch Neural Core step-training.
  - **GitHub PR & Multiline Code-Audit Fixes (`src/lib/github.ts`, `src/lib/selfImprove.ts`, `src/lib/suggestions.ts`, `src/components/SuggestionsPanel.tsx`)**: Fixed `safePath` consistency in `fetchGitHubFileContent`, added empty-content rejection + upstream base-snapshot drift detection (`Stale base snapshot`) with explicit `Force PR` confirmation and safe `mantis/*` branch reset, replaced brittle single-line `<button>` regexes with quote/JSX-brace-aware multiline scanners, skipped commented `console.log` calls while catching inline calls, expanded self-audit snapshots to 70 files, and synced `selectedFilePath` cleanly after async repo loads.
  - **Semantic Memory Consolidation & Mobile Resilience (`src/lib/memory.ts`, `src/components/KnowledgeBrowser.tsx`)**: Built `analyzeMemoryConsolidation` (384-d cosine `>= 0.86` + prefix duplicate clustering, negation-stripped cross-rule polarity conflict detection, stale `Raw` inventory) plus `buildMergedClusterContent`, wired into a collapsible **Consolidate** drawer inside **Knowledge** with 1-click **Merge & Mark Trusted** and `<lg` empty-list mobile pane recovery (`list` fallback).
  - **Measured RAM Profiling & Benchmark-Gated Self-Opt (`src/lib/computeWorker.ts`, `src/lib/trainingStore.ts`, `src/components/TrainingPanel.tsx`, `src/types/mantis.ts`, `src/App.tsx`)**: Replaced hardcoded byte guesses in `profileResourcesCore` and `buildSelfOptimizationProposals` with exact byte measurements (`compactableRawBytes`, near-duplicate bytes, oversized repo excess, active chat buffer trimming); upgraded **Bench & Self-Opt** (`handleApplyMemoryOptimize`) to measure Before/After footprint KB, `measureRetrievalLatencyMs`, and isolated Blind Eval retention (`OptimizationBenchmarkResult`) alongside a 1-click **Rollback Memory Snapshot** (`handleRollbackMemoryOptimize`).
- **Verification**:
  1. Headless `npx tsx` assertion suite passed (`ALL_PHASE5_ASSERTIONS_PASSED`): verified 200 KB text truncation guard, speech punctuation + buffer caps + Voice-to-SFT extraction, multiline JSX `<button>` `type="button"` patching + comment-safe `console.log` self-auditing, 384-d cosine clustering + negation-stripped rule contradiction detection, and real measured profiler/proposal generation.
  2. Verified `compile_applet`, `npm run lint` (`tsc --noEmit`), `VITE_BASE_PATH=./ npm run build`, and static secret/XSS checks cleanly.
  3. In browser:
     - Open **Memory & Data → Memories**, click **Consolidate** to test duplicate merging, rule conflict resolution, and stale `Raw` triage.
     - Open **Memory & Data → Capture** to test URL caching, 200 KB limit notices, screenshot OCR dimensions/zones, or Voice recording → **Generate SFT Pair(s)**.
     - Open **Eval & Export → Training & Evals → Bench & Self-Opt**, click **Benchmark & Apply** on any proposal to view Before/After KB, latency (`ms`), and Blind Eval deltas, then test **Rollback Memory Snapshot**.


