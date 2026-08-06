import { supabase } from '../supabaseClient';

export interface StudyStreakInfo {
  multiplier: number; // current × level (1..5)
  todaySeconds: number; // seconds studied in the current day-window
  targetSeconds: number; // seconds needed today to advance the multiplier tomorrow (120 min, exported as STUDY_TARGET_SECONDS)
  atRisk: boolean; // yesterday's day-window didn't reach the target, so the next study session will reset the multiplier to ×1
  resetAt: number; // epoch ms of the next day-boundary (5am Cairo) — when today's count clears
}

export const STUDY_TARGET_SECONDS = 120 * 60;
const MAX_MULTIPLIER = 5;
const DAY_START_MS = 5 * 60 * 60 * 1000; // the streak "day" starts at 5am Cairo, not midnight

const CAIRO_TZ_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Africa/Cairo',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hour12: false,
});

function cairoWallClockAsUTC(d: Date): number {
  const parts = CAIRO_TZ_FORMAT.formatToParts(d);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const hour = get('hour') % 24;
  return Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'));
}

function streakDateKey(d: Date): string {
  const shifted = new Date(cairoWallClockAsUTC(d) - DAY_START_MS);
  return shifted.toISOString().slice(0, 10);
}

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
  const currentOffsetMs = cairoWallMs - now.getTime();
  return boundaryWallMs - currentOffsetMs;
}

export async function getUserStudyStreak(userId: string): Promise<StudyStreakInfo> {
  const { data, error } = await supabase
    .from('study_streaks')
    .select('current_multiplier,last_study_date,today_seconds')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;

  const now = new Date();
  const resetAt = nextResetAt(now);

  if (!data) {
    return { multiplier: 1, todaySeconds: 0, targetSeconds: STUDY_TARGET_SECONDS, atRisk: false, resetAt };
  }

  const today = streakDateKey(now);
  const yesterday = streakDateKey(new Date(now.getTime() - 24 * 60 * 60 * 1000));

  const isToday = data.last_study_date === today;
  const isYesterday = data.last_study_date === yesterday;
  const todaySeconds = isToday ? data.today_seconds : 0;
  const multiplier = Math.min(data.current_multiplier, MAX_MULTIPLIER);

  return {
    multiplier,
    todaySeconds,
    targetSeconds: STUDY_TARGET_SECONDS,
    atRisk: !isToday && !isYesterday,
    resetAt,
  };
}

/** Live-updates the badge as study sessions are logged, via Supabase Realtime. */
export function subscribeToStudyStreak(userId: string, onChange: () => void): () => void {
  const channel = supabase
    .channel(`study-streak-${userId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'study_streaks', filter: `user_id=eq.${userId}` },
      onChange
    )
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}
