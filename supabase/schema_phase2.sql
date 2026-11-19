-- Mantis Web-First Phase 2 Migration SQL (Safe to run on existing Phase 1 DB)
-- Run once in Supabase SQL Editor:
-- https://supabase.com/dashboard/project/ncbtoawlltxukzzdyvhc/sql

-- 1. Connected GitHub repository (read-only metadata)
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

-- 2. Indexed read-only repository files
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

-- 3. Allow chat messages to cite indexed GitHub file paths
alter table public.chat_messages
  add column if not exists cited_repo_paths text[] not null default '{}';

-- 4. Explicit Postgres privileges for Phase 2 tables
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on table
  public.github_connections,
  public.repo_files
  to authenticated;
grant usage, select on all sequences in schema public to authenticated;
