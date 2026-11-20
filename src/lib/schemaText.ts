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
