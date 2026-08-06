-- ============================================================================
-- Content study tracking — time spent reading PDFs, per-page breakdown (for
-- anti-cheat transparency: which page, how long, how many taps), points
-- (whole minutes only), daily cumulative bonuses, and leaderboard views.
-- Safe to re-run on the existing project at any time.
-- ============================================================================

create table if not exists public.content_study_sessions (
  id           bigint generated always as identity primary key,
  user_id      text references public.users(id) on delete cascade,
  card_id      uuid references public.content_cards(id) on delete cascade,
  subject_id   text references public.subjects(id) on delete cascade,
  seconds      int not null check (seconds > 0),
  -- "Today" here means the same 5am-Cairo boundary used everywhere else in
  -- the app (see streak_day_boundary.sql), computed once at insert time.
  study_date   date not null,
  created_at   timestamptz not null default now()
);
create index if not exists idx_study_sessions_user on public.content_study_sessions (user_id);
create index if not exists idx_study_sessions_user_date on public.content_study_sessions (user_id, study_date);
create index if not exists idx_study_sessions_user_subject on public.content_study_sessions (user_id, subject_id);
create index if not exists idx_study_sessions_user_subject_date on public.content_study_sessions (user_id, subject_id, study_date);

-- Per-page breakdown within a PDF: how long each page was in view, and how
-- many taps/touches happened while on it — the raw evidence used to catch
-- someone who just left the file open without reading.
create table if not exists public.content_page_stats (
  user_id      text references public.users(id) on delete cascade,
  card_id      uuid references public.content_cards(id) on delete cascade,
  subject_id   text references public.subjects(id) on delete cascade,
  study_date   date not null,
  page_number  int not null check (page_number > 0),
  seconds      int not null default 0,
  taps         int not null default 0,
  primary key (user_id, card_id, study_date, page_number)
);
create index if not exists idx_page_stats_user_subject_date on public.content_page_stats (user_id, subject_id, study_date);

-- Prevents re-awarding the same daily milestone bonus twice.
create table if not exists public.study_daily_bonus_awarded (
  user_id    text references public.users(id) on delete cascade,
  study_date date not null,
  tier       smallint not null check (tier in (2,3,4)),
  primary key (user_id, study_date, tier)
);

-- Carries leftover seconds under a full minute forward between calls, so
-- points are only ever awarded for whole minutes (2.5 pts each — fractions
-- of a point are at most .5, never anything messier).
create table if not exists public.study_points_remainder (
  user_id           text primary key references public.users(id) on delete cascade,
  remainder_seconds int not null default 0
);

-- Study streak: reaching 120 min (2h) in a 5am-boundary day advances the
-- multiplier (capped ×5) the next day; missing the target drops it back to
-- ×1. Same shape/semantics as user_streaks (see streak_day_boundary.sql),
-- just keyed off study minutes instead of solo-answer count.
create table if not exists public.study_streaks (
  user_id             text primary key references public.users(id) on delete cascade,
  current_multiplier  smallint not null default 1,
  last_study_date     date,
  today_seconds       int not null default 0
);

-- Allow the new 'study' mode in the shared points ledger.
alter table public.points_ledger drop constraint if exists points_ledger_mode_check;
alter table public.points_ledger add constraint points_ledger_mode_check
  check (mode in ('solo','group','oneVone','study'));

-- ────────────────────────────────────────────────────────────────────────────
-- Logs one chunk of study time (+ optional per-page breakdown), awards
-- 2.5 pts per WHOLE minute only (leftover seconds carry over, never lost),
-- and checks same-day cumulative bonuses: 2h → +100, 3h → +200, 4h → +200
-- (each tier only once per 5am-boundary day).
--
-- p_pages: jsonb array like [{"page":3,"seconds":25,"taps":4}, ...] — one
-- entry per page touched during this chunk. Optional; pass '[]' if unknown.
-- ────────────────────────────────────────────────────────────────────────────
drop function if exists public.fn_log_study_session(text, uuid, text, int);

