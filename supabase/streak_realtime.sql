-- ============================================================================
-- Streak realtime — user_streaks was never added to the Realtime publication
-- ----------------------------------------------------------------------------
-- RLS policies for user_streaks already exist (from schema.sql), but the
-- table was missing from `supabase_realtime`, so postgres_changes
-- subscriptions on it never fired — the streak badge only updated on a full
-- page refresh. This just adds the table to the publication; no data touched,
-- safe to re-run.
-- ============================================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'user_streaks'
  ) then
    alter publication supabase_realtime add table public.user_streaks;
  end if;
end $$;
