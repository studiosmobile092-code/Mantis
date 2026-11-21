import cloudflareWorkerSource from '../../cloudflare/worker.js?raw';
import supabaseEdgeHelpersSource from '../../supabase/functions/mantis-brain/helpers.ts?raw';
import supabaseEdgeProvidersSource from '../../supabase/functions/mantis-brain/providers.ts?raw';
import supabaseEdgeRoutesSource from '../../supabase/functions/mantis-brain/routes.ts?raw';
import supabaseEdgeFunctionSource from '../../supabase/functions/mantis-brain/index.ts?raw';
import phase6SchemaSqlSource from '../../supabase/schema_phase6.sql?raw';

export const MANTIS_CLOUDFLARE_WORKER_JS = cloudflareWorkerSource;
export const MANTIS_SUPABASE_EDGE_HELPERS_TS = supabaseEdgeHelpersSource;
export const MANTIS_SUPABASE_EDGE_PROVIDERS_TS = supabaseEdgeProvidersSource;
export const MANTIS_SUPABASE_EDGE_ROUTES_TS = supabaseEdgeRoutesSource;
export const MANTIS_SUPABASE_EDGE_FUNCTION_TS = supabaseEdgeFunctionSource;
export const MANTIS_PHASE6_SCHEMA_SQL = phase6SchemaSqlSource;

export const MANTIS_PHASE1_SCHEMA_SQL = `-- Mantis Web-First Phase 1 Schema
-- Run once in Supabase SQL Editor:
-- https://supabase.com/dashboard/project/ncbtoawlltxukzzdyvhc/sql

create extension if not exists pgcrypto;

create table if not exists public.knowledge_folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  name text not null,
  description text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists idx_knowledge_folders_user
  on public.knowledge_folders (user_id, created_at asc);

alter table public.knowledge_folders enable row level security;

drop policy if exists "Users manage own knowledge folders" on public.knowledge_folders;
create policy "Users manage own knowledge folders"
  on public.knowledge_folders
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table if not exists public.knowledge_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  folder_id uuid references public.knowledge_folders(id) on delete set null,
  title text not null,
  content text not null,
  tags text[] not null default '{}',
  source text not null default 'teach',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_knowledge_entries_user_updated
  on public.knowledge_entries (user_id, updated_at desc);

create index if not exists idx_knowledge_entries_folder
  on public.knowledge_entries (folder_id);

create or replace function public.set_mantis_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_knowledge_entries_updated_at on public.knowledge_entries;
create trigger trg_knowledge_entries_updated_at
  before update on public.knowledge_entries
  for each row
  execute function public.set_mantis_updated_at();

alter table public.knowledge_entries enable row level security;

drop policy if exists "Users manage own knowledge entries" on public.knowledge_entries;
create policy "Users manage own knowledge entries"
  on public.knowledge_entries
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  role text not null check (role in ('user', 'mantis')),
  content text not null,
  cited_entry_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists idx_chat_messages_user_created
  on public.chat_messages (user_id, created_at asc);

alter table public.chat_messages enable row level security;

drop policy if exists "Users manage own chat messages" on public.chat_messages;
create policy "Users manage own chat messages"
  on public.chat_messages
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 4. Explicit Postgres privileges (required before RLS is evaluated)
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on table
  public.knowledge_folders,
  public.knowledge_entries,
  public.chat_messages
  to authenticated;
grant usage, select on all sequences in schema public to authenticated;`;

export const MANTIS_PHASE2_SCHEMA_SQL = `-- Mantis Web-First Phase 2 Migration SQL
-- Run once in Supabase SQL Editor:
-- https://supabase.com/dashboard/project/ncbtoawlltxukzzdyvhc/sql

create table if not exists public.github_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  owner text not null,
  repo text not null,
  branch text not null default 'main',
  description text not null default '',
  is_private boolean not null default false,
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_github_connections_user
  on public.github_connections (user_id, updated_at desc);

drop trigger if exists trg_github_connections_updated_at on public.github_connections;
create trigger trg_github_connections_updated_at
  before update on public.github_connections
  for each row
  execute function public.set_mantis_updated_at();

alter table public.github_connections enable row level security;

drop policy if exists "Users manage own github connections" on public.github_connections;
create policy "Users manage own github connections"
  on public.github_connections
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table if not exists public.repo_files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  connection_id uuid not null references public.github_connections(id) on delete cascade,
  path text not null,
  size_bytes integer not null default 0,
  sha text not null default '',
  content text not null,
  updated_at timestamptz not null default now()
);

create index if not exists idx_repo_files_user_connection
  on public.repo_files (user_id, connection_id, path asc);

alter table public.repo_files enable row level security;

drop policy if exists "Users manage own repo files" on public.repo_files;
create policy "Users manage own repo files"
  on public.repo_files
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

alter table public.chat_messages
  add column if not exists cited_repo_paths text[] not null default '{}';

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on table
  public.github_connections,
  public.repo_files
  to authenticated;
grant usage, select on all sequences in schema public to authenticated;`;