create or replace function public.fn_log_study_session(
  p_user_id text, p_card_id uuid, p_subject_id text, p_seconds int, p_pages jsonb default '[]'::jsonb
)
returns void language plpgsql as $$
declare
  v_today date := ((now() at time zone 'Africa/Cairo') - interval '5 hours')::date;
  v_total_today int;
  v_tier record;
  v_remainder int;
  v_minutes int;
  v_page record;
  v_streak record;
  v_mult smallint;
begin
  if p_seconds is null or p_seconds <= 0 then
    return;
  end if;

  insert into public.content_study_sessions (user_id, card_id, subject_id, seconds, study_date)
  values (p_user_id, p_card_id, p_subject_id, p_seconds, v_today);

  -- Study streak: same day just accumulates; a new day checks whether
  -- yesterday (and only yesterday, no gap) reached the 120-min target.
  select * into v_streak from public.study_streaks where user_id = p_user_id for update;
  if not found then
    insert into public.study_streaks (user_id, current_multiplier, last_study_date, today_seconds)
    values (p_user_id, 1, v_today, p_seconds);
    v_mult := 1;
  else
    if v_streak.last_study_date = v_today then
      update public.study_streaks set today_seconds = today_seconds + p_seconds where user_id = p_user_id;
      v_mult := v_streak.current_multiplier;
    else
      if v_streak.last_study_date = v_today - 1 and v_streak.today_seconds >= 7200 then
        update public.study_streaks
          set current_multiplier = least(v_streak.current_multiplier + 1, 5),
              last_study_date = v_today,
              today_seconds = p_seconds
          where user_id = p_user_id
          returning current_multiplier into v_mult;
      else
        update public.study_streaks
          set current_multiplier = 1, last_study_date = v_today, today_seconds = p_seconds
          where user_id = p_user_id;
        v_mult := 1;
      end if;
    end if;
  end if;

  if p_pages is not null and jsonb_array_length(p_pages) > 0 then
    for v_page in select * from jsonb_to_recordset(p_pages) as x(page int, seconds int, taps int)
    loop
      if v_page.page is not null and (coalesce(v_page.seconds, 0) > 0 or coalesce(v_page.taps, 0) > 0) then
        insert into public.content_page_stats (user_id, card_id, subject_id, study_date, page_number, seconds, taps)
        values (p_user_id, p_card_id, p_subject_id, v_today, v_page.page, coalesce(v_page.seconds, 0), coalesce(v_page.taps, 0))
        on conflict (user_id, card_id, study_date, page_number)
        do update set seconds = public.content_page_stats.seconds + excluded.seconds,
                      taps    = public.content_page_stats.taps + excluded.taps;
      end if;
    end loop;
  end if;

  -- Whole-minute-only points, carrying the remainder forward.
  insert into public.study_points_remainder (user_id, remainder_seconds)
  values (p_user_id, p_seconds)
  on conflict (user_id) do update
    set remainder_seconds = public.study_points_remainder.remainder_seconds + excluded.remainder_seconds
  returning remainder_seconds into v_remainder;

  v_minutes := floor(v_remainder / 60.0);
  if v_minutes > 0 then
    update public.study_points_remainder set remainder_seconds = v_remainder - v_minutes * 60 where user_id = p_user_id;
    perform public.fn_award_points(p_user_id, v_minutes * 2.5 * v_mult, 'study');
  end if;

  select coalesce(sum(seconds), 0) into v_total_today
  from public.content_study_sessions
  where user_id = p_user_id and study_date = v_today;

  for v_tier in
    select * from (values (2, 7200, 100), (3, 10800, 200), (4, 14400, 200)) as t(tier, threshold_s, bonus)
  loop
    if v_total_today >= v_tier.threshold_s then
      insert into public.study_daily_bonus_awarded (user_id, study_date, tier)
      values (p_user_id, v_today, v_tier.tier)
      on conflict (user_id, study_date, tier) do nothing;
      if found then
        perform public.fn_award_points(p_user_id, v_tier.bonus, 'study');
      end if;
    end if;
  end loop;
