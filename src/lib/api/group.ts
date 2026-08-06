import { supabase } from '../supabaseClient';
import type { GroupAttempt } from '../database.types';

export type { GroupAttempt };

export interface GroupQuestion {
  id: number;
  question: string;
  answer: string;
  position: number;
}

export interface ProgressRecord {
  attempts: GroupAttempt[];
  final: 'correct' | 'wrong' | null;
}

/**
 * Every round number that currently has questions saved in group_round_questions,
 * sorted ascending. Nothing here is hardcoded — add a new round in Supabase and it
 * shows up automatically next time this is called.
 */
export async function getAvailableRounds(): Promise<number[]> {
  const { data, error } = await supabase
    .from('group_round_questions')
    .select('round_no')
    .is('subject_id', null);
  if (error) throw error;
  const set = new Set<number>();
  (data ?? []).forEach((r) => { if (r.round_no != null) set.add(r.round_no); });
  return Array.from(set).sort((a, b) => a - b);
}

/** All questions for one of the general-knowledge rounds. */
export async function getRoundQuestions(roundNo: number): Promise<GroupQuestion[]> {
  const { data, error } = await supabase
    .from('group_round_questions')
    .select('*')
    .is('subject_id', null)
    .eq('round_no', roundNo)
    .order('position', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => ({ id: r.id, question: r.question, answer: r.answer, position: r.position ?? 0 }));
}

/** Saved attempts/final result for every answered question in a round, keyed by position. */
export async function getRoundProgress(roundNo: number): Promise<Map<number, ProgressRecord>> {
  const { data, error } = await supabase.from('group_progress').select('*').eq('round_no', roundNo);
  if (error) throw error;
  const map = new Map<number, ProgressRecord>();
  (data ?? []).forEach((r) => {
    map.set(r.position, { attempts: (r.attempts as GroupAttempt[]) ?? [], final: r.final });
  });
  return map;
}

/**
 * Question count + correctly-answered count (+ total attempted, for resume-vs-start) for
 * every round that currently exists — the round list itself is discovered dynamically via
 * getAvailableRounds(), so newly-added rounds appear with no code changes.
 */
export async function getRoundsSummary(): Promise<Record<number, { total: number; correct: number; answered: number }>> {
  const rounds = await getAvailableRounds();
  if (rounds.length === 0) return {};

  const [{ data: qRows, error: qErr }, { data: pRows, error: pErr }] = await Promise.all([
    supabase.from('group_round_questions').select('round_no').is('subject_id', null).in('round_no', rounds),
    supabase.from('group_progress').select('round_no,final').in('round_no', rounds),
  ]);
  if (qErr) throw qErr;
  if (pErr) throw pErr;

  const summary: Record<number, { total: number; correct: number; answered: number }> = {};
  rounds.forEach((r) => { summary[r] = { total: 0, correct: 0, answered: 0 }; });
  (qRows ?? []).forEach((r) => { summary[r.round_no].total += 1; });
  (pRows ?? []).forEach((r) => {
    if (r.final) summary[r.round_no].answered += 1;
    if (r.final === 'correct') summary[r.round_no].correct += 1;
  });
  return summary;
}

/** Upserts the full attempts array + final result for one question — mirrors the reference app's "save whole record" pattern. */
export async function saveQuestionProgress(
  roundNo: number,
  position: number,
  attempts: GroupAttempt[],
  final: 'correct' | 'wrong' | null
): Promise<void> {
  const { error } = await supabase
    .from('group_progress')
    .upsert(
      { round_no: roundNo, position, attempts, final, updated_at: new Date().toISOString() },
      { onConflict: 'round_no,position' }
    );
  if (error) throw error;
}

/** Awards (or reverses, with a negative amount) group-mode points via the schema's existing point-award function. */
export async function awardGroupPoints(userId: string, points: number): Promise<void> {
  const { error } = await supabase.rpc('fn_award_points', { p_user_id: userId, p_points: points, p_mode: 'group' });
  if (error) throw error;
}

/** Resets one question: reverses the 5 points if it had been answered correctly, then deletes its saved state. */
export async function resetQuestion(roundNo: number, position: number): Promise<void> {
  const { data, error } = await supabase
    .from('group_progress')
    .select('*')
    .eq('round_no', roundNo)
    .eq('position', position)
    .maybeSingle();
  if (error) throw error;

  if (data?.final === 'correct') {
    const correctAttempt = (data.attempts as GroupAttempt[]).find((a) => a.result === 'correct');
    if (correctAttempt) await awardGroupPoints(correctAttempt.player_id, -5);
  }

  const { error: delErr } = await supabase.from('group_progress').delete().eq('round_no', roundNo).eq('position', position);
  if (delErr) throw delErr;
}

/** Resets an entire round: reverses points for every correctly-answered question, then clears all its saved state. */
export async function resetRound(roundNo: number): Promise<void> {
  const { data, error } = await supabase.from('group_progress').select('*').eq('round_no', roundNo);
  if (error) throw error;
  const rows = data ?? [];

  await Promise.all(
    rows
      .filter((r) => r.final === 'correct')
      .map((r) => {
        const correctAttempt = (r.attempts as GroupAttempt[]).find((a) => a.result === 'correct');
        return correctAttempt ? awardGroupPoints(correctAttempt.player_id, -5) : Promise.resolve();
      })
  );

  const { error: delErr } = await supabase.from('group_progress').delete().eq('round_no', roundNo);
  if (delErr) throw delErr;
}
