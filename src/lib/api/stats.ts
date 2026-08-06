import { supabase } from '../supabaseClient';
import { getUsersByIds } from '../auth';
import { getAvailableRounds } from './group';
import type { GroupAttempt } from '../database.types';

export interface UserDetailStats {
  userId: string;
  name: string;
  nameEn: string;
  color: string;
  gradient: string;
  totalPoints: number;
  soloPoints: number;
  groupPoints: number;
  onevonePoints: number;
  studyPoints: number;
  leaderboardRank: number;
  soloAnswered: number;
  soloCorrect: number;
  groupAnswered: number;
  groupCorrect: number;
  onevoneAnswered: number;
  onevoneCorrect: number;
  matchesPlayed: number;
  matchWins: number;
}

// The two fixed radar groups the members are split across (by name — ids come
// straight from Supabase and aren't hardcoded anywhere in this app).
const RADAR_GROUP_A_NAMES = ['محمد', 'حسن', 'نور', 'هبة'];
const RADAR_GROUP_B_NAMES = ['أحمد', 'عمر', 'ميرا', 'آلاء'];

const ARABIC_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
function toArabicDigits(n: number): string {
  return String(n).split('').map((c) => ARABIC_DIGITS[Number(c)] ?? c).join('');
}
function roundLabel(roundNo: number): string {
  return `الجولة ${toArabicDigits(roundNo)}`;
}

interface PlayerGroupAgg {
  answered: number;
  correct: number;
  correctTimes: number[];
  wrongTimes: number[];
  allTimes: number[];
}

/**
 * Group training now lives entirely in `group_progress` (5 fixed general-knowledge
 * rounds, no subject). This aggregates every player's attempts across all rounds —
 * shared by the leaderboard's group-answered/correct counts and the speed chart.
 */
async function getGroupAttemptsAggByPlayer(): Promise<Map<string, PlayerGroupAgg>> {
  const { data, error } = await supabase.from('group_progress').select('attempts');
  if (error) throw error;
  const rows = data ?? [];

  const map = new Map<string, PlayerGroupAgg>();
  rows.forEach((r) => {
    const attempts = (r.attempts as GroupAttempt[]) ?? [];
    attempts.forEach((a) => {
      if (!map.has(a.player_id)) {
        map.set(a.player_id, { answered: 0, correct: 0, correctTimes: [], wrongTimes: [], allTimes: [] });
      }
      const s = map.get(a.player_id)!;
      s.answered += 1;
      s.allTimes.push(a.time_s);
      if (a.result === 'correct') {
        s.correct += 1;
        s.correctTimes.push(a.time_s);
      } else {
        s.wrongTimes.push(a.time_s);
      }
    });
  });
  return map;
}

/** The whole leaderboard + per-member breakdown, ranked. Points from v_user_detail; group counts from group_progress. */
export async function getLeaderboard(): Promise<UserDetailStats[]> {
  const [{ data, error }, groupAgg] = await Promise.all([
    supabase.from('v_user_detail').select('*').order('leaderboard_rank', { ascending: true }),
    getGroupAttemptsAggByPlayer(),
  ]);
  if (error) throw error;
  const rows = data ?? [];

  const userMap = await getUsersByIds(rows.map((r) => r.user_id));

  return rows.map((r) => {
    const user = userMap.get(r.user_id);
    const g = groupAgg.get(r.user_id);
    return {
      userId: r.user_id,
      name: r.name,
      nameEn: r.name_en,
      color: user?.color ?? '#60a5fa',
      gradient: user?.gradient ?? 'linear-gradient(135deg,#3b82f6,#8b5cf6)',
      totalPoints: r.total_points,
      soloPoints: r.solo_points,
      groupPoints: r.group_points,
      onevonePoints: r.onevone_points,
      studyPoints: r.study_points ?? 0,
      leaderboardRank: r.leaderboard_rank ?? 0,
      soloAnswered: r.solo_answered,
      soloCorrect: r.solo_correct,
      groupAnswered: g?.answered ?? 0,
      groupCorrect: g?.correct ?? 0,
      onevoneAnswered: r.onevone_answered,
      onevoneCorrect: r.onevone_correct,
      matchesPlayed: r.matches_played,
      matchWins: r.match_wins,
    };
  });
}

export interface GroupRadarResult {
  rows: Array<{ subjectId: string; subject: string; [userId: string]: string | number }>;
  groupA: Array<{ userId: string; name: string; color: string }>;
  groupB: Array<{ userId: string; name: string; color: string }>;
}

/**
 * Correct-answer counts per member for the latest 5 rounds in group mode
 * (rounds replace subjects here). The round window is dynamic — every time
 * 5 more rounds get added, this automatically shifts to the newest 5, no
 * code changes needed. Split into two fixed radars by member.
 */
