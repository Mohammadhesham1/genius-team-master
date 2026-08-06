-- ============================================================================
-- Streak day boundary — "today" starts at 5am (Africa/Cairo), not midnight
-- ----------------------------------------------------------------------------
-- Only replaces the trigger function trg_solo_answer_points(); doesn't touch
-- any table or data. Safe to re-run on the existing project at any time.
-- ============================================================================

create or replace function public.trg_solo_answer_points()
returns trigger language plpgsql as $$
declare
  v_mult smallint;
  -- Day rolls over at 5am Cairo time instead of UTC midnight. Using the named
  -- zone (not a hardcoded +2h) means Postgres applies Egypt's DST rule (UTC+3
  -- late Apr–late Oct, UTC+2 otherwise, reinstated in 2023) automatically.
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
    perform public.fn_award_points(new.user_id, 1 * v_mult, 'solo');
  end if;
  return new;
end $$;

-- Trigger itself is unchanged (still fires after insert on solo_answers), so
-- no need to drop/recreate it — replacing the function body is enough.
