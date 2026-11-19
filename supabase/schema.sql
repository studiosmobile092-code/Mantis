-- Mantis Web-First Phase 1 Schema
-- Run this once in your Supabase Project SQL Editor:
-- https://supabase.com/dashboard/project/ncbtoawlltxukzzdyvhc/sql

create extension if not exists pgcrypto;

-- 1. Organized knowledge folders
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

-- 2. Persistent knowledge entries
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

-- 3. Persistent chat history
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
grant usage, select on all sequences in schema public to authenticated;
