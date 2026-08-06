import { supabase } from '../supabaseClient';
import type { Database, InviteStatus, MatchPlayerRole, MatchResult, MatchStatus } from '../database.types';
import type { Subject, User } from '../../types';
import { getUsersByIds } from '../auth';
import { getSubjectById } from './subjects';

type MatchRow = Database['public']['Tables']['matches']['Row'];

export interface MatchInfo {
  id: string;
  subjectId: string | null;
  creatorId: string | null;
  refereeId: string | null;
  status: MatchStatus;
  currentQidx: number;
  /** Server timestamp the referee started the current question's countdown at; null = not started yet. */
  questionStartedAt: string | null;
  startedAt: string | null;
}

function mapMatchRow(row: MatchRow): MatchInfo {
  return {
    id: row.id,
    subjectId: row.subject_id,
    creatorId: row.creator_id,
    refereeId: row.referee_id,
    status: row.status,
    currentQidx: row.current_qidx,
    questionStartedAt: row.question_started_at,
    startedAt: row.started_at,
  };
}

export async function getMatch(matchId: string): Promise<MatchInfo | null> {
  const { data, error } = await supabase.from('matches').select('*').eq('id', matchId).maybeSingle();
  if (error) throw error;
  return data ? mapMatchRow(data) : null;
}

/** Creates the match (status='lobby') and seats the creator as the first player. */
export async function createMatch(subjectId: string, creatorId: string): Promise<string> {
  const { data, error } = await supabase
    .from('matches')
    .insert({ subject_id: subjectId, creator_id: creatorId })
    .select('id')
    .single();
  if (error) throw error;

  const { error: playerErr } = await supabase
    .from('match_players')
    .insert({ match_id: data.id, user_id: creatorId, role: 'player' });
  if (playerErr) throw playerErr;

  return data.id;
}

export async function sendInvites(matchId: string, toUserIds: string[], refUserId: string | null): Promise<void> {
  // Skip anyone who already has a pending OR accepted invite to this match,
  // and anyone already seated in match_players, so re-opening "invite
  // another player" never sends a duplicate/accumulated request to someone
  // still deciding — or worse, to someone already in the lobby.
  const { data: existing, error: existingErr } = await supabase
    .from('match_invites')
    .select('to_user_id')
    .eq('match_id', matchId)
    .in('status', ['pending', 'accepted']);
  if (existingErr) throw existingErr;
  const already = new Set((existing ?? []).map((r) => r.to_user_id));

  const { data: seated, error: seatedErr } = await supabase
    .from('match_players')
    .select('user_id')
    .eq('match_id', matchId);
  if (seatedErr) throw seatedErr;
  (seated ?? []).forEach((r) => already.add(r.user_id));

  const rows = toUserIds
    .filter((id) => !already.has(id))
    .map((toUserId) => ({
      match_id: matchId,
      to_user_id: toUserId,
      is_ref: toUserId === refUserId,
    }));
  if (rows.length === 0) return;

  const { error } = await supabase.from('match_invites').insert(rows);
  if (error) throw error;
}

export interface InviteWithUser {
  id: string;
  toUser: User;
  isRef: boolean;
  status: InviteStatus;
}

export async function getMatchInvites(matchId: string): Promise<InviteWithUser[]> {
  // Only invites still "live" for the lobby: pending (still deciding) or
  // accepted (already seated). Cancelled/rejected ones must not keep a slot
  // in the room — the lobby should shrink back to current members + open
  // invites only.
  const { data, error } = await supabase
    .from('match_invites')
    .select('id,to_user_id,is_ref,status')
    .eq('match_id', matchId)
    .in('status', ['pending', 'accepted'])
    .order('created_at', { ascending: true });
  if (error) throw error;

  const rows = data ?? [];
  const userMap = await getUsersByIds(rows.map((r) => r.to_user_id).filter((id: string | null): id is string => !!id));

  return rows
    .filter((r): r is typeof r & { to_user_id: string } => !!r.to_user_id && userMap.has(r.to_user_id))
    .map((r) => ({
      id: r.id,
      toUser: userMap.get(r.to_user_id)!,
      isRef: r.is_ref,
      status: r.status,
    }));
}