export async function getGroupRadar(): Promise<GroupRadarResult> {
  const allRounds = await getAvailableRounds(); // ascending
  const lastFive = allRounds.slice(-5);

  if (lastFive.length === 0) {
    return { rows: [], groupA: [], groupB: [] };
  }

  const { data, error } = await supabase
    .from('group_progress')
    .select('round_no,attempts,final')
    .in('round_no', lastFive);
  if (error) throw error;
  const rows = data ?? [];

  const byRound = new Map<number, Record<string, number>>();
  lastFive.forEach((r) => byRound.set(r, {}));
  const playerIds = new Set<string>();

  rows.forEach((r) => {
    if (r.final !== 'correct') return;
    const attempts = (r.attempts as GroupAttempt[]) ?? [];
    const winner = attempts.find((a) => a.result === 'correct');
    if (!winner) return;
    playerIds.add(winner.player_id);
    const bucket = byRound.get(r.round_no) ?? {};
    bucket[winner.player_id] = (bucket[winner.player_id] ?? 0) + 1;
    byRound.set(r.round_no, bucket);
  });

  const userMap = await getUsersByIds(Array.from(playerIds));

  const radarRows = lastFive.map((roundNo) => {
    const row: { subjectId: string; subject: string; [userId: string]: string | number } = {
      subjectId: `round-${roundNo}`,
      subject: roundLabel(roundNo),
    };
    const bucket = byRound.get(roundNo) ?? {};
    Object.entries(bucket).forEach(([uid, count]) => { row[uid] = count; });
    return row;
  });

  const members = Array.from(playerIds)
    .filter((id) => userMap.has(id))
    .map((id) => ({ userId: id, name: userMap.get(id)!.name, color: userMap.get(id)!.color }));

  return {
    rows: radarRows,
    groupA: members.filter((m) => RADAR_GROUP_A_NAMES.includes(m.name)),
    groupB: members.filter((m) => RADAR_GROUP_B_NAMES.includes(m.name)),
  };
}

export interface GroupSpeedRow {
  userId: string;
  name: string;
  color: string;
  correct: number; // seconds
  wrong: number;
  avg: number;
}

/** Average answer speed per member in group mode, computed straight from group_progress attempts (already in seconds). */
export async function getGroupSpeed(): Promise<GroupSpeedRow[]> {
  const agg = await getGroupAttemptsAggByPlayer();
  const userMap = await getUsersByIds(Array.from(agg.keys()));

  const avg = (arr: number[]) => (arr.length ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10 : 0);

  return Array.from(agg.entries())
    .filter(([id]) => userMap.has(id))
    .map(([id, s]) => {
      const u = userMap.get(id)!;
      return {
        userId: id,
        name: u.name,
        color: u.color,
        correct: avg(s.correctTimes),
        wrong: avg(s.wrongTimes),
        avg: avg(s.allTimes),
      };
    });
}

export interface RivalryRow {
  player1: { userId: string; name: string; color: string; wins: number };
  player2: { userId: string; name: string; color: string; wins: number };
  totalPoints1: number;
  totalPoints2: number;
  matchesPlayed: number;
}

/** Most-played 1v1 rivalries. Backed by v_rivalries. */
export async function getRivalries(limit = 3): Promise<RivalryRow[]> {
  const { data, error } = await supabase
    .from('v_rivalries')
    .select('*')
    .order('matches_played', { ascending: false })
    .limit(limit);
  if (error) throw error;
  const rows = data ?? [];

  const ids = Array.from(new Set(rows.flatMap((r) => [r.user_a, r.user_b]).filter((id: string | null): id is string => !!id))) as string[];
  const userMap = await getUsersByIds(ids);

  return rows
    .filter((r): r is typeof r & { user_a: string; user_b: string } => !!r.user_a && !!r.user_b)
    .filter((r) => userMap.has(r.user_a) && userMap.has(r.user_b))
    .map((r) => {
      const u1 = userMap.get(r.user_a)!;
      const u2 = userMap.get(r.user_b)!;
      return {
        player1: { userId: r.user_a, name: u1.name, color: u1.color, wins: r.wins_a ?? 0 },
        player2: { userId: r.user_b, name: u2.name, color: u2.color, wins: r.wins_b ?? 0 },
        totalPoints1: r.points_a ?? 0,
        totalPoints2: r.points_b ?? 0,
        matchesPlayed: r.matches_played ?? 0,
      };
    });
}

/** Live-updates the leaderboard as points change anywhere in the app. */
export function subscribeToPoints(onChange: () => void): () => void {
  const channel = supabase
    .channel('user-points-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'user_points' }, onChange)
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}

/** Live-updates group-mode stats (radar/speed/leaderboard counts) as rounds are played. */
export function subscribeToGroupProgress(onChange: () => void): () => void {
  const channel = supabase
    .channel('group-progress-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'group_progress' }, onChange)
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}
