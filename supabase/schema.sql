-- ============================================================================
-- GENIUS TEAM (فريق العباقرة) — Supabase Schema (Fixed & Re-runnable)
-- ============================================================================
-- This is the exact schema used to set up the Supabase project this app
-- connects to (rtfivjmqlpbqlqdxpgzh). Kept here for reference / so you can
-- re-run it on a fresh project if needed. Run supabase/seed_content.sql
-- afterwards to get demo questions + content card titles.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 0. CLEANUP (حذف العناصر القديمة لتجنب التعارض عند إعادة التشغيل)
-- ────────────────────────────────────────────────────────────────────────────
drop view if exists public.v_user_detail cascade;
drop view if exists public.v_points_breakdown cascade;
drop view if exists public.v_rivalries cascade;
drop view if exists public.v_leaderboard cascade;
drop view if exists public.v_solo_leaderboard cascade;
drop view if exists public.v_solo_progress cascade;
drop view if exists public.v_group_speed cascade;
drop view if exists public.v_group_radar cascade;

drop table if exists public.user_streaks cascade;
drop table if exists public.points_ledger cascade;
drop table if exists public.user_points cascade;
drop table if exists public.group_answers cascade;
drop table if exists public.group_sessions cascade;
drop table if exists public.match_players cascade;
drop table if exists public.match_answers cascade;
drop table if exists public.match_questions cascade;
drop table if exists public.match_invites cascade;
drop table if exists public.matches cascade;
drop table if exists public.match_bank_cursor cascade;
drop table if exists public.solo_answers cascade;
drop table if exists public.solo_progress cascade;
drop table if exists public.group_round_questions cascade;
drop table if exists public.questions cascade;
drop table if exists public.content_cards cascade;
drop table if exists public.device_sessions cascade;
drop table if exists public.user_subjects cascade;
drop table if exists public.subjects cascade;
drop table if exists public.users cascade;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. EXTENSIONS & TABLES
-- ────────────────────────────────────────────────────────────────────────────
create extension if not exists "pgcrypto";

create table if not exists public.users (
  id                  text primary key,
  name                text not null,
  name_en             text not null,
  password            text not null,
  row_side            text not null check (row_side in ('right','left')),
  color               text not null,
  gradient            text not null,
  nicknames           jsonb not null default '[]'::jsonb,
  heba_english_only   boolean not null default false,
  created_at          timestamptz not null default now()
);

create table if not exists public.subjects (
  id        text primary key,
  name      text not null,
  name_en   text not null,
  color     text not null,
  glow      text not null,
  grad_from text not null,
  grad_to   text not null,
  sort_order int not null default 0
);

create table if not exists public.user_subjects (
  user_id    text references public.users(id) on delete cascade,
  subject_id text references public.subjects(id) on delete cascade,
  primary key (user_id, subject_id)
);

create table if not exists public.device_sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      text references public.users(id) on delete cascade,
  device_id    text not null,
  auth_uid     uuid,
  logged_in_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists idx_device_sessions_user on public.device_sessions (user_id);