export async function cancelInvite(inviteId: string): Promise<void> {
  const { error } = await supabase
    .from('match_invites')
    .update({ status: 'cancelled', responded_at: new Date().toISOString() })
    .eq('id', inviteId);
  if (error) throw error;
}

export async function restoreInvite(inviteId: string): Promise<void> {
  const { error } = await supabase
    .from('match_invites')
    .update({ status: 'pending', responded_at: null })
    .eq('id', inviteId);
  if (error) throw error;
}

export interface PendingInvite {
  inviteId: string;
  matchId: string;
  isRef: boolean;
  subject: Subject | null;
  creator: User | null;
  matchStatus: MatchStatus;
}

/** Invites still waiting on this user's response, newest first. */
export async function getPendingInvitesForUser(userId: string): Promise<PendingInvite[]> {
  const { data: invites, error } = await supabase
    .from('match_invites')
    .select('id,match_id,is_ref')
    .eq('to_user_id', userId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error) throw error;

  const rows = (invites ?? []).filter((r): r is typeof r & { match_id: string } => !!r.match_id);
  if (rows.length === 0) return [];

  const matchIds = Array.from(new Set(rows.map((r) => r.match_id)));
  const { data: matches, error: matchErr } = await supabase.from('matches').select('*').in('id', matchIds);
  if (matchErr) throw matchErr;

  const matchMap = new Map<string, MatchInfo>();
  (matches ?? []).forEach((m) => matchMap.set(m.id, mapMatchRow(m)));

  const subjectIds = Array.from(new Set((matches ?? []).map((m) => m.subject_id).filter((id: string | null): id is string => !!id))) as string[];
  const creatorIds = Array.from(new Set((matches ?? []).map((m) => m.creator_id).filter((id: string | null): id is string => !!id))) as string[];

  const [subjects, creators] = await Promise.all([
    Promise.all(subjectIds.map((id) => getSubjectById(id))),
    getUsersByIds(creatorIds),
  ]);
  const subjectMap = new Map<string, Subject>();
  subjects.forEach((s) => {
    if (s) subjectMap.set(s.id, s);
  });

  return rows
    .map((r) => {
      const match = matchMap.get(r.match_id);
      if (!match) return null;
      return {
        inviteId: r.id,
        matchId: r.match_id,
        isRef: r.is_ref,
        subject: match.subjectId ? subjectMap.get(match.subjectId) ?? null : null,
        creator: match.creatorId ? creators.get(match.creatorId) ?? null : null,
        matchStatus: match.status,
      };
    })
    .filter((x): x is PendingInvite => x !== null);
}

/** Accepting seats the user in match_players with the right role; rejecting just closes the invite. */
export async function respondToInvite(inviteId: string, matchId: string, userId: string, isRef: boolean, accept: boolean): Promise<void> {
  const { error } = await supabase
    .from('match_invites')
    .update({ status: accept ? 'accepted' : 'rejected', responded_at: new Date().toISOString() })
    .eq('id', inviteId);
  if (error) throw error;

  if (accept) {
    const { error: playerErr } = await supabase
      .from('match_players')
      .upsert(
        { match_id: matchId, user_id: userId, role: isRef ? 'referee' : 'player' },
        { onConflict: 'match_id,user_id', ignoreDuplicates: true }
      );
    if (playerErr) throw playerErr;
  }
}

/** Host-only: seats the host as referee instead of a player (or back), without going through an invite. */
export async function setOwnMatchRole(matchId: string, userId: string, role: MatchPlayerRole): Promise<void> {
  const { error } = await supabase
    .from('match_players')
    .update({ role })
    .eq('match_id', matchId)
    .eq('user_id', userId);
  if (error) throw error;
}

/** Cancels a match that never got past the lobby, and ALL of its invites —
 * including already-accepted ones, so anyone sitting in "waiting for host"
 * sees the round was ended instead of waiting forever. */
export async function cancelMatch(matchId: string): Promise<void> {
  const { error: inviteErr } = await supabase
    .from('match_invites')
    .update({ status: 'cancelled', responded_at: new Date().toISOString() })
    .eq('match_id', matchId)
    .in('status', ['pending', 'accepted']);
  if (inviteErr) throw inviteErr;

  const { error: matchErr } = await supabase
    .from('matches')
    .update({ status: 'cancelled', ended_at: new Date().toISOString() })
    .eq('id', matchId)
    .eq('status', 'lobby');
  if (matchErr) throw matchErr;
}