end $$;

-- ────────────────────────────────────────────────────────────────────────────
-- Views for the leaderboard + drill-down UI.
-- ────────────────────────────────────────────────────────────────────────────
create or replace view public.v_study_leaderboard as
select
  user_id,
  coalesce(sum(seconds), 0) as total_seconds,
  coalesce(sum(seconds) filter (
    where study_date = ((now() at time zone 'Africa/Cairo') - interval '5 hours')::date
  ), 0) as today_seconds
from public.content_study_sessions
group by user_id;

create or replace view public.v_study_points as
select user_id, coalesce(sum(points), 0) as study_points
from public.points_ledger
where mode = 'study'
group by user_id;

create or replace view public.v_study_by_subject as
select user_id, subject_id, coalesce(sum(seconds), 0) as total_seconds
from public.content_study_sessions
group by user_id, subject_id;

create or replace view public.v_study_by_subject_daily as
select user_id, subject_id, study_date, coalesce(sum(seconds), 0) as seconds
from public.content_study_sessions
group by user_id, subject_id, study_date;

-- One row per page touched, with the card title attached — the day drill-down
-- reads straight from this.
create or replace view public.v_study_page_detail as
select
  ps.user_id, ps.subject_id, ps.study_date, ps.card_id,
  cc.title as card_title,
  ps.page_number, ps.seconds, ps.taps
from public.content_page_stats ps
join public.content_cards cc on cc.id = ps.card_id;

-- ────────────────────────────────────────────────────────────────────────────
-- Add study points as its own line item on the main leaderboard breakdown,
-- without disturbing any existing column (total_points already included
-- 'study' mode automatically since it just sums points_ledger — this just
-- surfaces it separately for display).
-- ────────────────────────────────────────────────────────────────────────────
create or replace view public.v_points_breakdown as
select user_id,
       sum(points) filter (where mode = 'solo')    as solo_points,
       sum(points) filter (where mode = 'group')   as group_points,
       sum(points) filter (where mode = 'oneVone') as onevone_points,
       sum(points)                                 as total_points,
       sum(points) filter (where mode = 'study')   as study_points
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
  coalesce(mp.match_wins, 0)       as match_wins,
  coalesce(pb.study_points, 0)     as study_points
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

-- ────────────────────────────────────────────────────────────────────────────
-- RLS — same open "anon" policy pattern as every other table in this project.
-- Without this, the app's anon key can't read/write these tables at all.
-- ────────────────────────────────────────────────────────────────────────────
alter table public.content_study_sessions    enable row level security;
alter table public.content_page_stats        enable row level security;
alter table public.study_daily_bonus_awarded  enable row level security;
alter table public.study_points_remainder     enable row level security;

do $$
declare t text;
begin
  for t in select unnest(array[
    'content_study_sessions','content_page_stats','study_daily_bonus_awarded','study_points_remainder','study_streaks'
  ]) loop
    execute format('drop policy if exists "anon_read_%1$s" on public.%1$s;', t);
    execute format('create policy "anon_read_%1$s" on public.%1$s for select using (true);', t);
    execute format('drop policy if exists "anon_write_%1$s" on public.%1$s;', t);
    execute format('create policy "anon_write_%1$s" on public.%1$s for insert with check (true);', t);
    execute format('drop policy if exists "anon_update_%1$s" on public.%1$s;', t);
    execute format('create policy "anon_update_%1$s" on public.%1$s for update using (true) with check (true);', t);
  end loop;
end $$;

-- Realtime, so the "studied today" badge updates live without a page refresh.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'content_study_sessions'
  ) then
    execute 'alter publication supabase_realtime add table public.content_study_sessions;';
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'study_streaks'
  ) then
    execute 'alter publication supabase_realtime add table public.study_streaks;';
  end if;
end $$;
