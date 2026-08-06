-- ============================================================================
-- v_rivalries: only count genuine 1-on-1 matches
-- ----------------------------------------------------------------------------
-- STATUS: already applied on the live project (rtfivjmqlpbqlqdxpgzh).
--
-- Bug: this room allows more than 2 players (host can invite multiple
-- players + a referee), but v_rivalries paired up EVERY player in a match
-- as if it were a head-to-head. A single 4-player match between Ahmed,
-- Heba, Mohamed and Nour was fanned out into 6 separate "rivalries" (every
-- pair), inflating each pair's matches_played and win counts.
--
-- Verified against real data: Ahmed vs Heba's true head-to-head is 3
-- matches, 2 wins Ahmed / 1 win Heba — the buggy view showed 4 matches and
-- a 2-2 split because of one shared 4-player match.
--
-- Fix: only count a match toward a pair's rivalry if it had exactly 2
-- players (the referee doesn't count).
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
where (select count(*) from public.match_players x where x.match_id = mp1.match_id and x.role = 'player') = 2
group by mp1.user_id, mp2.user_id
order by matches_played desc;
