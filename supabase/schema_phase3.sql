-- Mantis Web-First Phase 3 Migration SQL (Safe to run on existing Phase 1–2 DB)
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
grant usage, select on all sequences in schema public to authenticated;
