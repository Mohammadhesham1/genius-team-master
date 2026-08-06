-- ============================================================================
-- 1v1 match room v2 — referee-controlled synced timer + question-bank fixes
-- ----------------------------------------------------------------------------
-- Run this directly on the live project (rtfivjmqlpbqlqdxpgzh). Unlike
-- schema.sql this does NOT drop/recreate tables, so existing users, points,
-- history, etc. are untouched. Safe to re-run.
--
-- What this does:
-- 1. Adds matches.question_started_at — a single server timestamp the
--    referee sets to start each question's countdown. Every participant
--    computes the same time-left from this one value instead of their own
--    local clock, so the timer is identical for everyone in the match.
-- 2. Fixes fn_start_match_questions: previously the cursor could walk down
--    to zero and then dead-end (matches would insert 0 questions, forever,
--    for that subject). It now wraps back to the newest block once the bank
--    has fully cycled through, and a subject with <=10 questions no longer
--    breaks after one match.
-- 3. Adds fn_bump_match_player as a core function here (it used to live only
--    in seed_content.sql, so judging an answer would fail with "function
--    not found" on any project where the seed file was never run).
-- 4. Adds a unique partial index so the same person can't be invited to the
--    same match twice while their first invite is still pending.
-- ============================================================================

alter table public.matches
  add column if not exists question_started_at timestamptz;

create unique index if not exists uq_match_invites_pending
  on public.match_invites (match_id, to_user_id)
  where status = 'pending';

create or replace function public.fn_start_match_questions(p_match_id uuid, p_subject_id text)
returns void language plpgsql as $$
declare
  v_total  int;
  v_cursor int;
  v_end    int;
  v_start  int;
begin
  select count(*) into v_total from public.questions where subject_id = p_subject_id;
  if v_total = 0 then
    return;
  end if;

  insert into public.match_bank_cursor (subject_id, last_used_position)
  values (p_subject_id, null)
  on conflict (subject_id) do nothing;

  select last_used_position into v_cursor
  from public.match_bank_cursor where subject_id = p_subject_id for update;

  v_end := coalesce(v_cursor, v_total);
  if v_end <= 0 then
    v_end := v_total;
  end if;
  v_start := greatest(v_end - 10, 1);

  insert into public.match_questions (match_id, position, question_id)
  select p_match_id, row_number() over (order by q.position) - 1, q.id
  from public.questions q
  where q.subject_id = p_subject_id and q.position between v_start and v_end
  order by q.position;

  update public.match_bank_cursor
    set last_used_position = case when v_start <= 1 then v_total else v_start - 1 end
    where subject_id = p_subject_id;
end $$;

create or replace function public.fn_bump_match_player(p_match_id uuid, p_user_id text, p_correct boolean)
returns void language plpgsql as $$
begin
  if p_correct then
    update public.match_players set correct_count = correct_count + 1
      where match_id = p_match_id and user_id = p_user_id;
  else
    update public.match_players set wrong_count = wrong_count + 1
      where match_id = p_match_id and user_id = p_user_id;
  end if;
end $$;
