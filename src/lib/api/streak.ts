import { supabase } from '../supabaseClient';

export interface StreakInfo {
  multiplier: number; // current × level (1..5)
  todayCount: number; // correct solo answers counted in the current day-window
  target: number; // answers needed today to advance the multiplier tomorrow (fixed at 50, exported as LEVEL_TARGET)
  atRisk: boolean; // yesterday's day-window wasn't kept, so the next correct answer will reset the multiplier to ×1
  resetAt: number; // epoch ms of the next day-boundary (5am Cairo) — when today's count clears
}

export const LEVEL_TARGET = 50;
const MAX_MULTIPLIER = 5;
const DAY_START_MS = 5 * 60 * 60 * 1000; // the streak "day" starts at 5am Cairo, not midnight

const CAIRO_TZ_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Africa/Cairo',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hour12: false,
});

/**
 * Egypt observes DST (UTC+3 late Apr–late Oct, UTC+2 otherwise) since 2023,
 * so the offset isn't fixed — reading it via Intl (real IANA tz data) instead
 * of hardcoding +2h keeps this correct across the DST switch automatically.
 * Returns the Cairo wall-clock instant for `d`, encoded as if it were UTC
 * (so plain Date.UTC/getUTC* arithmetic below works on "Cairo time").
 */
function cairoWallClockAsUTC(d: Date): number {
  const parts = CAIRO_TZ_FORMAT.formatToParts(d);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const hour = get('hour') % 24; // some locales report midnight as "24"
  return Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'));
}

// The trading "day" for the streak starts at 5am Cairo local time instead of
// midnight — mirrors the boundary used by trg_solo_answer_points() in
// supabase/streak_day_boundary.sql (Postgres's `at time zone 'Africa/Cairo'`
// is already DST-aware via its own tzdata).
function streakDateKey(d: Date): string {
  const shifted = new Date(cairoWallClockAsUTC(d) - DAY_START_MS);
  return shifted.toISOString().slice(0, 10);
}

/** Epoch ms of the next 5am-Cairo boundary at or after `now`. */
function nextResetAt(now: Date): number {
  const cairoWallMs = cairoWallClockAsUTC(now);
  const cairoWallDate = new Date(cairoWallMs);
  const boundaryTodayWallMs = Date.UTC(
    cairoWallDate.getUTCFullYear(),
    cairoWallDate.getUTCMonth(),
    cairoWallDate.getUTCDate(),
    5, 0, 0, 0
  );
  const boundaryWallMs = boundaryTodayWallMs > cairoWallMs ? boundaryTodayWallMs : boundaryTodayWallMs + 24 * 60 * 60 * 1000;
  const currentOffsetMs = cairoWallMs - now.getTime(); // Cairo minus UTC, right now (+2h or +3h depending on DST)
  return boundaryWallMs - currentOffsetMs;
}

export async function getUserStreak(userId: string): Promise<StreakInfo> {
  const { data, error } = await supabase
    .from('user_streaks')
    .select('current_multiplier,last_solo_date,today_solo_count')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;

  const now = new Date();
  const resetAt = nextResetAt(now);

  if (!data) {
    return { multiplier: 1, todayCount: 0, target: LEVEL_TARGET, atRisk: false, resetAt };
  }

  const today = streakDateKey(now);
  const yesterday = streakDateKey(new Date(now.getTime() - 24 * 60 * 60 * 1000));

  const isToday = data.last_solo_date === today;
  const isYesterday = data.last_solo_date === yesterday;
  const todayCount = isToday ? data.today_solo_count : 0;
  const multiplier = Math.min(data.current_multiplier, MAX_MULTIPLIER);

  return {
    multiplier,
    todayCount,
    target: LEVEL_TARGET,
    atRisk: !isToday && !isYesterday,
    resetAt,
  };
}

/**
 * Live-updates the streak badge as solo answers come in — via Supabase
 * Realtime (cross-device/cross-tab, needs supabase/streak_realtime.sql
 * applied) AND a same-tab window event (instant, no network round trip:
 * see notifyStreakChanged, called right after a correct answer is saved).
 */
export function subscribeToStreak(userId: string, onChange: () => void): () => void {
  const channel = supabase
    .channel(`user-streak-${userId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'user_streaks', filter: `user_id=eq.${userId}` },
      onChange
    )
    .subscribe();

  const eventName = `streak-changed:${userId}`;
  window.addEventListener(eventName, onChange);

  return () => {
    supabase.removeChannel(channel);
    window.removeEventListener(eventName, onChange);
  };
}

/** Call right after a correct solo answer is confirmed saved, so every StreakBadge for this user refreshes immediately in this tab. */
export function notifyStreakChanged(userId: string): void {
  window.dispatchEvent(new CustomEvent(`streak-changed:${userId}`));
}