export const MANTIS_PHASE3_SCHEMA_SQL = `-- Mantis Web-First Phase 3 Migration SQL
-- Run once in Supabase SQL Editor:
-- https://supabase.com/dashboard/project/ncbtoawlltxukzzdyvhc/sql

create table if not exists public.code_suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  connection_id uuid references public.github_connections(id) on delete set null,
  file_path text not null,
  title text not null,
  rationale text not null default '',
  original_content text not null default '',
  proposed_content text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  user_feedback text not null default '',
  pr_url text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_code_suggestions_user_created
  on public.code_suggestions (user_id, created_at desc);

drop trigger if exists trg_code_suggestions_updated_at on public.code_suggestions;
create trigger trg_code_suggestions_updated_at
  before update on public.code_suggestions
  for each row
  execute function public.set_mantis_updated_at();

alter table public.code_suggestions enable row level security;

drop policy if exists "Users manage own code suggestions" on public.code_suggestions;
create policy "Users manage own code suggestions"
  on public.code_suggestions
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on table
  public.code_suggestions
  to authenticated;
grant usage, select on all sequences in schema public to authenticated;`;

export const MANTIS_PHASE4_SCHEMA_SQL = `-- Mantis Web-First Phase 4 Migration SQL (Guarded Self-Improvement)
-- Run once in Supabase SQL Editor:
-- https://supabase.com/dashboard/project/ncbtoawlltxukzzdyvhc/sql

create table if not exists public.self_audit_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  repo_label text not null,
  branch text not null default 'main',
  files_scanned integer not null default 0,
  findings_count integer not null default 0,
  health_score integer not null default 100 check (health_score >= 0 and health_score <= 100),
  summary text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists idx_self_audit_runs_user_created
  on public.self_audit_runs (user_id, created_at desc);

alter table public.self_audit_runs enable row level security;

drop policy if exists "Users manage own self audit runs" on public.self_audit_runs;
create policy "Users manage own self audit runs"
  on public.self_audit_runs
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

alter table public.code_suggestions
  add column if not exists suggestion_kind text not null default 'code_help'
  check (suggestion_kind in ('code_help', 'self_improvement'));

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on table
  public.self_audit_runs
  to authenticated;
grant usage, select on all sequences in schema public to authenticated;`;

export const MANTIS_PHASE5_SCHEMA_SQL = `-- Mantis Web-First Phase 5 Migration SQL (Trainable Memory + Dual-Route AI Brain Preferences)
-- Run once in Supabase SQL Editor:
-- https://supabase.com/dashboard/project/ncbtoawlltxukzzdyvhc/sql

alter table public.knowledge_entries
  add column if not exists recall_count integer not null default 0,
  add column if not exists confidence_score integer not null default 1;

create table if not exists public.user_preferences (
  user_id uuid primary key default auth.uid(),
  brain_url text not null default '',
  backup_brain_url text not null default '',
  preferred_model text not null default 'Qwen/Qwen2.5-Coder-32B-Instruct',
  auto_learn_from_chat boolean not null default true,
  prefer_built_in_first boolean not null default true,
  capture_interval_ms integer not null default 2000,
  updated_at timestamptz not null default now()
);

alter table public.user_preferences
  add column if not exists backup_brain_url text not null default '',
  add column if not exists prefer_built_in_first boolean not null default true;

drop trigger if exists trg_user_preferences_updated_at on public.user_preferences;
create trigger trg_user_preferences_updated_at
  before update on public.user_preferences
  for each row
  execute function public.set_mantis_updated_at();

alter table public.user_preferences enable row level security;

drop policy if exists "Users manage own preferences" on public.user_preferences;
create policy "Users manage own preferences"
  on public.user_preferences
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on table
  public.user_preferences
  to authenticated;
grant usage, select on all sequences in schema public to authenticated;`;
