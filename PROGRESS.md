# Mantis — Build Progress

Specification: **Mantis Web-First Personal Coding AI Agent**
Primary Device: **Galaxy Tab A9 / A9+ (8 GB RAM, Android 16)** • Secondary: **Chromebook (Browser-Only)**
Hosting: **GitHub Pages (`mantis-ai`)** • Persistence: **Supabase (Publishable Key + Auth + RLS)**

---

## Phase 1 — Foundation (Web + Memory)

### Step 1.1 — Project Setup, Secret Hygiene & GitHub Pages Config
- **Status**: Completed
- **Summary**:
  - Updated `metadata.json`, `index.html`, and `src/index.css` with Mantis branding, `Plus Jakarta Sans` + `JetBrains Mono` typography, and high-contrast dark slate theme.
  - Verified `.gitignore` blocks `.env*` and kept `.env.example` free of any secret keys or Hugging Face tokens.
  - Added `VITE_BASE_PATH` support in `vite.config.ts` and created `.github/workflows/deploy.yml` for automated GitHub Pages deployment to `/mantis-ai/`.
- **Verification**: `npm run build` and `npm run lint` pass cleanly.

### Step 1.2 — Supabase Database Schema & Row Level Security
- **Status**: Ready for User Execution
- **Summary**:
  - Created `supabase/schema.sql` defining `knowledge_folders`, `knowledge_entries`, and `chat_messages` with strict Postgres RLS (`auth.uid() = user_id`).
- **Verification**: Paste `supabase/schema.sql` into your Supabase SQL Editor and run it once, then verify in the Mantis **Settings** tab using **Test Connection**.

### Step 1.3 — Dark UI Shell & Single-User Supabase Auth Gate
- **Status**: Completed
- **Summary**:
  - Built the clean dark Mantis Top Bar, responsive tablet-friendly navigation (`Chat / Work`, `Knowledge`, `Teach`, `GitHub`, `Settings`), and `AuthGate` supporting email/password sign-in and first-time account creation using only `sb_publishable_...`.
- **Verification**: Open the web app on your Galaxy Tab A9/A9+ browser, create your account or sign in, and confirm the Top Bar displays `Connected`.

### Step 1.4 — Persistent Knowledge Storage, Starter Folders & Teach Flow
- **Status**: Completed
- **Summary**:
  - Built `KnowledgeBrowser` (folder filtering, live search across titles/tags/content, new folder creation, inline edit/delete) and `TeachPanel` (structured knowledge entry form).
  - Automatically seeds starter folders (`Architecture`, `Patterns`, `Debugging`, `Preferences`) on first login if none exist.
- **Verification**: Open **Teach**, save a coding note, open **Knowledge**, and refresh the browser tab to verify the note persists in Supabase.

### Step 1.5 — Memory-Retrieval Chat & Phase 1 Verification
- **Status**: Completed (Awaiting User Tablet Verification)
- **Summary**:
  - Built `ChatWorkspace` with persistent `chat_messages` history, deterministic RAG-style retrieval over your saved `knowledge_entries` with cited source links, `/teach` quick-save command, and one-tap **Save to Knowledge** from chat messages.
  - Built `SettingsPanel` with connection diagnostics, inline `supabase/schema.sql` copy tool, honest Phase 1 progress metrics, and security verification.
- **Verification**: Ask a question in **Chat / Work** matching a note you taught Mantis, confirm it cites the note, and confirm on your Galaxy Tab A9/A9+ before starting Phase 2.
