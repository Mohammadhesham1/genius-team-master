-- ============================================================================
-- 1v1 points: award once, on match completion — not per judged answer
-- ----------------------------------------------------------------------------
-- STATUS: already applied on the live project (verified directly against
-- rtfivjmqlpbqlqdxpgzh). Kept here so the repo matches reality; safe to
-- re-run.
--
-- Old behaviour (schema.sql's original t_match_answer_points): 2 points the
-- instant the referee marked an answer correct. Problem: a match that never
-- finishes (host cancels it, someone withdraws, it just gets abandoned)
-- still handed out points for whatever got judged correct along the way.
--
-- New behaviour: no points during play. When a match's status flips to
-- 'completed', each player is awarded 3 points per correct answer they
-- ended the match with, in one pass. A match that never completes awards
-- nothing.
-- ============================================================================

drop trigger if exists t_match_answer_points on public.match_answers;

create or replace function public.trg_match_completed_award_points()
returns trigger language plpgsql as $$
declare
  r record;
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    for r in
      select user_id, correct_count from public.match_players
      where match_id = new.id and role = 'player'
    loop
      if r.correct_count > 0 then
        perform public.fn_award_points(r.user_id, r.correct_count * 3, 'oneVone');
      end if;
    end loop;
  end if;
  return new;
end $$;

drop trigger if exists t_match_completed_points on public.matches;
create trigger t_match_completed_points
after update on public.matches
for each row execute function public.trg_match_completed_award_points();
