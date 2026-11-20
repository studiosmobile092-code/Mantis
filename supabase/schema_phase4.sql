-- Mantis Web-First Phase 4 Migration SQL (Guarded Self-Improvement)
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
grant usage, select on all sequences in schema public to authenticated;
