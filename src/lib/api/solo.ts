import { supabase } from '../supabaseClient';
import type { Database } from '../database.types';
import type { Question } from '../../types';

type QuestionRow = Database['public']['Tables']['questions']['Row'];

function mapQuestionRow(row: QuestionRow): Question {
  return {
    id: row.id,
    subjectId: row.subject_id ?? '',
    position: row.position ?? undefined,
    question: row.question,
    answer: row.answer,
  };
}

/** Reads next_position for this user+subject, creating the row (starting at 1) if it doesn't exist yet. */
export async function getOrCreateSoloProgress(userId: string, subjectId: string): Promise<number> {
  const { data, error } = await supabase
    .from('solo_progress')
    .select('next_position')
    .eq('user_id', userId)
    .eq('subject_id', subjectId)
    .maybeSingle();
  if (error) throw error;
  if (data) return data.next_position;

  const { data: created, error: insertErr } = await supabase
    .from('solo_progress')
    .insert({ user_id: userId, subject_id: subjectId })
    .select('next_position')
    .single();

  if (insertErr) {
    // Unique-violation: another tab created it a moment ago — just re-read.
    if (insertErr.code === '23505') {
      const { data: retry, error: retryErr } = await supabase
        .from('solo_progress')
        .select('next_position')
        .eq('user_id', userId)
        .eq('subject_id', subjectId)
        .single();
      if (retryErr) throw retryErr;
      return retry.next_position;
    }
    throw insertErr;
  }
  return created.next_position;
}

/** Remaining (unanswered) questions for a subject, starting from the saved cursor. */
export async function getSoloQuestions(subjectId: string, fromPosition: number): Promise<Question[]> {
  const { data, error } = await supabase
    .from('questions')
    .select('*')
    .eq('subject_id', subjectId)
    .gte('position', fromPosition)
    .order('position', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(mapQuestionRow);
}

export async function getQuestionCount(subjectId: string): Promise<number> {
  const { count, error } = await supabase
    .from('questions')
    .select('*', { count: 'exact', head: true })
    .eq('subject_id', subjectId);
  if (error) throw error;
  return count ?? 0;
}

export interface SubmitSoloAnswerParams {
  userId: string;
  subjectId: string;
  questionId: number;
  firstAnswer: string;
  firstTimeMs: number | null;
  secondAnswer: string;
  secondTimeMs: number | null;
  isCorrect: boolean;
  correctOn: 1 | 2 | null;
  isReview?: boolean;
}

/** Inserts the attempt — a DB trigger takes care of awarding points (half if isReview) + the daily streak. */
export async function submitSoloAnswer(params: SubmitSoloAnswerParams): Promise<void> {
  const { error } = await supabase.from('solo_answers').insert({
    user_id: params.userId,
    subject_id: params.subjectId,
    question_id: params.questionId,
    first_answer: params.firstAnswer || null,
    first_time_ms: params.firstTimeMs,
    second_answer: params.secondAnswer || null,
    second_time_ms: params.secondTimeMs,
    is_correct: params.isCorrect,
    correct_on: params.correctOn,
    is_review: params.isReview ?? false,
  });
  if (error) throw error;
}

/**
 * Shared lookup behind getReviewQuestions/getSkippedQuestions:
 *   - wrongIds: every question whose most recent attempt was wrong.
 *   - skippedIds: every question the cursor has already passed
 *     (position < next_position) that was skipped entirely — jumping to
 *     another question from the sidebar advances the cursor past it without
 *     ever inserting a solo_answers row, so it never resurfaces on its own
 *     otherwise.
 * Both are computed live from solo_answers/solo_progress history, so this is
 * retroactive — no backfill needed for people who already hit this before.
 */
async function getWrongAndSkippedIds(userId: string, subjectId: string): Promise<{ wrongIds: number[]; skippedIds: number[] }> {
  const [progressRes, answersRes] = await Promise.all([
    supabase
      .from('solo_progress')
      .select('next_position')
      .eq('user_id', userId)
      .eq('subject_id', subjectId)
      .maybeSingle(),
    supabase
      .from('solo_answers')
      .select('question_id,is_correct,answered_at')
      .eq('user_id', userId)
      .eq('subject_id', subjectId)
      .order('answered_at', { ascending: true }),
  ]);
  if (progressRes.error) throw progressRes.error;
  if (answersRes.error) throw answersRes.error;

  const nextPosition = progressRes.data?.next_position ?? 1;

  const latestCorrectByQuestion = new Map<number, boolean>();
  (answersRes.data ?? []).forEach((r) => {
    if (r.question_id != null) latestCorrectByQuestion.set(r.question_id, !!r.is_correct);
  });
  const wrongIds = Array.from(latestCorrectByQuestion.entries())
    .filter(([, correct]) => !correct)
    .map(([id]) => id);

  let skippedIds: number[] = [];
  if (nextPosition > 1) {
    const { data: passedQs, error: passedErr } = await supabase
      .from('questions')
      .select('id')
      .eq('subject_id', subjectId)
      .lt('position', nextPosition);
    if (passedErr) throw passedErr;
    skippedIds = (passedQs ?? [])
      .map((q) => q.id)
      .filter((id) => !latestCorrectByQuestion.has(id));
  }

  return { wrongIds, skippedIds };
}

async function getQuestionsByIds(subjectId: string, ids: number[]): Promise<Question[]> {
  if (ids.length === 0) return [];
  const { data: qRows, error: qErr } = await supabase
    .from('questions')
    .select('*')
    .eq('subject_id', subjectId)
    .in('id', ids)
    .order('position', { ascending: true });
  if (qErr) throw qErr;
  return (qRows ?? []).map(mapQuestionRow);
}

/**
 * Once a subject's normal question bank is exhausted for THIS session, this
 * returns only the wrong questions to replay at half credit. Skipped
 * questions are deliberately excluded — they're handled by
 * getSkippedQuestions instead, so they stay queued for the next session
 * rather than resurfacing immediately.
 */
export async function getReviewQuestions(userId: string, subjectId: string): Promise<Question[]> {
  const { wrongIds } = await getWrongAndSkippedIds(userId, subjectId);
  return getQuestionsByIds(subjectId, wrongIds);
}

/**
 * Questions that were skipped (jumped over via the sidebar) and never
 * answered. These are meant to be prepended to the start of a fresh
 * session's queue — played as normal, full-credit questions — rather than
 * shown as in-session half-credit review.
 */
export async function getSkippedQuestions(userId: string, subjectId: string): Promise<Question[]> {
  const { skippedIds } = await getWrongAndSkippedIds(userId, subjectId);
  return getQuestionsByIds(subjectId, skippedIds);
}

export async function advanceSoloProgress(userId: string, subjectId: string, nextPosition: number): Promise<void> {
  const { error } = await supabase
    .from('solo_progress')
    .upsert({ user_id: userId, subject_id: subjectId, next_position: nextPosition }, { onConflict: 'user_id,subject_id' });
  if (error) throw error;
}
