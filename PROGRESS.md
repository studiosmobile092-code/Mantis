# Mantis — Build Progress

Specification: **Mantis Web-First Personal Coding AI Agent**
Primary Device: **Galaxy Tab A9 / A9+ (8 GB RAM, Android 16)** • Secondary: **Chromebook (Browser-Only)**
Hosting: **GitHub Pages** • Persistence: **Supabase (Publishable Key + Auth + RLS)**

---

## Phase 1 — Foundation (Web + Memory) — Verified in Preview

- **Step 1.1**: Dark tablet-ready UI shell, secret hygiene (`.gitignore` + `.env.example`), and relative Vite build paths (`base: './'`).
- **Step 1.2**: Phase 1 Supabase schema (`knowledge_folders`, `knowledge_entries`, `chat_messages`) with explicit `GRANT` privileges and Postgres RLS (`auth.uid() = user_id`).
- **Step 1.3**: Single-user Supabase Auth gate (Sign In / Create Account).
- **Step 1.4**: Starter folder seeding, `TeachPanel`, and `KnowledgeBrowser` verified in preview.
- **Step 1.5**: Memory-retrieval Chat (`ChatWorkspace`) verified in preview.

---

## Phase 2 — Teaching & GitHub Awareness

### Step 2.1 — Fix GitHub Pages Build Failure
- **Status**: Completed
- **Summary**:
  - Removed `cache: npm` and replaced `npm ci` with conditional `npm ci` / `npm install` in `.github/workflows/deploy.yml` (fixing the GitHub Actions failure caused by the absence of `package-lock.json`).
  - Retained relative `./` build paths (`VITE_BASE_PATH: ./`) so `studiosmobile092-code.github.io/Mantis/` resolves assets cleanly when GitHub Pages **Source** is set to **GitHub Actions**.
- **Verification**: `npm run build` and `npm run lint` pass cleanly; GitHub Actions workflow builds without requiring `package-lock.json`.

### Step 2.2 — Phase 2 Supabase Migration (`github_connections` & `repo_files`)
- **Status**: Ready for User Execution
- **Summary**:
  - Created `supabase/schema_phase2.sql` adding `github_connections`, `repo_files`, `chat_messages.cited_repo_paths`, RLS policies, and `authenticated` table `GRANT` privileges.
- **Verification**: Run `supabase/schema_phase2.sql` (or copy it from the **GitHub** / **Settings** tab) once in your Supabase SQL Editor, then tap **Verify Phase 2 Tables**.

### Step 2.3 — Enhanced Teach Flow & Folder Organization
- **Status**: Completed
- **Summary**:
  - Added Quick-Teach templates (`Coding Rule`, `Bug Fix`, `Code Snippet`, `Architecture Note`) and clickable tag suggestions in `TeachPanel`.
  - Added safe folder removal (moving notes to `Uncategorized` without deleting data) in `KnowledgeBrowser`.
- **Verification**: Open **Teach**, tap a template, save an entry, and verify folder organization in **Knowledge**.

### Step 2.4 — Read-Only GitHub Repository Connector & Code Viewer
- **Status**: Completed (Awaiting User Verification)
- **Summary**:
  - Built `src/lib/github.ts` and `GitHubPanel` supporting `owner/repo` or full GitHub URLs (plus optional session-only token for private repos), indexing up to 40 key source/config files into Supabase `repo_files` with a searchable file viewer and **Save File Note to Teach**.
- **Verification**: Open **GitHub**, connect `studiosmobile092-code/Mantis`, and inspect indexed source files.

### Step 2.5 — Repo-Aware Chat Retrieval
- **Status**: Completed (Awaiting User Verification)
- **Summary**:
  - Upgraded `src/lib/memory.ts` and `ChatWorkspace` so Mantis searches and cites both your Knowledge notes and indexed GitHub repository files (including `/repo <query>`), with tappable source chips jumping directly to the file viewer.
- **Verification**: Ask in **Chat / Work** about a file or symbol (e.g., `/repo TopBar` or `How does vite.config.ts set base?`) and confirm Mantis cites the matching repo file.
