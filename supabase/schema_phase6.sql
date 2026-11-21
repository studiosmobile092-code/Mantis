-- Mantis Professional Polish Phase 6 Migration SQL
-- Adds Knowledge trust status, extraction provenance, and synced theme/accent preferences.
-- Safe to run multiple times (idempotent) in Supabase SQL Editor:
-- https://supabase.com/dashboard/project/ncbtoawlltxukzzdyvhc/sql

alter table public.knowledge_entries
  add column if not exists status text not null default 'reviewed'
    check (status in ('raw', 'reviewed', 'trusted')),
  add column if not exists source_url text,
  add column if not exists extracted_at timestamptz;

create index if not exists idx_knowledge_entries_user_status
  on public.knowledge_entries (user_id, status);

-- Backfill existing manual Teach and Chat rules as trusted so existing workflows stay accurate
update public.knowledge_entries
set status = 'trusted'
where source in ('teach', 'chat')
  and status = 'reviewed';

alter table public.user_preferences
  add column if not exists theme text not null default 'dark'
    check (theme in ('dark', 'dim', 'light')),
  add column if not exists accent_color text not null default 'emerald'
    check (accent_color in ('emerald', 'blue', 'violet', 'amber', 'rose'));

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on table
  public.knowledge_entries,
  public.user_preferences
  to authenticated;