create table if not exists public.content_cards (
  id            uuid primary key default gen_random_uuid(),
  subject_id    text references public.subjects(id) on delete cascade,
  title         text not null,
  type          text not null check (type in ('pdf','image','imageGroup','link')),
  url           text,
  images        jsonb,
  file_size_mb  numeric,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists idx_content_cards_subject on public.content_cards (subject_id);

create table if not exists public.questions (
  id          bigint generated always as identity primary key,
  subject_id  text references public.subjects(id) on delete cascade,
  position    int,
  question    text not null,
  answer      text not null,
  unique (subject_id, position)
);
create index if not exists idx_questions_subject_pos on public.questions (subject_id, position);

create or replace function public.trg_auto_position_questions()
returns trigger language plpgsql as $$
begin
  if new.position is null then
    select coalesce(max(position), 0) + 1 into new.position
    from public.questions where subject_id = new.subject_id;
  end if;
  return new;
end $$;

drop trigger if exists t_auto_position_questions on public.questions;
create trigger t_auto_position_questions
before insert on public.questions
for each row execute function public.trg_auto_position_questions();

create table if not exists public.group_round_questions (
  id          bigint generated always as identity primary key,
  subject_id  text references public.subjects(id) on delete cascade,
  round_no    int not null,
  position    int,
  question    text not null,
  answer      text not null,
  unique (subject_id, round_no, position)
);

create or replace function public.trg_auto_position_group_q()
returns trigger language plpgsql as $$
begin
  if new.position is null then
    select coalesce(max(position), 0) + 1 into new.group_round_questions
    where subject_id = new.subject_id and round_no = new.round_no;
  end if;
  return new;
end $$;

drop trigger if exists t_auto_position_group_q on public.group_round_questions;
create trigger t_auto_position_group_q
before insert on public.group_round_questions
for each row execute function public.trg_auto_position_group_q();

-- ────────────────────────────────────────────────────────────────────────────
-- 2. SOLO, MATCHES, GROUP & POINTS TABLES
-- ────────────────────────────────────────────────────────────────────────────

create table if not exists public.solo_progress (
  user_id       text references public.users(id) on delete cascade,
  subject_id    text references public.subjects(id) on delete cascade,
  next_position int not null default 1,
  primary key (user_id, subject_id)
);

create table if not exists public.solo_answers (
  id             bigint generated always as identity primary key,
  user_id        text references public.users(id) on delete cascade,
  subject_id     text references public.subjects(id) on delete cascade,
  question_id    bigint references public.questions(id),
  first_answer   text,
  first_time_ms  int,
  second_answer  text,
  second_time_ms int,
  is_correct     boolean,
  correct_on     smallint,
  is_review      boolean not null default false,
  answered_at    timestamptz not null default now()
);
create index if not exists idx_solo_answers_user_subj on public.solo_answers (user_id, subject_id);

create table if not exists public.match_bank_cursor (
  subject_id  text primary key references public.subjects(id) on delete cascade,
  last_used_position int
);

create table if not exists public.matches (
  id            uuid primary key default gen_random_uuid(),
  subject_id    text references public.subjects(id),
  creator_id    text references public.users(id),
  referee_id    text references public.users(id),
  status        text not null default 'lobby'
                check (status in ('lobby','active','completed','cancelled')),
  current_qidx  int not null default 0,
  -- Set by the referee (never the client's own clock) each time they start
  -- the countdown for the current question. Null = timer not running yet.
  -- All participants derive the same countdown from this single timestamp.
  question_started_at timestamptz,
  created_at    timestamptz not null default now(),
  started_at    timestamptz,
  ended_at      timestamptz
);

create table if not exists public.match_invites (
  id            uuid primary key default gen_random_uuid(),
  match_id      uuid references public.matches(id) on delete cascade,
  to_user_id    text references public.users(id),
  is_ref        boolean not null default false,
  status        text not null default 'pending'
                check (status in ('pending','accepted','rejected','cancelled')),
  created_at    timestamptz not null default now(),
  responded_at  timestamptz
);
create index if not exists idx_match_invites_match on public.match_invites (match_id);
create index if not exists idx_match_invites_user_status on public.match_invites (to_user_id, status);
-- Prevents inviting the same person twice into the same match while their
-- first invite is still pending (they can be re-invited once it resolves).
create unique index if not exists uq_match_invites_pending
  on public.match_invites (match_id, to_user_id)
  where status = 'pending';

create table if not exists public.match_questions (
  match_id    uuid references public.matches(id) on delete cascade,
  position    int not null,
  question_id bigint references public.questions(id),
  primary key (match_id, position)
);

create table if not exists public.match_answers (
  id           bigint generated always as identity primary key,
  match_id     uuid references public.matches(id) on delete cascade,
  position     int not null,
  answering_user_id text references public.users(id),
  attempt_no   smallint not null default 1,
  time_ms      int,
  answer_text  text,
  judged_correct boolean,
  judged_by    text references public.users(id),
  judged_at    timestamptz,
  answered_at  timestamptz not null default now()
);
create index if not exists idx_match_answers_match on public.match_answers (match_id);

create table if not exists public.match_players (
  match_id      uuid references public.matches(id) on delete cascade,
  user_id       text references public.users(id),
  role          text not null check (role in ('player','referee')),
  correct_count int not null default 0,
  wrong_count   int not null default 0,
  result        text check (result in ('win','loss','draw')),
  primary key (match_id, user_id)
);

create table if not exists public.group_sessions (
  id            uuid primary key default gen_random_uuid(),
  subject_id    text references public.subjects(id),
  round_no      int not null,
  host_user_id  text references public.users(id),
  status        text not null default 'active' check (status in ('active','completed')),
  current_qidx  int not null default 0,
  started_at    timestamptz not null default now(),
  ended_at      timestamptz
);

create table if not exists public.group_answers (
  id            bigint generated always as identity primary key,
  session_id    uuid references public.group_sessions(id) on delete cascade,
  position      int not null,
  attempt_no    smallint not null default 1,
  time_ms       int not null,
  is_correct    boolean not null,
  credited_user_id text references public.users(id),
  answered_at   timestamptz not null default now()
);
create index if not exists idx_group_answers_session on public.group_answers (session_id);
create index if not exists idx_group_answers_user on public.group_answers (credited_user_id);

create table if not exists public.user_points (
  user_id      text primary key references public.users(id) on delete cascade,
  total_points double precision not null default 0,
  updated_at   timestamptz not null default now()
);

create table if not exists public.points_ledger (
  id         bigint generated always as identity primary key,
  user_id    text references public.users(id) on delete cascade,
  mode       text not null check (mode in ('solo','group','oneVone')),
  points     double precision not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_points_ledger_user_mode on public.points_ledger (user_id, mode);

create table if not exists public.user_streaks (
  user_id           text primary key references public.users(id) on delete cascade,
  current_multiplier smallint not null default 1,
  last_solo_date     date,
  today_solo_count    int not null default 0
);

-- ────────────────────────────────────────────────────────────────────────────
-- 3. FUNCTIONS & TRIGGERS
-- ────────────────────────────────────────────────────────────────────────────

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
    return; -- nothing to deal; caller ends up with an empty match_questions set
  end if;

  insert into public.match_bank_cursor (subject_id, last_used_position)
  values (p_subject_id, null)
  on conflict (subject_id) do nothing;

  -- Row-locked per subject: two matches created back-to-back (even a couple
  -- of seconds apart) for the same subject serialize on this lock, so the
  -- second one always gets the *next* block down, never a repeat.
  select last_used_position into v_cursor
  from public.match_bank_cursor where subject_id = p_subject_id for update;

  v_end := coalesce(v_cursor, v_total);
  if v_end <= 0 then
    -- Bank fully cycled through — wrap back to the newest block instead of
    -- dead-ending on an empty range forever.
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

-- Atomically bumps a match_players row's correct/wrong count when the
-- referee judges an attempt, instead of a read-then-write from the client.
-- Used by the 1v1 match room (src/lib/api/matches.ts).
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
  -- supabase/streak_day_boundary.sql for the standalone migration.
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
    -- 1×multiplier points — see supabase/solo_review.sql.
    v_points := case when new.is_review then v_mult / 2.0 else v_mult::double precision end;
    perform public.fn_award_points(new.user_id, v_points, 'solo');
  end if;
  return new;
end $$;

drop trigger if exists t_solo_answer_points on public.solo_answers;
create trigger t_solo_answer_points
after insert on public.solo_answers
for each row execute function public.trg_solo_answer_points();

create or replace function public.trg_group_answer_points()
returns trigger language plpgsql as $$
begin
  if new.is_correct and new.credited_user_id is not null then
    perform public.fn_award_points(new.credited_user_id, 5, 'group');
  end if;
  return new;
end $$;

drop trigger if exists t_group_answer_points on public.group_answers;
create trigger t_group_answer_points
after insert on public.group_answers
for each row execute function public.trg_group_answer_points();

-- 1v1 points are awarded once, when the match actually finishes (3 points
-- per correct answer) — not per judged answer. That way a match that never
-- completes (cancelled mid-way, host ends the round early) never hands out
-- points nobody should have gotten.
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

drop trigger if exists t_match_answer_points on public.match_answers;
drop trigger if exists t_match_completed_points on public.matches;
create trigger t_match_completed_points
after update on public.matches
for each row execute function public.trg_match_completed_award_points();

-- ────────────────────────────────────────────────────────────────────────────
-- 4. VIEWS
-- ────────────────────────────────────────────────────────────────────────────

create or replace view public.v_group_radar as
select ga.credited_user_id as user_id, gs.subject_id,
       count(*) filter (where ga.is_correct) as correct_count
from public.group_answers ga
join public.group_sessions gs on gs.id = ga.session_id
group by ga.credited_user_id, gs.subject_id;

create or replace view public.v_group_speed as
select credited_user_id as user_id,
       avg(time_ms) filter (where is_correct)      as avg_correct_ms,
       avg(time_ms) filter (where not is_correct)  as avg_wrong_ms,
       avg(time_ms)                                as avg_overall_ms
from public.group_answers
where credited_user_id is not null
group by credited_user_id;

create or replace view public.v_solo_progress as
select user_id,
       count(*) as done_count,
       count(*) filter (where is_correct) as correct_count,
       round(100.0 * count(*) filter (where is_correct) / greatest(count(*),1), 1) as accuracy_pct
from public.solo_answers
group by user_id;

create or replace view public.v_solo_leaderboard as
select user_id, count(*) as questions_done
from public.solo_answers
group by user_id
order by questions_done desc;

create or replace view public.v_leaderboard as
select u.id as user_id, u.name, u.name_en,
       coalesce(p.total_points, 0) as total_points
from public.users u
left join public.user_points p on p.user_id = u.id
order by total_points desc;

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
-- 5. ROW LEVEL SECURITY (RLS)
-- ────────────────────────────────────────────────────────────────────────────

alter table public.users                  enable row level security;
alter table public.subjects                enable row level security;
alter table public.user_subjects           enable row level security;
alter table public.device_sessions         enable row level security;
alter table public.content_cards           enable row level security;
alter table public.questions               enable row level security;
alter table public.group_round_questions   enable row level security;
alter table public.solo_progress           enable row level security;
alter table public.solo_answers            enable row level security;
alter table public.match_bank_cursor       enable row level security;
alter table public.matches                 enable row level security;
alter table public.match_invites           enable row level security;
alter table public.match_questions         enable row level security;
alter table public.match_answers           enable row level security;
alter table public.match_players           enable row level security;
alter table public.group_sessions          enable row level security;
alter table public.group_answers           enable row level security;
alter table public.user_points             enable row level security;
alter table public.points_ledger           enable row level security;
alter table public.user_streaks            enable row level security;

do $$
declare t text;
begin
  for t in select unnest(array[
    'users','subjects','user_subjects','content_cards','questions',
    'group_round_questions','solo_progress','solo_answers','match_bank_cursor',
    'matches','match_invites','match_questions','match_answers','match_players',
    'group_sessions','group_answers','user_points','points_ledger','user_streaks','device_sessions'
  ]) loop
    execute format('drop policy if exists "anon_read_%1$s" on public.%1$s;', t);
    execute format('create policy "anon_read_%1$s" on public.%1$s for select using (true);', t);
  end loop;

  for t in select unnest(array[
    'device_sessions','solo_progress','solo_answers','match_bank_cursor',
    'matches','match_invites','match_questions','match_answers','match_players',
    'group_sessions','group_answers','user_points','points_ledger','user_streaks'
  ]) loop
    execute format('drop policy if exists "anon_write_%1$s" on public.%1$s;', t);
    execute format('drop policy if exists "anon_update_%1$s" on public.%1$s;', t);
    execute format('create policy "anon_write_%1$s" on public.%1$s for insert with check (true);', t);
    execute format('create policy "anon_update_%1$s" on public.%1$s for update using (true) with check (true);', t);
  end loop;
end $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 6. REALTIME PUBLICATION
-- ────────────────────────────────────────────────────────────────────────────

do $$
declare
  t text;
begin
  for t in select unnest(array[
    'matches','match_invites','match_questions','match_answers',
    'match_players','group_sessions','group_answers','user_points','user_streaks'
  ]) loop
    if not exists (
      select 1 from pg_publication_tables 
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I;', t);
    end if;
  end loop;
end $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 7. SEED DATA
-- ────────────────────────────────────────────────────────────────────────────

insert into public.users (id,name,name_en,password,row_side,color,gradient,nicknames,heba_english_only) values
('mohamed','محمد','Mohamed','847291','right','#3b82f6','linear-gradient(135deg,#3b82f6,#8b5cf6)','["دون","لورد","Godfather","عراب"]',false),
('hassan','حسن','Hassan','362815','right','#8b5cf6','linear-gradient(135deg,#8b5cf6,#ec4899)','["سوني","سانتينو","جابريال"]',false),
('omar','عمر','Omar','591047','right','#06b6d4','linear-gradient(135deg,#06b6d4,#3b82f6)','["مايسترو","بومبر"]',false),
('ahmed','أحمد','Ahmed','728634','right','#10b981','linear-gradient(135deg,#10b981,#06b6d4)','[]',false),
('heba','هبة','Heba','483726','left','#ec4899','linear-gradient(135deg,#ec4899,#f97316)','["Ms Donadei"]',true),
('nour','نور','Nour','619284','left','#f59e0b','linear-gradient(135deg,#f59e0b,#ef4444)','[]',false),
('mira','ميرا','Mira','374918','left','#ef4444','linear-gradient(135deg,#ef4444,#8b5cf6)','[]',false),
('alaa','آلاء','Alaa','256743','left','#a855f7','linear-gradient(135deg,#a855f7,#3b82f6)','[]',false)
on conflict (id) do nothing;

insert into public.subjects (id,name,name_en,color,glow,grad_from,grad_to,sort_order) values
('geography','جغرافيا','Geography','#00d4ff','rgba(0,212,255,0.5)','#0ea5e9','#0284c7',1),
('history','تاريخ','History','#f59e0b','rgba(245,158,11,0.5)','#f59e0b','#b45309',2),
('literature','أدب','Literature','#f472b6','rgba(244,114,182,0.5)','#ec4899','#be185d',3),
('science','علوم','Science','#34d399','rgba(52,211,153,0.5)','#10b981','#047857',4),
('general','معلومات عامة','General Knowledge','#60a5fa','rgba(96,165,250,0.5)','#3b82f6','#1d4ed8',5),
('sports','رياضة','Sports','#fb923c','rgba(251,146,60,0.5)','#f97316','#c2410c',6),
('tech','تكنولوجيا','Technology','#c084fc','rgba(192,132,252,0.5)','#a855f7','#7e22ce',7),
('mental','قدرات ذهنية','Mental Abilities','#818cf8','rgba(129,140,248,0.5)','#6366f1','#4338ca',8),
('cinema','سينما ومسرح','Cinema & Theater','#f87171','rgba(248,113,113,0.5)','#ef4444','#b91c1c',9),
('music','أغاني وموسيقى','Music','#a78bfa','rgba(167,139,250,0.5)','#7c3aed','#5b21b6',10),
('art','لوحات ومعالم','Art & Landmarks','#fbbf24','rgba(251,191,36,0.5)','#d97706','#92400e',11),
('quickwit','سرعة بديهة','Quick Wit','#2dd4bf','rgba(45,212,191,0.5)','#0d9488','#0f766e',12)
on conflict (id) do nothing;

insert into public.user_subjects (user_id, subject_id)
select 'mohamed', id from public.subjects
union all select v.u, v.s from (values
  ('hassan','geography'),('hassan','sports'),('hassan','general'),('hassan','mental'),('hassan','quickwit'),
  ('ahmed','history'),('ahmed','science'),('ahmed','tech'),('ahmed','general'),('ahmed','mental'),('ahmed','quickwit'),
  ('omar','science'),('omar','sports'),('omar','general'),('omar','mental'),('omar','quickwit'),
  ('heba','literature'),('heba','art'),('heba','music'),('heba','general'),('heba','mental'),('heba','quickwit'),
  ('nour','geography'),('nour','science'),('nour','general'),('nour','mental'),('nour','quickwit'),
  ('alaa','cinema'),('alaa','music'),('alaa','general'),('alaa','mental'),('alaa','quickwit'),
  ('mira','art'),('mira','general'),('mira','mental'),('mira','quickwit')
) as v(u,s)
on conflict (user_id, subject_id) do nothing;

insert into public.user_points (user_id, total_points)
select id, 0 from public.users
on conflict (user_id) do nothing;

insert into public.user_streaks (user_id, current_multiplier, last_solo_date, today_solo_count)
select id, 1, null, 0 from public.users
on conflict (user_id) do nothing;
