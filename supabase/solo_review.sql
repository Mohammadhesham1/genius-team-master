-- ============================================================================
-- Solo review round — wrong answers reappear once a subject is finished,
-- worth exactly half the usual points when answered correctly there
-- ----------------------------------------------------------------------------
-- Adds `is_review` to solo_answers (default false, so every existing row is
-- unaffected) and updates the points trigger to award exactly half points
-- (0.5, 1, 1.5, 2, 2.5 for ×1..×5) whenever it's true — no rounding/flooring.
-- That means user_points.total_points and points_ledger.points need to hold
-- fractional values, so they're widened from int to double precision (a
-- lossless, backward-compatible change for the whole-number values already
-- stored — PostgREST still returns double precision as a plain JSON number,
-- unlike numeric, so no frontend changes are needed).
--
-- The review question list itself is just read back from the existing
-- solo_answers history on the frontend (latest attempt per question, kept if
-- it was wrong) — no backfill needed, so this already applies retroactively
-- to everyone who finished a subject earlier.
-- Safe to re-run.
-- ============================================================================

alter table public.solo_answers add column if not exists is_review boolean not null default false;

-- v_leaderboard, v_points_breakdown, and v_user_detail all read from
-- total_points/points, so Postgres blocks ALTER COLUMN TYPE while they
-- depend on it — drop them first (child-most first), widen the columns,
-- then recreate all three exactly as defined in schema.sql.
drop view if exists public.v_user_detail;
drop view if exists public.v_points_breakdown;
drop view if exists public.v_leaderboard;

alter table public.user_points
  alter column total_points type double precision using total_points::double precision,
  alter column total_points set default 0;

alter table public.points_ledger
  alter column points type double precision using points::double precision;

create or replace view public.v_leaderboard as
select u.id as user_id, u.name, u.name_en,
       coalesce(p.total_points, 0) as total_points
from public.users u
left join public.user_points p on p.user_id = u.id
order by total_points desc;

create or replace view public.v_points_breakdown as
select user_id,
       sum(points) filter (where mode = 'solo')    as solo_points,
       sum(points) filter (where mode = 'group')   as group_points,
       sum(points) filter (where mode = 'oneVone') as onevone_points,
       sum(points)                                 as total_points
from public.points_ledger
group by user_id;

create or replace view public.v_user_detail as
select
  u.id as user_id, u.name, u.name_en,
  coalesce(pb.total_points, 0)    as total_points,
  coalesce(pb.solo_points, 0)     as solo_points,
  coalesce(pb.group_points, 0)    as group_points,
  coalesce(pb.onevone_points, 0)  as onevone_points,
  rank() over (order by coalesce(pb.total_points, 0) desc) as leaderboard_rank,

  coalesce(sa.solo_answered, 0)   as solo_answered,
  coalesce(sa.solo_correct, 0)    as solo_correct,
  sa.avg_solo_ms,

  coalesce(ga.group_answered, 0)  as group_answered,
  coalesce(ga.group_correct, 0)   as group_correct,
  ga.avg_group_correct_ms,
  ga.avg_group_wrong_ms,
  ga.avg_group_overall_ms,

  coalesce(mv.onevone_answered, 0) as onevone_answered,
  coalesce(mv.onevone_correct, 0)  as onevone_correct,
  mv.avg_onevone_ms,
  coalesce(mp.matches_played, 0)   as matches_played,
  coalesce(mp.match_wins, 0)       as match_wins
from public.users u
left join public.v_points_breakdown pb on pb.user_id = u.id
left join (
  select user_id, count(*) solo_answered, count(*) filter (where is_correct) solo_correct,
         avg(coalesce(first_time_ms, second_time_ms)) avg_solo_ms
  from public.solo_answers group by user_id
) sa on sa.user_id = u.id
left join (
  select credited_user_id user_id, count(*) group_answered,
         count(*) filter (where is_correct) group_correct,
         avg(time_ms) filter (where is_correct) avg_group_correct_ms,
         avg(time_ms) filter (where not is_correct) avg_group_wrong_ms,
         avg(time_ms) avg_group_overall_ms
  from public.group_answers where credited_user_id is not null group by credited_user_id
) ga on ga.user_id = u.id
left join (
  select answering_user_id user_id, count(*) onevone_answered,
         count(*) filter (where judged_correct) onevone_correct,
         avg(time_ms) avg_onevone_ms
  from public.match_answers where answering_user_id is not null group by answering_user_id
) mv on mv.user_id = u.id
left join (
  select user_id, count(*) matches_played, count(*) filter (where result = 'win') match_wins
  from public.match_players where role = 'player' group by user_id
) mp on mp.user_id = u.id;

-- Changing the points argument from int to double precision is a new
-- signature, not just a body change — drop the old int-typed overload first
-- so calls resolve to exactly one function.
drop function if exists public.fn_award_points(text, int, text);

create or replace function public.fn_award_points(p_user_id text, p_points double precision, p_mode text)
returns void language plpgsql as $$
begin
  insert into public.user_points (user_id, total_points)
  values (p_user_id, p_points)
  on conflict (user_id) do update
    set total_points = public.user_points.total_points + excluded.total_points,
        updated_at = now();

  insert into public.points_ledger (user_id, mode, points)
  values (p_user_id, p_mode, p_points);
end $$;

create or replace function public.trg_solo_answer_points()
returns trigger language plpgsql as $$
declare
  v_mult smallint;
  v_points double precision;
  -- Day rolls over at 5am Cairo time, not UTC midnight — see
  -- supabase/streak_day_boundary.sql. Named zone (not a hardcoded offset) so
  -- Postgres applies Egypt's DST rule automatically.
  v_today date := ((now() at time zone 'Africa/Cairo') - interval '5 hours')::date;
  v_streak record;
begin
  if new.is_correct then
    select * into v_streak from public.user_streaks where user_id = new.user_id for update;
    if not found then
      insert into public.user_streaks (user_id, current_multiplier, last_solo_date, today_solo_count)
      values (new.user_id, 1, v_today, 1);
      v_mult := 1;
    else
      if v_streak.last_solo_date = v_today then
        update public.user_streaks
          set today_solo_count = today_solo_count + 1
          where user_id = new.user_id;
        v_mult := v_streak.current_multiplier;
      else
        if v_streak.last_solo_date = v_today - 1 and v_streak.today_solo_count >= 50 then
          update public.user_streaks
            set current_multiplier = least(v_streak.current_multiplier + 1, 5),
                last_solo_date = v_today,
                today_solo_count = 1
            where user_id = new.user_id
            returning current_multiplier into v_mult;
        else
          update public.user_streaks
            set current_multiplier = 1,
                last_solo_date = v_today,
                today_solo_count = 1
            where user_id = new.user_id;
          v_mult := 1;
        end if;
      end if;
    end if;

    -- Review-round correct answers are worth exactly half the normal
    -- 1×multiplier points — ×1→0.5, ×2→1, ×3→1.5, ×4→2, ×5→2.5.
    v_points := case when new.is_review then v_mult / 2.0 else v_mult::double precision end;
    perform public.fn_award_points(new.user_id, v_points, 'solo');
  end if;
  return new;
end $$;
