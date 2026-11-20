-- Mantis Web-First Phase 5 Migration SQL (Trainable Memory + AI Brain Preferences)
-- Run once in Supabase SQL Editor:
-- https://supabase.com/dashboard/project/ncbtoawlltxukzzdyvhc/sql

alter table public.knowledge_entries
  add column if not exists recall_count integer not null default 0,
  add column if not exists confidence_score integer not null default 1;

create table if not exists public.user_preferences (
  user_id uuid primary key default auth.uid(),
  brain_url text not null default '',
  preferred_model text not null default 'Qwen/Qwen2.5-Coder-32B-Instruct',
  auto_learn_from_chat boolean not null default true,
  capture_interval_ms integer not null default 2000,
  updated_at timestamptz not null default now()
);

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
grant usage, select on all sequences in schema public to authenticated;