/** A joined (non-host) participant backing out before the match starts:
 * cancels their own invite and frees their seat, without touching the match
 * or anyone else. If they were the referee, this naturally reopens the
 * referee slot for the host to fill again. */
export async function withdrawFromMatch(matchId: string, userId: string): Promise<void> {
  const { error: inviteErr } = await supabase
    .from('match_invites')
    .update({ status: 'cancelled', responded_at: new Date().toISOString() })
    .eq('match_id', matchId)
    .eq('to_user_id', userId)
    .in('status', ['pending', 'accepted']);
  if (inviteErr) throw inviteErr;

  const { error: seatErr } = await supabase
    .from('match_players')
    .delete()
    .eq('match_id', matchId)
    .eq('user_id', userId);
  if (seatErr) throw seatErr;
}

/** Referee-only: starts (or restarts) the synced countdown for the current question. */
export async function startQuestionTimer(matchId: string): Promise<void> {
  const { error } = await supabase
    .from('matches')
    .update({ question_started_at: new Date().toISOString() })
    .eq('id', matchId);
  if (error) throw error;
}

export interface MatchPlayerInfo {
  userId: string;
  role: MatchPlayerRole;
  correctCount: number;
  wrongCount: number;
  result: MatchResult | null;
  user: User;
}

export async function getMatchPlayers(matchId: string): Promise<MatchPlayerInfo[]> {
  const { data, error } = await supabase.from('match_players').select('*').eq('match_id', matchId);
  if (error) throw error;

  const rows = data ?? [];
  const userMap = await getUsersByIds(rows.map((r) => r.user_id));

  return rows
    .filter((r) => userMap.has(r.user_id))
    .map((r) => ({
      userId: r.user_id,
      role: r.role,
      correctCount: r.correct_count,
      wrongCount: r.wrong_count,
      result: r.result,
      user: userMap.get(r.user_id)!,
    }));
}

/** Deals the next chunk of questions from the subject's bank and flips the match to active. */
export async function startMatch(matchId: string, subjectId: string): Promise<void> {
  const { error: rpcErr } = await supabase.rpc('fn_start_match_questions', {
    p_match_id: matchId,
    p_subject_id: subjectId,
  });
  if (rpcErr) throw rpcErr;

  const { error } = await supabase
    .from('matches')
    .update({ status: 'active', started_at: new Date().toISOString() })
    .eq('id', matchId);
  if (error) throw error;
}

export interface MatchQuestionItem {
  position: number;
  questionId: number;
  question: string;
  answer: string;
}

export async function getMatchQuestions(matchId: string): Promise<MatchQuestionItem[]> {
  const { data: mqRows, error } = await supabase
    .from('match_questions')
    .select('*')
    .eq('match_id', matchId)
    .order('position', { ascending: true });
  if (error) throw error;

  const qIds = (mqRows ?? []).map((r) => r.question_id).filter((id: number | null): id is number => id !== null);
  if (qIds.length === 0) return [];

  const { data: qRows, error: qErr } = await supabase.from('questions').select('id,question,answer').in('id', qIds);
  if (qErr) throw qErr;

  const qMap = new Map<number, { question: string; answer: string }>();
  (qRows ?? []).forEach((q) => qMap.set(q.id, { question: q.question, answer: q.answer }));

  return (mqRows ?? [])
    .filter((r): r is typeof r & { question_id: number } => r.question_id !== null)
    .map((r) => ({
      position: r.position,
      questionId: r.question_id,
      question: qMap.get(r.question_id)?.question ?? '',
      answer: qMap.get(r.question_id)?.answer ?? '',
    }));
}

export interface MatchAnswerItem {
  id: number;
  position: number;
  answeringUserId: string | null;
  attemptNo: number;
  timeMs: number | null;
  answerText: string | null;
  judgedCorrect: boolean | null;
  judgedBy: string | null;
  judgedAt: string | null;
  answeredAt: string;
}

export async function getMatchAnswers(matchId: string, position: number): Promise<MatchAnswerItem[]> {
  const { data, error } = await supabase
    .from('match_answers')
    .select('*')
    .eq('match_id', matchId)
    .eq('position', position)
    .order('answered_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    position: r.position,
    answeringUserId: r.answering_user_id,
    attemptNo: r.attempt_no,
    timeMs: r.time_ms,
    answerText: r.answer_text,
    judgedCorrect: r.judged_correct,
    judgedBy: r.judged_by,
    judgedAt: r.judged_at,
    answeredAt: r.answered_at,
  }));
}

