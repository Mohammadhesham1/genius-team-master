import { useState, useEffect } from 'react';
import type { User, Subject } from '../types';
import { UserAvatar } from '../components/UserIcons';
import { getSubjectById } from '../lib/api/subjects';
import {
  getMatch,
  getMatchPlayers,
  getMatchQuestions,
  getMatchAnswers,
  submitMatchAttempt,
  judgeMatchAnswer,
  advanceMatchQuestion,
  startQuestionTimer,
  endMatch,
  subscribeToMatchRoom,
  type MatchInfo,
  type MatchPlayerInfo,
  type MatchQuestionItem,
  type MatchAnswerItem,
} from '../lib/api/matches';

const TIMER = 30;

interface MatchPlayPageProps {
  matchId: string;
  subjectId: string;
  user: User;
  onExit: () => void;
}

export default function MatchPlayPage({ matchId, subjectId, user, onExit }: MatchPlayPageProps) {
  const [subject, setSubject] = useState<Subject | null>(null);
  const [match, setMatch] = useState<MatchInfo | null>(null);
  const [players, setPlayers] = useState<MatchPlayerInfo[]>([]);
  const [questions, setQuestions] = useState<MatchQuestionItem[]>([]);
  const [answers, setAnswers] = useState<MatchAnswerItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [submittingAttempt, setSubmittingAttempt] = useState(false);
  const [busyAnswerId, setBusyAnswerId] = useState<number | null>(null);
  const [advancing, setAdvancing] = useState(false);
  const [startingTimer, setStartingTimer] = useState(false);
  const [endingNow, setEndingNow] = useState(false);
  const [timeLeft, setTimeLeft] = useState(TIMER);
  const [answerText, setAnswerText] = useState('');

  useEffect(() => {
    getSubjectById(subjectId).then(setSubject).catch(() => setSubject(null));
  }, [subjectId]);

  // Synced countdown: every participant computes time-left from the same
  // question_started_at server timestamp the referee sets, instead of each
  // device's own clock — so the ring and the cutoff match for everyone.
  // The clock also pauses for however long an attempt sits unjudged (from
  // answered_at to judged_at, or until now if it's still pending) so a slow
  // referee never costs the players time.
  useEffect(() => {
    const startedAt = match?.questionStartedAt;
    if (!startedAt) {
      setTimeLeft(TIMER);
      return;
    }
    const startMs = new Date(startedAt).getTime();
    const tick = () => {
      const now = Date.now();
      let pausedMs = 0;
      for (const a of answers) {
        const ansMs = new Date(a.answeredAt).getTime();
        if (a.judgedCorrect === null) {
          pausedMs += Math.max(now - ansMs, 0);
        } else if (a.judgedAt) {
          pausedMs += Math.max(new Date(a.judgedAt).getTime() - ansMs, 0);
        }
      }
      setTimeLeft(Math.max(TIMER - Math.floor(((now - startMs) - pausedMs) / 1000), 0));
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [match?.questionStartedAt, answers]);

  useEffect(() => {
    let cancelled = false;
    getMatchQuestions(matchId)
      .then((q) => { if (!cancelled) setQuestions(q); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [matchId]);

  useEffect(() => {
    let cancelled = false;
    const refreshAll = () => {
      getMatch(matchId).then((m) => {
        if (cancelled) return;
        setMatch(m);
        if (m) getMatchAnswers(matchId, m.currentQidx).then((a) => { if (!cancelled) setAnswers(a); }).catch(() => {});
      }).catch(() => {});
      getMatchPlayers(matchId).then((p) => { if (!cancelled) setPlayers(p); }).catch(() => {});
    };
    refreshAll();
    const unsub = subscribeToMatchRoom(matchId, refreshAll);
    // Realtime can silently drop when a phone locks or loses signal mid-match
    // — poll as a fallback and force an immediate resync the moment the
    // connection or tab comes back, so play picks up exactly where the
    // match actually is on the server instead of staying stuck.
    const poll = setInterval(refreshAll, 4000);
    const onFocus = () => refreshAll();
    window.addEventListener('online', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      cancelled = true;
      unsub();
      clearInterval(poll);
      window.removeEventListener('online', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [matchId]);

  // A fresh question means a fresh answer box.
  useEffect(() => {
    setAnswerText('');
  }, [match?.currentQidx]);

  const accent = subject?.color ?? '#ef4444';
  const gradFrom = subject?.gradFrom ?? '#ef4444';
  const gradTo = subject?.gradTo ?? '#f97316';
  const glow = subject?.glow ?? 'rgba(239,68,68,0.4)';

  const me = players.find((p) => p.userId === user.id);
  const isReferee = me?.role === 'referee';
  const currentQuestion = match ? questions[match.currentQidx] : undefined;

  // Turn lock: only one unjudged attempt can be "on the floor" at a time —
  // whoever submits first is the one the referee judges; nobody else can
  // submit until that's resolved.
  const openAttempt = answers.find((a) => a.judgedCorrect === null);
  const nonRefPlayers = players.filter((p) => p.role === 'player');
  const myFailedAttempts = answers.filter((a) => a.answeringUserId === user.id && a.judgedCorrect === false);
  const myAttemptCount = answers.filter((a) => a.answeringUserId === user.id).length;

  // Bonus round: once every player has had one attempt judged wrong on this
  // question, everyone gets one last shared 10-second shot — first to
  // submit is the one judged. The countdown is derived from the latest of
  // those judged-wrong submissions so every device agrees on the deadline.
  const allFailedOnce = nonRefPlayers.length > 0 && nonRefPlayers.every((p) =>
    answers.some((a) => a.answeringUserId === p.userId && a.judgedCorrect === false)
  );
  const bonusStartMs = allFailedOnce
    ? Math.max(...answers.filter((a) => a.judgedCorrect === false).map((a) => new Date(a.judgedAt ?? a.answeredAt).getTime()))
    : 0;
  const [bonusNow, setBonusNow] = useState(() => Date.now());
  useEffect(() => {
    if (!allFailedOnce) return;
    const id = setInterval(() => setBonusNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [allFailedOnce]);
  const bonusTimeLeft = allFailedOnce ? Math.max(10 - Math.floor((bonusNow - bonusStartMs) / 1000), 0) : 0;
  const bonusActive = allFailedOnce && bonusTimeLeft > 0;
  const myBonusUsed = allFailedOnce && myAttemptCount >= 2;

  const maxAttemptsForMe = allFailedOnce ? 2 : 1;
  const timerIsRunning = !!match?.questionStartedAt;
  const timerHasExpired = timerIsRunning && timeLeft <= 0;
  const questionOver = answers.some((a) => a.judgedCorrect === true) || (timerHasExpired && !openAttempt);
  const canSubmit =
    !isReferee &&
    timerIsRunning &&
    !timerHasExpired &&
    !openAttempt &&
    myAttemptCount < maxAttemptsForMe &&
    (myFailedAttempts.length === 0 || (allFailedOnce && bonusActive && !myBonusUsed)) &&
    answerText.trim().length > 0;

  const goToNextOrEnd = async () => {
    if (!match) return;
    const next = match.currentQidx + 1;
    setAdvancing(true);
    try {
      if (next >= questions.length) {
        await endMatch(matchId);
      } else {
        await advanceMatchQuestion(matchId, next);
      }
    } finally {
      setAdvancing(false);
    }
  };

  const handleSubmitAttempt = async () => {
    if (!match || !canSubmit || submittingAttempt) return;
    setSubmittingAttempt(true);
    const elapsed = Date.now() - new Date(match.questionStartedAt!).getTime();
    const text = answerText.trim();
    try {
      await submitMatchAttempt(matchId, match.currentQidx, user.id, elapsed, text);
      setAnswerText('');
    } finally {
      setSubmittingAttempt(false);
    }
  };

  const handleJudge = async (answer: MatchAnswerItem, correct: boolean) => {
    if (!answer.answeringUserId) return;
    setBusyAnswerId(answer.id);
    try {
      await judgeMatchAnswer(answer.id, user.id, correct, answer.answeringUserId, matchId);
      if (correct) await goToNextOrEnd();
    } finally {
      setBusyAnswerId(null);
    }
  };

  // The referee has the only clock in the room — nothing moves until they
  // start it, and they can stop the match at any moment regardless of qidx.
  const handleStartTimer = async () => {
    if (!match || startingTimer) return;
    setStartingTimer(true);
    try {
      await startQuestionTimer(matchId);
    } finally {
      setStartingTimer(false);
    }
  };

  const handleEndNow = async () => {
    if (endingNow) return;
    setEndingNow(true);
    try {
      await endMatch(matchId);
    } finally {
      setEndingNow(false);
    }
  };

  if (loading || !match) {
    return (
      <div className="relative min-h-dvh flex items-center justify-center">
        <div className="w-8 h-8 rounded-full animate-spin-slow" style={{ border: '3px solid rgba(255,255,255,0.15)', borderTopColor: accent }} />
      </div>
    );
  }

  if (match.status === 'completed') {
    const ranked = [...players].filter((p) => p.role === 'player').sort((a, b) => b.correctCount - a.correctCount);
    return (
      <div className="relative min-h-dvh flex flex-col pb-28 px-4">
        <div className="pt-12 pb-6 text-center">
          <p className="text-3xl mb-2">🏆</p>
          <h1 className="text-2xl font-black gradient-text" style={{ fontFamily: "'Tajawal',sans-serif" }}>انتهت المباراة</h1>
        </div>
        <div className="flex flex-col gap-3">
          {ranked.map((p) => (
            <div
              key={p.userId}
              className="rounded-2xl p-4 flex items-center gap-3"
              style={{
                background: p.result === 'win' ? 'rgba(16,185,129,0.1)' : `${p.user.color}0d`,
                border: `1px solid ${p.result === 'win' ? 'rgba(16,185,129,0.35)' : p.user.color + '25'}`,
              }}
            >
              <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: p.user.gradient }}>
                <UserAvatar userId={p.user.id} name={p.user.name} />
              </div>
              <div className="flex-1">
                <p className="font-bold text-white text-sm" style={{ fontFamily: "'Tajawal',sans-serif" }}>{p.user.name}</p>
                <p className="text-xs text-white/40 font-exo">{p.correctCount} صح · {p.wrongCount} غلط</p>
              </div>
              <span
                className="text-xs font-bold px-3 py-1 rounded-full"
                style={{
                  background: p.result === 'win' ? 'rgba(16,185,129,0.2)' : p.result === 'draw' ? 'rgba(245,158,11,0.2)' : 'rgba(255,255,255,0.08)',
                  color: p.result === 'win' ? '#34d399' : p.result === 'draw' ? '#f59e0b' : 'rgba(255,255,255,0.4)',
                }}
              >
                {p.result === 'win' ? 'فاز' : p.result === 'draw' ? 'تعادل' : 'خسر'}
              </span>
            </div>
          ))}
        </div>
        <button
          onClick={onExit}
          className="w-full rounded-2xl py-4 font-black text-white text-lg mt-6"
          style={{ background: `linear-gradient(135deg,${gradFrom},${gradTo})`, boxShadow: `0 0 24px ${glow}`, fontFamily: "'Tajawal',sans-serif" }}
        >
          خروج
        </button>
      </div>
    );
  }

  const timerRunning = timerIsRunning;
  const timerExpired = timerHasExpired;
  const timerColor = timeLeft > 10 ? '#10b981' : timeLeft > 5 ? '#f59e0b' : '#ef4444';
  const timerMax = TIMER;

  return (
    <div className="relative min-h-dvh flex flex-col pb-28 overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-10 pb-3 flex items-center gap-3">
        <button onClick={onExit} className="w-9 h-9 rounded-xl flex items-center justify-center glass-md" style={{ color: accent }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
        <div className="flex-1">
          <p className="text-sm font-bold" style={{ color: accent, fontFamily: "'Tajawal',sans-serif" }}>
            {subject?.name ?? 'مباراة 1v1'}
          </p>
          {isReferee ? (
            <p className="text-amber-400/70 text-[11px] font-bold mt-0.5" style={{ fontFamily: "'Tajawal',sans-serif" }}>
              أنت الحكم — التحكم الكامل بالمباراة
            </p>
          ) : (
            <p className="text-white/30 text-xs font-exo">{match.currentQidx + 1} / {questions.length}</p>
          )}
        </div>
        {/* Referee: end the match at any moment, from any question */}
        {isReferee && (
          <button
            onClick={handleEndNow}
            disabled={endingNow}
            className="text-xs px-3 py-2 rounded-xl font-bold disabled:opacity-50"
            style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171', fontFamily: "'Tajawal',sans-serif" }}
          >
            إنهاء الآن
          </button>
        )}
      </div>

      {/* Progress bar */}
      <div className="px-4 mb-3">
        <div className="h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
          <div
            className="h-full rounded-full transition-none"
            style={{
              width: `${(match.currentQidx / Math.max(questions.length, 1)) * 100}%`,
              background: `linear-gradient(90deg,${gradFrom},${gradTo})`,
            }}
          />
        </div>
      </div>

      {/* Scoreboard */}
      <div className="px-4 mb-3 flex gap-2 overflow-x-auto">
        {players.map((p) => (
          <div
            key={p.userId}
            className="flex items-center gap-2 rounded-xl px-3 py-2 flex-shrink-0"
            style={{
              background: p.role === 'referee' ? 'rgba(245,158,11,0.1)' : `${p.user.color}12`,
              border: `1px solid ${p.role === 'referee' ? 'rgba(245,158,11,0.3)' : p.user.color + '30'}`,
            }}
          >
            <span className="text-xs font-bold text-white" style={{ fontFamily: "'Tajawal',sans-serif" }}>{p.user.name}</span>
            {p.role === 'referee' ? (
              <span className="text-[10px] text-amber-400">حكم</span>
            ) : (
              <span className="text-[10px] font-exo"><span className="text-green-400">{p.correctCount}</span><span className="text-white/20">/</span><span className="text-red-400">{p.wrongCount}</span></span>
            )}
          </div>
        ))}
      </div>

      <div className="px-4 flex-1 flex flex-col gap-4">
        {/* Timer ring + question, same layout as solo training */}
        <div className="relative flex flex-col items-center gap-4">
          <div className="relative w-24 h-24">
            <svg className="absolute inset-0 -rotate-90" width="96" height="96" viewBox="0 0 96 96">
              <circle className="timer-track" cx="48" cy="48" r="44" strokeWidth="4"/>
              <circle
                className="timer-fill"
                cx="48" cy="48" r="44"
                strokeWidth="4"
                stroke={timerRunning ? timerColor : 'rgba(255,255,255,0.15)'}
                strokeDasharray="276.46"
                strokeDashoffset={276.46 - (timeLeft / timerMax) * 276.46}
                style={timerRunning ? { filter: `drop-shadow(0 0 6px ${timerColor})` } : undefined}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span
                className="text-2xl font-black font-exo"
                style={timerRunning ? { color: timerColor, textShadow: `0 0 10px ${timerColor}` } : { color: 'rgba(255,255,255,0.25)' }}
              >
                {timerRunning ? timeLeft : '—'}
              </span>
              <span className="text-white/30 text-[9px] font-exo">الوقت</span>
            </div>
          </div>

          {/* Question card */}
          <div className="w-full rounded-2xl p-5" style={{ background: `${accent}0e`, border: `1px solid ${accent}25`, boxShadow: `0 4px 24px ${glow}` }}>
            <p className="text-lg font-bold text-white text-center leading-snug" style={{ fontFamily: "'Tajawal',sans-serif", direction: 'rtl' }}>
              {currentQuestion?.question ?? '...'}
            </p>
            {(isReferee || questionOver) && currentQuestion && (
              <p className="text-center text-xs mt-3 pt-3" style={{ color: '#34d399', borderTop: `1px solid ${accent}20`, fontFamily: "'Tajawal',sans-serif" }}>
                الإجابة: {currentQuestion.answer}
              </p>
            )}
          </div>
        </div>

        {/* Player: write + submit an answer — gated by the referee's synced timer, the turn lock, and (once) the bonus round */}
        {!isReferee && (
          <div className="flex flex-col gap-2">
            {!timerRunning ? (
              <p className="text-white/30 text-xs text-center py-2" style={{ fontFamily: "'Tajawal',sans-serif" }}>
                بانتظار الحكم يبدأ المؤقت
              </p>
            ) : (
              <>
                {allFailedOnce && (
                  <p className="text-amber-400 text-xs text-center font-bold" style={{ fontFamily: "'Tajawal',sans-serif" }}>
                    {bonusActive ? `إجابتان غلط — محاولة أخيرة لكل الطرفين (${bonusTimeLeft}ث)` : 'انتهت المحاولة الأخيرة'}
                  </p>
                )}
                <input
                  type="text"
                  value={answerText}
                  onChange={(e) => setAnswerText(e.target.value)}
                  disabled={timerExpired || myAttemptCount >= maxAttemptsForMe || (allFailedOnce && !bonusActive)}
                  placeholder="اكتب إجابتك هنا..."
                  dir="rtl"
                  className="w-full rounded-2xl px-4 py-3 text-white text-sm disabled:opacity-40"
                  style={{ background: 'rgba(255,255,255,0.05)', border: `1px solid ${accent}30`, fontFamily: "'Tajawal',sans-serif" }}
                />
                <button
                  onClick={handleSubmitAttempt}
                  disabled={!canSubmit || submittingAttempt}
                  className="w-full rounded-2xl py-4 font-black text-white text-base disabled:opacity-40"
                  style={{ background: `linear-gradient(135deg,${gradFrom},${gradTo})`, boxShadow: `0 0 20px ${glow}`, fontFamily: "'Tajawal',sans-serif" }}
                >
                  {openAttempt && openAttempt.answeringUserId === user.id
                    ? 'بانتظار حكم الحكم'
                    : openAttempt
                    ? `${players.find((p) => p.userId === openAttempt.answeringUserId)?.user.name ?? 'اللاعب الآخر'} بيجاوب الآن`
                    : timerExpired
                    ? 'انتهى الوقت'
                    : myAttemptCount >= maxAttemptsForMe
                    ? 'لا محاولات متبقية'
                    : submittingAttempt
                    ? '...'
                    : 'أجبت!'}
                </button>
              </>
            )}
          </div>
        )}

        {/* Attempts — visible to everyone in real time; only the referee can judge */}
        {timerRunning && (
          <div className="flex flex-col gap-3">
            <p className="text-white/40 text-xs" style={{ fontFamily: "'Tajawal',sans-serif" }}>المحاولات</p>
            {answers.length === 0 && (
              <p className="text-white/25 text-xs text-center py-4" style={{ fontFamily: "'Tajawal',sans-serif" }}>لا يوجد محاولات بعد</p>
            )}
            {answers.map((a) => {
              const player = players.find((p) => p.userId === a.answeringUserId);
              return (
                <div key={a.id} className="glass-md rounded-xl p-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-white" style={{ fontFamily: "'Tajawal',sans-serif" }}>{player?.user.name ?? '—'}</p>
                    {a.answerText && (
                      <p className="text-white/70 text-xs mt-0.5 truncate" style={{ fontFamily: "'Tajawal',sans-serif" }}>{a.answerText}</p>
                    )}
                    <p className="text-white/30 text-xs font-exo">{a.timeMs != null ? `${(a.timeMs / 1000).toFixed(1)}s` : ''}</p>
                  </div>
                  {a.judgedCorrect === null ? (
                    isReferee ? (
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleJudge(a, true)}
                          disabled={busyAnswerId === a.id}
                          className="w-9 h-9 rounded-xl flex items-center justify-center disabled:opacity-50"
                          style={{ background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.4)', color: '#34d399' }}
                        >
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                        </button>
                        <button
                          onClick={() => handleJudge(a, false)}
                          disabled={busyAnswerId === a.id}
                          className="w-9 h-9 rounded-xl flex items-center justify-center disabled:opacity-50"
                          style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', color: '#f87171' }}
                        >
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-amber-400" style={{ fontFamily: "'Tajawal',sans-serif" }}>بانتظار الحكم</span>
                    )
                  ) : (
                    <span className="text-xs font-bold" style={{ color: a.judgedCorrect ? '#34d399' : '#f87171' }}>
                      {a.judgedCorrect ? '✓ صح' : '✗ غلط'}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Referee: absolute control — starts the synced timer and decides when to move on or stop */}
        {isReferee && (
          <div className="flex flex-col gap-3">
            {!timerRunning && (
              <button
                onClick={handleStartTimer}
                disabled={startingTimer}
                className="w-full rounded-2xl py-4 font-black text-white text-base disabled:opacity-50"
                style={{ background: `linear-gradient(135deg,${gradFrom},${gradTo})`, boxShadow: `0 0 20px ${glow}`, fontFamily: "'Tajawal',sans-serif" }}
              >
                {startingTimer ? '...' : 'ابدأ المؤقت'}
              </button>
            )}

            <button
              onClick={goToNextOrEnd}
              disabled={advancing}
              className="w-full rounded-xl py-3 text-sm font-bold glass-md mt-1 disabled:opacity-50"
              style={{ color: accent, border: `1px solid ${accent}30`, fontFamily: "'Tajawal',sans-serif" }}
            >
              {match.currentQidx + 1 >= questions.length ? 'إنهاء المباراة' : 'تخطي للسؤال التالي'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
