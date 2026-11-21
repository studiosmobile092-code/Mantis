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