export async function submitMatchAttempt(matchId: string, position: number, answeringUserId: string, timeMs: number, answerText: string): Promise<void> {
  const { count, error: countErr } = await supabase
    .from('match_answers')
    .select('*', { count: 'exact', head: true })
    .eq('match_id', matchId)
    .eq('position', position);
  if (countErr) throw countErr;

  const { error } = await supabase.from('match_answers').insert({
    match_id: matchId,
    position,
    answering_user_id: answeringUserId,
    attempt_no: (count ?? 0) + 1,
    time_ms: timeMs,
    answer_text: answerText,
  });
  if (error) throw error;
}

/** Judges one attempt. Points aren't awarded here — a DB trigger hands out
 * 3 points per correct answer in one pass once the match's status flips to
 * 'completed' (see match_v5_points_on_completion.sql), so an abandoned or
 * cancelled match never pays out. judged_at is also how the client knows
 * how long the timer was paused while this attempt was pending. */
export async function judgeMatchAnswer(answerId: number, refereeId: string, correct: boolean, answeringUserId: string, matchId: string): Promise<void> {
  const { error } = await supabase
    .from('match_answers')
    .update({ judged_correct: correct, judged_by: refereeId, judged_at: new Date().toISOString() })
    .eq('id', answerId);
  if (error) throw error;

  const { error: bumpErr } = await supabase.rpc('fn_bump_match_player', {
    p_match_id: matchId,
    p_user_id: answeringUserId,
    p_correct: correct,
  });
  if (bumpErr) throw bumpErr;
}

export async function advanceMatchQuestion(matchId: string, nextQidx: number): Promise<void> {
  const { error } = await supabase
    .from('matches')
    .update({ current_qidx: nextQidx, question_started_at: null })
    .eq('id', matchId);
  if (error) throw error;
}

/** Ranks players by correct answers: sole top scorer wins, ties at the top draw, the rest lose. */
export async function endMatch(matchId: string): Promise<void> {
  const { data: players, error } = await supabase
    .from('match_players')
    .select('user_id,correct_count')
    .eq('match_id', matchId)
    .eq('role', 'player');
  if (error) throw error;

  const rows = players ?? [];
  if (rows.length > 0) {
    const maxCorrect = Math.max(...rows.map((r) => r.correct_count));
    const topCount = rows.filter((r) => r.correct_count === maxCorrect).length;
    await Promise.all(
      rows.map((r) => {
        const result: MatchResult = r.correct_count === maxCorrect ? (topCount > 1 ? 'draw' : 'win') : 'loss';
        return supabase.from('match_players').update({ result }).eq('match_id', matchId).eq('user_id', r.user_id);
      })
    );
  }

  const { error: matchErr } = await supabase
    .from('matches')
    .update({ status: 'completed', ended_at: new Date().toISOString() })
    .eq('id', matchId);
  if (matchErr) throw matchErr;
}

// ── Realtime ─────────────────────────────────────────────────────────────

/** Fires on any invite change for a match (accept/reject/cancel) — drives the lobby view. */
export function subscribeToMatchInvites(matchId: string, onChange: () => void): () => void {
  const channel = supabase
    .channel(`match-invites-${matchId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'match_invites', filter: `match_id=eq.${matchId}` },
      onChange
    )
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}

/** Fires when a new invite arrives for this user — drives the "join a match" screen. */
export function subscribeToIncomingInvites(userId: string, onChange: () => void): () => void {
  const channel = supabase
    .channel(`incoming-invites-${userId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'match_invites', filter: `to_user_id=eq.${userId}` },
      onChange
    )
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}

/** Fires on match status/qidx changes, new attempts, and score updates — drives the live match room. */
export function subscribeToMatchRoom(matchId: string, onChange: () => void): () => void {
  const channel = supabase
    .channel(`match-room-${matchId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'matches', filter: `id=eq.${matchId}` }, onChange)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'match_answers', filter: `match_id=eq.${matchId}` },
      onChange
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'match_players', filter: `match_id=eq.${matchId}` },
      onChange
    )
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}
