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
- **Status**: Completed (Awaiting User Verification)
- **Summary**:
  - Built `SuggestionsPanel` inside **GitHub → Suggestions** (plus one-tap **Propose Improvement** from any repo file and `/suggest <file>` in **Chat / Work**).
  - Enforces explicit **Approve** / **Reject** review before unlocking write/export actions (**Copy Unified Patch**, **Copy Patched File**, or **Open Pull Request** on a new `mantis/*` branch — never committing directly to `main`).
  - Updated `MemoryReadinessMetrics` to honestly include reviewed and approved suggestions.
- **Verification**: Open **GitHub → Suggestions**, analyze a file or propose new code, inspect the diff, approve it, and verify write actions unlock.
