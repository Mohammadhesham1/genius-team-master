-- ============================================================================
-- 1v1 stats fix — only count matches that actually finished
-- ----------------------------------------------------------------------------
-- STATUS: already applied on the live project (verified directly against
-- rtfivjmqlpbqlqdxpgzh). Kept here so the repo's schema history matches
-- reality — do not re-run blindly without diffing against the live view
-- first, since a further double-count fix (below) landed on top of this.
--
-- Bug: v_user_detail's matches_played/match_wins and onevone_answered/
-- onevone_correct, and v_rivalries' matches_played/wins, were counting rows
-- regardless of the match's status — a match still in the lobby or one that
-- got cancelled still counted as "played". Fix: join through matches and
-- filter to status = 'completed'.
-- ============================================================================

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
  select ma.answering_user_id user_id, count(*) onevone_answered,
         count(*) filter (where ma.judged_correct) onevone_correct,
         avg(ma.time_ms) avg_onevone_ms
  from public.match_answers ma
  join public.matches m on m.id = ma.match_id and m.status = 'completed'
  where ma.answering_user_id is not null
  group by ma.answering_user_id
) mv on mv.user_id = u.id
left join (
  select mp.user_id, count(*) matches_played, count(*) filter (where mp.result = 'win') match_wins
  from public.match_players mp
  join public.matches m on m.id = mp.match_id and m.status = 'completed'
  where mp.role = 'player'
  group by mp.user_id
) mp on mp.user_id = u.id;

-- ============================================================================
-- Follow-up fix (also already live): the first pass above joined
-- match_players to itself with `<>` (both directions) and then normalized
-- with least/greatest, which double-counted every pair's points/wins (each
-- match produced two raw rows that both got folded into the same group).
-- Using `mp1.user_id < mp2.user_id` as the join condition instead visits
-- each pair exactly once.
-- ============================================================================
create or replace view public.v_rivalries as
select
  mp1.user_id as user_a,
  mp2.user_id as user_b,
  count(*)    as matches_played,
  sum(mp1.correct_count) as points_a,
  sum(mp2.correct_count) as points_b,
  sum(case when mp1.result = 'win' then 1 else 0 end) as wins_a,
  sum(case when mp2.result = 'win' then 1 else 0 end) as wins_b
from public.match_players mp1
join public.match_players mp2
  on mp1.match_id = mp2.match_id and mp1.user_id < mp2.user_id and mp1.role = 'player' and mp2.role = 'player'
join public.matches m on m.id = mp1.match_id and m.status = 'completed'
group by mp1.user_id, mp2.user_id
order by matches_played desc;
