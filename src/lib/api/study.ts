import { supabase } from '../supabaseClient';
import { getUsersByIds } from '../auth';

export interface StudyLeaderboardRow {
  userId: string;
  name: string;
  color: string;
  gradient: string;
  totalSeconds: number;
  todaySeconds: number;
  studyPoints: number;
}

/** Ranked by total study time. Combines v_study_leaderboard (time) + v_study_points (points from 'study' mode). */
export async function getStudyLeaderboard(): Promise<StudyLeaderboardRow[]> {
  const [{ data: lb, error: e1 }, { data: pts, error: e2 }] = await Promise.all([
    supabase.from('v_study_leaderboard').select('*'),
    supabase.from('v_study_points').select('*'),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;

  const ptsMap = new Map((pts ?? []).map((r) => [r.user_id as string, r.study_points as number]));
  const rows = lb ?? [];
  const userMap = await getUsersByIds(rows.map((r) => r.user_id));

  return rows
    .map((r) => {
      const u = userMap.get(r.user_id);
      return {
        userId: r.user_id as string,
        name: u?.name ?? r.user_id,
        color: u?.color ?? '#60a5fa',
        gradient: u?.gradient ?? 'linear-gradient(135deg,#3b82f6,#8b5cf6)',
        totalSeconds: r.total_seconds as number,
        todaySeconds: r.today_seconds as number,
        studyPoints: Math.round(ptsMap.get(r.user_id) ?? 0),
      };
    })
    .filter((r) => userMap.has(r.userId))
    .sort((a, b) => b.totalSeconds - a.totalSeconds);
}

export interface StudySubjectRow {
  subjectId: string;
  subjectName: string;
  color: string;
  totalSeconds: number;
}

/** Per-subject breakdown for one user, for the drill-down when tapping their name. */
export async function getStudyBySubject(userId: string): Promise<StudySubjectRow[]> {
  const { data, error } = await supabase.from('v_study_by_subject').select('*').eq('user_id', userId);
  if (error) throw error;
  const rows = data ?? [];
  if (rows.length === 0) return [];

  const { data: subjects, error: e2 } = await supabase
    .from('subjects')
    .select('id,name,color')
    .in('id', rows.map((r) => r.subject_id));
  if (e2) throw e2;
  const subjMap = new Map((subjects ?? []).map((s) => [s.id, s]));

  return rows
    .map((r) => ({
      subjectId: r.subject_id as string,
      subjectName: subjMap.get(r.subject_id)?.name ?? r.subject_id,
      color: subjMap.get(r.subject_id)?.color ?? '#60a5fa',
      totalSeconds: r.total_seconds as number,
    }))
    .sort((a, b) => b.totalSeconds - a.totalSeconds);
}

export interface StudyDailyRow {
  date: string; // YYYY-MM-DD
  seconds: number;
}

/** Last 7 days (including today, 5am-boundary) of study time for one user in one subject. Fills in 0 for empty days. */
export async function getStudyLastWeekBySubject(userId: string, subjectId: string): Promise<StudyDailyRow[]> {
  const since = new Date();
  since.setDate(since.getDate() - 6);
  const sinceStr = since.toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from('v_study_by_subject_daily')
    .select('*')
    .eq('user_id', userId)
    .eq('subject_id', subjectId)
    .gte('study_date', sinceStr);
  if (error) throw error;

  const map = new Map((data ?? []).map((r) => [r.study_date as string, r.seconds as number]));
  const result: StudyDailyRow[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    result.push({ date: key, seconds: map.get(key) ?? 0 });
  }
  return result;
}

/** One page's stats within a single flush chunk. */
export interface PageChunk {
  page: number;
  seconds: number;
  taps: number;
}

/** Logs one chunk of study time (+ optional per-page breakdown). Ignores sub-5-second noise. */
export async function logStudySession(
  userId: string,
  cardId: string,
  subjectId: string,
  activeSeconds: number,
  pages: PageChunk[] = []
): Promise<void> {
  const seconds = Math.round(activeSeconds);
  if (seconds < 5) return;
  const { error } = await supabase.rpc('fn_log_study_session', {
    p_user_id: userId,
    p_card_id: cardId,
    p_subject_id: subjectId,
    p_seconds: seconds,
    p_pages: pages,
  });
  if (error) throw error;
}

export interface StudyDayCardDetail {
  cardId: string;
  cardTitle: string;
  furthestPage: number;
  pages: { page: number; seconds: number; taps: number }[];
}

/** Per-card page-by-page breakdown for one user/subject/day — the anti-cheat drill-down. */
export async function getStudyDayDetail(userId: string, subjectId: string, date: string): Promise<StudyDayCardDetail[]> {
  const { data, error } = await supabase
    .from('v_study_page_detail')
    .select('*')
    .eq('user_id', userId)
    .eq('subject_id', subjectId)
    .eq('study_date', date);
  if (error) throw error;
  const rows = data ?? [];

  const byCard = new Map<string, StudyDayCardDetail>();
  rows.forEach((r) => {
    const cardId = r.card_id as string;
    if (!byCard.has(cardId)) {
      byCard.set(cardId, { cardId, cardTitle: r.card_title as string, furthestPage: 0, pages: [] });
    }
    const c = byCard.get(cardId)!;
    c.pages.push({ page: r.page_number as number, seconds: r.seconds as number, taps: r.taps as number });
    c.furthestPage = Math.max(c.furthestPage, r.page_number as number);
  });

  byCard.forEach((c) => c.pages.sort((a, b) => a.page - b.page));
  return Array.from(byCard.values()).sort((a, b) => b.furthestPage - a.furthestPage);
}

/** Just today's (5am-boundary) study seconds for one user — for the small badge next to the streak counter. */
export async function getMyTodayStudySeconds(userId: string): Promise<number> {
  const { data, error } = await supabase
    .from('v_study_leaderboard')
    .select('today_seconds')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return (data?.today_seconds as number) ?? 0;
}

/** Live-updates as new study sessions get logged for this user. */
export function subscribeToStudySessions(userId: string, onChange: () => void): () => void {
  const channel = supabase
    .channel(`study-sessions-${userId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'content_study_sessions', filter: `user_id=eq.${userId}` }, onChange)
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}
