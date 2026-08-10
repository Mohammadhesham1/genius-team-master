import { useState, useEffect, useRef } from 'react';
import type { User, PageName } from '../types';
import { getAllUsers } from '../lib/auth';
import {
  getRoundQuestions,
  getRoundProgress,
  getRoundsSummary,
  saveQuestionProgress,
  awardGroupPoints,
  resetQuestion as resetQuestionApi,
  resetRound as resetRoundApi,
  type GroupQuestion,
  type ProgressRecord,
  type GroupAttempt,
} from '../lib/api/group';

interface GroupTrainingPageProps {
  user: User;
  navigate: (page: PageName, params?: Record<string, string>) => void;
}

type View = 'home' | 'round' | 'stats';
type Phase = 'idle' | 'running' | 'revealed' | 'pickPlayer' | 'done';

const ROUND_LABELS: Record<number, string> = {
  1: 'الأولى', 2: 'الثانية', 3: 'الثالثة', 4: 'الرابعة', 5: 'الخامسة',
  6: 'السادسة', 7: 'السابعة', 8: 'الثامنة', 9: 'التاسعة', 10: 'العاشرة',
};
const ARABIC_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
function roundLabel(r: number): string {
  if (ROUND_LABELS[r]) return ROUND_LABELS[r];
  return `رقم ${String(r).split('').map((c) => ARABIC_DIGITS[Number(c)] ?? c).join('')}`;
}
// الجولات مقفولة على اللعب إلا للأدمن (محمد)، ما عدا آخر ٥ جولات فهي متاحة للكل — الإحصائيات مفتوحة للكل زي ما هي.
// قايمة الجولات نفسها ديناميكية (roundsSummary مبنية من getAvailableRounds)، فأي جولة
// جديدة تتضاف في Supabase بتظهر هنا تلقائي من غير أي تعديل كود.
const ADMIN_NAME = 'محمد';
const ACCENT = '#60a5fa';
const GRAD_FROM = '#3b82f6';
const GRAD_TO = '#8b5cf6';

function fmt(n: number | null): string {
  return n === null || n === undefined ? '—' : `${Math.round(n)} ث`;
}

export default function GroupTrainingPage({ user, navigate: _navigate }: GroupTrainingPageProps) {
  const isAdmin = user?.name === ADMIN_NAME;

  const [view, setView] = useState<View>('home');
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [roundsSummary, setRoundsSummary] = useState<Record<number, { total: number; correct: number; answered: number }>>({});
  const [loadingHome, setLoadingHome] = useState(true);

  const [round, setRound] = useState(1);
  const [questions, setQuestions] = useState<GroupQuestion[]>([]);
  const [progress, setProgress] = useState<Map<number, ProgressRecord>>(new Map());
  const [loadingRound, setLoadingRound] = useState(false);
  const [roundError, setRoundError] = useState('');
  const [qIdx, setQIdx] = useState(0);
  const [showList, setShowList] = useState(false);
  const [confirmResetRound, setConfirmResetRound] = useState(false);

  const [phase, setPhase] = useState<Phase>('idle');
  const [attemptNum, setAttemptNum] = useState<1 | 2>(1);
  const [timerDuration, setTimerDuration] = useState(20);
  const [timeLeft, setTimeLeft] = useState(20);
  const [pendingElapsed, setPendingElapsed] = useState<number | null>(null);
  const [pendingJudge, setPendingJudge] = useState<'correct' | 'wrong' | null>(null);

  const [statsRound, setStatsRound] = useState(1);
  const [statsData, setStatsData] = useState<{ questions: GroupQuestion[]; progress: Map<number, ProgressRecord> } | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerEndRef = useRef(0);
  const timerDurationRef = useRef(20);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const rightRow = allUsers.filter((u) => u.row === 'right');
  const leftRow = allUsers.filter((u) => u.row === 'left');
  const currentQ = questions[qIdx];
  const rounds = Object.keys(roundsSummary).map(Number).sort((a, b) => a - b);

  useEffect(() => {
    getAllUsers().then(setAllUsers).catch(() => setAllUsers([]));
  }, []);

  useEffect(() => {
    if (view !== 'home') return;
    let cancelled = false;
    setLoadingHome(true);
    getRoundsSummary()
      .then((s) => { if (!cancelled) setRoundsSummary(s); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoadingHome(false); });
    return () => { cancelled = true; };
  }, [view]);

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  const stopClock = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  };

  function getAudioCtx(): AudioContext | null {
    if (!audioCtxRef.current) {
      try {
        const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        audioCtxRef.current = new Ctor();
      } catch {
        audioCtxRef.current = null;
      }
    }
    return audioCtxRef.current;
  }
  function playTimerEndSound() {
    const ctx = getAudioCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const now = ctx.currentTime;
    [0, 0.16].forEach((offset, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = i === 0 ? 880 : 660;
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.35, now + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.15);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + 0.17);
    });
  }

  const canPlayRound = (r: number) => isAdmin || rounds.slice(-5).includes(r);

  const openRound = async (r: number) => {
    if (!canPlayRound(r)) return;
    stopClock();
    setLoadingRound(true);
    setRoundError('');
    setRound(r);
    setView('round');
    try {
      const [qs, prog] = await Promise.all([getRoundQuestions(r), getRoundProgress(r)]);
      setQuestions(qs);
      setProgress(prog);
      let resumeIdx = qs.findIndex((q) => !prog.get(q.position)?.final);
      if (resumeIdx === -1) resumeIdx = 0;
      setQIdx(resumeIdx);
      applyPhaseForRecord(prog.get(qs[resumeIdx]?.position ?? -1));
      setShowList(false);
      if (qs.length === 0) setRoundError('لسه مفيش أسئلة في الجولة دي — تأكد إنك شغّلت supabase/group_training_v2.sql');
    } catch (err) {
      const detail = err instanceof Error ? err.message : JSON.stringify(err);
      setRoundError(`تعذّر تحميل الأسئلة: ${detail}`);
      setQuestions([]);
    } finally {
      setLoadingRound(false);
    }
  };

  const openStats = async (r: number) => {
    stopClock();
    setStatsRound(r);
    setView('stats');
    setLoadingStats(true);
    try {
      const [qs, prog] = await Promise.all([getRoundQuestions(r), getRoundProgress(r)]);
      setStatsData({ questions: qs, progress: prog });
    } catch {
      setStatsData({ questions: [], progress: new Map() });
    } finally {
      setLoadingStats(false);
    }
  };

  const goHome = () => {
    stopClock();
    setView('home');
  };

  function applyPhaseForRecord(rec: ProgressRecord | undefined) {
    if (rec?.final) {
      setPhase('done');
      setAttemptNum(rec.attempts.length >= 2 ? 2 : 1);
    } else {
      setPhase('idle');
      setAttemptNum(1);
    }
    setTimerDuration(20);
    setPendingJudge(null);
    setPendingElapsed(null);
  }

  const goToQuestion = (idx: number) => {
    stopClock();
    const clamped = Math.max(0, Math.min(questions.length - 1, idx));
    setQIdx(clamped);
    applyPhaseForRecord(progress.get(questions[clamped]?.position ?? -1));
    setShowList(false);
  };

  const startTimer = () => {
    getAudioCtx();
    const dur = attemptNum === 1 ? 20 : 10;
    timerDurationRef.current = dur;
    setTimerDuration(dur);
    setTimeLeft(dur);
    setPhase('running');
    timerEndRef.current = Date.now() + dur * 1000;
    stopClock();
    timerRef.current = setInterval(() => {
      const remaining = Math.max(0, (timerEndRef.current - Date.now()) / 1000);
      setTimeLeft(remaining);
      if (remaining <= 0) {
        playTimerEndSound();
        finishTimer(true);
      }
    }, 100);
  };

  const finishTimer = (auto: boolean) => {
    stopClock();
    const remaining = auto ? 0 : Math.max(0, (timerEndRef.current - Date.now()) / 1000);
    const elapsed = timerDurationRef.current - remaining;
    setPendingElapsed(Math.round(elapsed));
    setPhase('revealed');
  };

  const judge = (result: 'correct' | 'wrong') => {
    setPendingJudge(result);
    setPhase('pickPlayer');
  };

  const pickPlayer = async (playerId: string) => {
    const q = currentQ;
    if (!q || !pendingJudge) return;
    const rec = progress.get(q.position);
    const attempts: GroupAttempt[] = rec ? [...rec.attempts] : [];
    attempts.push({ n: attemptNum, time_s: pendingElapsed ?? 0, player_id: playerId, result: pendingJudge });

    let final: 'correct' | 'wrong' | null = null;
    let nextPhase: Phase;
    let nextAttemptNum: 1 | 2 = attemptNum;

    if (pendingJudge === 'correct') {
      final = 'correct';
      nextPhase = 'done';
    } else if (attemptNum === 1) {
      nextAttemptNum = 2;
      nextPhase = 'idle';
      setTimerDuration(10);
    } else {
      final = 'wrong';
      nextPhase = 'done';
    }

    setProgress((prev) => {
      const next = new Map(prev);
      next.set(q.position, { attempts, final });
      return next;
    });
    setAttemptNum(nextAttemptNum);
    setPhase(nextPhase);
    setPendingJudge(null);
    setPendingElapsed(null);

    try {
      await saveQuestionProgress(round, q.position, attempts, final);
      if (pendingJudge === 'correct') await awardGroupPoints(playerId, 5);
    } catch {
      /* best-effort — local UI already reflects the attempt */
    }
  };

  const nextQuestionNav = () => goToQuestion(qIdx + 1);
  const prevQuestionNav = () => goToQuestion(qIdx - 1);

  const doResetQuestion = async () => {
    const q = currentQ;
    if (!q) return;
    try { await resetQuestionApi(round, q.position); } catch { /* noop */ }
    setProgress((prev) => { const next = new Map(prev); next.delete(q.position); return next; });
    setPhase('idle');
    setAttemptNum(1);
    setTimerDuration(20);
    setPendingJudge(null);
    setPendingElapsed(null);
  };

  const confirmAndResetRound = async () => {
    setConfirmResetRound(false);
    try { await resetRoundApi(round); } catch { /* noop */ }
    setProgress(new Map());
    setQIdx(0);
    setPhase('idle');
    setAttemptNum(1);
    setTimerDuration(20);
    setPendingJudge(null);
    setPendingElapsed(null);
    setShowList(false);
  };

  const timerColor = timeLeft > 10 ? '#10b981' : timeLeft > 5 ? '#f59e0b' : '#ef4444';

  // ── HOME ──────────────────────────────────────────────────────────────
  if (view === 'home') {
    return (
      <div className="relative min-h-dvh flex flex-col pb-28">
        <div className="px-4 pt-12 pb-4">
          <h1 className="text-2xl font-black gradient-text" style={{ fontFamily: "'Tajawal',sans-serif" }}>التدريب الجماعي</h1>
        </div>
        {loadingHome ? (
          <div className="px-4 grid grid-cols-1 gap-3 mt-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="rounded-2xl animate-glow-pulse" style={{ height: 96, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }} />
            ))}
          </div>
        ) : (
          <div className="px-4 flex flex-col gap-3 mt-2">
            {rounds.map((r) => {
              const s = roundsSummary[r] ?? { total: 0, correct: 0, answered: 0 };
              const pct = s.total ? Math.round((s.correct / s.total) * 100) : 0;
              const canStart = canPlayRound(r);
              return (
                <div key={r} className="glass-md rounded-2xl p-4">
                  <p className="font-black text-lg text-white" style={{ fontFamily: "'Tajawal',sans-serif" }}>الجولة {roundLabel(r)}</p>
                  <p className="text-white/35 text-xs mt-0.5 font-exo">{s.correct} / {s.total} اتجاوب صح</p>
                  <div className="h-1.5 rounded-full overflow-hidden mt-2.5 mb-3" style={{ background: 'rgba(255,255,255,0.06)' }}>
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: `linear-gradient(90deg,${GRAD_FROM},${GRAD_TO})` }} />
                  </div>
                  <div className="flex gap-2.5">
                    <button
                      onClick={() => canStart && openRound(r)}
                      disabled={!canStart}
                      className="flex-1 rounded-xl py-2.5 text-sm font-bold text-white disabled:opacity-30 disabled:cursor-not-allowed disabled:grayscale"
                      style={{ background: `linear-gradient(135deg,${GRAD_FROM},${GRAD_TO})`, boxShadow: canStart ? `0 0 16px rgba(59,130,246,0.35)` : 'none', fontFamily: "'Tajawal',sans-serif" }}
                    >
                      {s.answered > 0 ? 'متابعة' : 'ابدأ'}
                    </button>
                    <button
                      onClick={() => openStats(r)}
                      className="flex-1 rounded-xl py-2.5 text-sm font-bold glass-md"
                      style={{ color: ACCENT, fontFamily: "'Tajawal',sans-serif" }}
                    >
                      الإحصائيات
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ── STATS ─────────────────────────────────────────────────────────────
  if (view === 'stats') {
    if (loadingStats || !statsData) {
      return (
        <div className="relative min-h-dvh flex items-center justify-center">
          <div className="w-8 h-8 rounded-full animate-spin-slow" style={{ border: '3px solid rgba(255,255,255,0.15)', borderTopColor: ACCENT }} />
        </div>
      );
    }
    const s = computeRoundStats(statsData.questions, statsData.progress, allUsers);
    return (
      <div className="relative min-h-dvh flex flex-col pb-28 overflow-y-auto">
        <div className="px-4 pt-12 pb-4 flex items-center gap-2 flex-wrap">
          <button onClick={goHome} className="text-xs px-3 py-1.5 rounded-lg glass-md" style={{ color: ACCENT, fontFamily: "'Tajawal',sans-serif" }}>الرئيسية</button>
          <button onClick={() => openRound(statsRound)} className="text-xs px-3 py-1.5 rounded-lg glass-md" style={{ color: ACCENT, fontFamily: "'Tajawal',sans-serif" }}>الرجوع للجولة</button>
          {rounds.filter((r) => r !== statsRound).map((r) => (
            <button key={r} onClick={() => openStats(r)} className="text-xs px-3 py-1.5 rounded-lg glass-md text-white/50" style={{ fontFamily: "'Tajawal',sans-serif" }}>
              إحصائيات {roundLabel(r)}
            </button>
          ))}
          <button
            onClick={() => setConfirmResetRound(true)}
            className="text-xs px-3 py-1.5 rounded-lg"
            style={{ background: 'rgba(239,68,68,0.12)', color: '#f87171', border: '1px solid rgba(239,68,68,0.25)', fontFamily: "'Tajawal',sans-serif" }}
          >
            ريسيت الجولة
          </button>
        </div>

        <div className="px-4">
          <h2 className="text-xl font-black text-white mb-3" style={{ fontFamily: "'Tajawal',sans-serif" }}>إحصائيات الجولة {roundLabel(statsRound)}</h2>

          <div className="glass-md rounded-2xl p-4 mb-4">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div><p className="text-2xl font-black font-exo text-green-400">{s.correctCount}</p><p className="text-white/35 text-xs" style={{ fontFamily: "'Tajawal',sans-serif" }}>إجابات صحيحة</p></div>
              <div><p className="text-2xl font-black font-exo text-red-400">{s.wrongCount}</p><p className="text-white/35 text-xs" style={{ fontFamily: "'Tajawal',sans-serif" }}>إجابات خاطئة</p></div>
              <div><p className="text-2xl font-black font-exo text-white">{s.answeredCount}/{s.total}</p><p className="text-white/35 text-xs" style={{ fontFamily: "'Tajawal',sans-serif" }}>تم الإجابة</p></div>
            </div>
            <div className="h-px bg-white/5 my-3" />
            <p className="text-white/40 text-xs" style={{ fontFamily: "'Tajawal',sans-serif" }}>متوسط سرعة الإجابة العامة: <span className="font-exo text-white/70">{fmt(s.avgOverall)}</span></p>
            <p className="text-white/40 text-xs mt-1" style={{ fontFamily: "'Tajawal',sans-serif" }}>متوسط سرعة الإجابات الصحيحة: <span className="font-exo text-green-400">{fmt(s.avgCorrect)}</span></p>
            <p className="text-white/40 text-xs mt-1" style={{ fontFamily: "'Tajawal',sans-serif" }}>متوسط سرعة الإجابات الخاطئة: <span className="font-exo text-red-400">{fmt(s.avgWrong)}</span></p>

            <div className="grid grid-cols-2 gap-3 mt-4">
              <div>
                <p className="text-white/40 text-xs font-bold mb-1.5" style={{ fontFamily: "'Tajawal',sans-serif" }}>قائمة الإجابات الصحيحة</p>
                <div className="max-h-40 overflow-y-auto text-xs text-white/50 leading-7 pl-3" style={{ fontFamily: "'Tajawal',sans-serif" }}>
                  {s.correctList.length ? s.correctList.map((q, i) => <p key={i}>{q}</p>) : <p>—</p>}
                </div>
              </div>
              <div>
                <p className="text-white/40 text-xs font-bold mb-1.5" style={{ fontFamily: "'Tajawal',sans-serif" }}>قائمة الإجابات الخاطئة</p>
                <div className="max-h-40 overflow-y-auto text-xs text-white/50 leading-7 pl-3" style={{ fontFamily: "'Tajawal',sans-serif" }}>
                  {s.wrongList.length ? s.wrongList.map((q, i) => <p key={i}>{q}</p>) : <p>—</p>}
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {allUsers.map((u) => {
              const ps = s.playerStats[u.id] ?? { correct: 0, wrong: 0, correctTimes: [], wrongTimes: [], allTimes: [] };
              const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
              return (
                <div key={u.id} className="glass-md rounded-2xl p-3.5">
                  <p className="font-bold text-sm" style={{ color: u.color, fontFamily: "'Tajawal',sans-serif" }}>{u.name}</p>
                  <div className="flex items-center gap-4 mt-2">
                    <div><p className="text-lg font-black font-exo text-green-400">{ps.correct}</p><p className="text-white/30 text-[10px]">صح</p></div>
                    <div><p className="text-lg font-black font-exo text-red-400">{ps.wrong}</p><p className="text-white/30 text-[10px]">غلط</p></div>
                  </div>
                  <p className="text-white/25 text-[10px] mt-2 font-exo">
                    صح: {fmt(avg(ps.correctTimes))} · غلط: {fmt(avg(ps.wrongTimes))} · عام: {fmt(avg(ps.allTimes))}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        {confirmResetRound && (
          <ResetConfirmModal onConfirm={confirmAndResetRound} onCancel={() => setConfirmResetRound(false)} />
        )}
      </div>
    );
  }

  // ── ROUND ─────────────────────────────────────────────────────────────
  if (loadingRound || (!currentQ && !roundError)) {
    return (
      <div className="relative min-h-dvh flex items-center justify-center">
        <div className="w-8 h-8 rounded-full animate-spin-slow" style={{ border: '3px solid rgba(255,255,255,0.15)', borderTopColor: ACCENT }} />
      </div>
    );
  }

  if (roundError) {
    return (
      <div className="relative min-h-dvh flex flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-4xl">⚠️</p>
        <p className="text-white/70 text-sm" style={{ fontFamily: "'Tajawal',sans-serif" }}>{roundError}</p>
        <div className="flex gap-3">
          <button onClick={() => openRound(round)} className="px-5 py-2.5 rounded-xl text-sm font-bold text-white" style={{ background: `linear-gradient(135deg,${GRAD_FROM},${GRAD_TO})`, fontFamily: "'Tajawal',sans-serif" }}>حاول تاني</button>
          <button onClick={goHome} className="px-5 py-2.5 rounded-xl text-sm font-bold glass-md text-white/60" style={{ fontFamily: "'Tajawal',sans-serif" }}>الرئيسية</button>
        </div>
      </div>
    );
  }

  const rec = progress.get(currentQ.position);

  return (
    <div className="relative min-h-dvh flex flex-col pb-28 overflow-hidden">
      {/* Top actions */}
      <div className="px-4 pt-10 pb-2 flex items-center gap-2 flex-wrap">
        <button onClick={goHome} className="text-xs px-3 py-1.5 rounded-lg glass-md" style={{ color: ACCENT, fontFamily: "'Tajawal',sans-serif" }}>الرئيسية</button>
        <button onClick={() => setShowList((v) => !v)} className="text-xs px-3 py-1.5 rounded-lg glass-md text-white/50" style={{ fontFamily: "'Tajawal',sans-serif" }}>قائمة الأسئلة</button>
        <button onClick={() => openStats(round)} className="text-xs px-3 py-1.5 rounded-lg glass-md text-white/50" style={{ fontFamily: "'Tajawal',sans-serif" }}>الإحصائيات</button>
        <button
          onClick={() => setConfirmResetRound(true)}
          className="text-xs px-3 py-1.5 rounded-lg"
          style={{ background: 'rgba(239,68,68,0.12)', color: '#f87171', border: '1px solid rgba(239,68,68,0.25)', fontFamily: "'Tajawal',sans-serif" }}
        >
          ريسيت الجولة
        </button>
      </div>

      {/* Question list overlay */}
      {showList && (
        <div className="px-4 mb-2">
          <div className="glass-md rounded-2xl p-3 grid grid-cols-6 gap-1.5 max-h-64 overflow-y-auto">
            {questions.map((q, i) => {
              const r = progress.get(q.position);
              const cur = i === qIdx;
              return (
                <button
                  key={q.id}
                  onClick={() => goToQuestion(i)}
                  className="rounded-lg py-2 text-xs font-bold text-center"
                  style={{
                    background: r?.final === 'correct' ? '#10b981' : r?.final === 'wrong' ? '#ef4444' : 'rgba(255,255,255,0.05)',
                    color: r?.final ? 'white' : 'rgba(255,255,255,0.4)',
                    outline: cur ? `2px solid ${ACCENT}` : 'none',
                    fontFamily: "'Exo 2',sans-serif",
                  }}
                >
                  {i + 1}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Header row: question count + nav arrows */}
      <div className="px-4 flex items-center justify-between mb-2">
        <span className="text-white/35 text-xs font-exo">الجولة {roundLabel(round)} — سؤال {qIdx + 1} من {questions.length}</span>
        <div className="flex gap-2">
          <button onClick={prevQuestionNav} disabled={qIdx === 0} className="w-8 h-8 rounded-lg flex items-center justify-center glass-md disabled:opacity-20">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
          <button onClick={nextQuestionNav} disabled={qIdx === questions.length - 1} className="w-8 h-8 rounded-lg flex items-center justify-center glass-md disabled:opacity-20">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
        </div>
      </div>

      <div className="px-4 flex-1 flex flex-col gap-4">
        <div className="rounded-2xl p-5" style={{ background: `${ACCENT}0e`, border: `1px solid ${ACCENT}25`, boxShadow: `0 4px 24px rgba(59,130,246,0.25)` }}>
          <p className="text-lg font-bold text-white text-center leading-snug" style={{ fontFamily: "'Tajawal',sans-serif", direction: 'rtl' }}>
            {currentQ.question}
          </p>
          {phase === 'idle' && attemptNum === 2 && (
            <p className="text-center text-amber-400 text-xs mt-3" style={{ fontFamily: "'Tajawal',sans-serif" }}>فرصة ثانية</p>
          )}
        </div>

        {phase === 'idle' && (
          <button
            onClick={startTimer}
            className="w-full rounded-2xl py-5 font-black text-white text-lg"
            style={{ background: `linear-gradient(135deg,${GRAD_FROM},${GRAD_TO})`, boxShadow: `0 0 28px rgba(59,130,246,0.5)`, fontFamily: "'Tajawal',sans-serif" }}
          >
            ابدأ التايمر ({attemptNum === 1 ? 20 : 10} ث)
          </button>
        )}

        {phase === 'running' && (
          <div className="flex flex-col items-center gap-4">
            <div className="relative w-24 h-24">
              <svg className="absolute inset-0 -rotate-90" width="96" height="96" viewBox="0 0 96 96">
                <circle className="timer-track" cx="48" cy="48" r="44" strokeWidth="4"/>
                <circle
                  cx="48" cy="48" r="44" strokeWidth="4" fill="none"
                  stroke={timerColor}
                  strokeDasharray="276.46"
                  strokeDashoffset={276.46 - (timeLeft / timerDuration) * 276.46}
                  style={{ filter: `drop-shadow(0 0 6px ${timerColor})`, transition: 'stroke-dashoffset 0.1s linear' }}
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-2xl font-black font-exo" style={{ color: timerColor, textShadow: `0 0 10px ${timerColor}` }}>{Math.ceil(timeLeft)}</span>
              </div>
            </div>
            <button
              onClick={() => finishTimer(false)}
              className="w-full rounded-2xl py-4 font-black text-white text-base"
              style={{ background: 'linear-gradient(135deg,#ef4444,#f97316)', boxShadow: '0 0 20px rgba(239,68,68,0.4)', fontFamily: "'Tajawal',sans-serif" }}
            >
              إجابة
            </button>
          </div>
        )}

        {phase === 'revealed' && (
          <div className="flex flex-col gap-3 animate-slide-up">
            <div className="rounded-2xl p-4" style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.3)' }}>
              <p className="text-green-400/60 text-xs mb-1" style={{ fontFamily: "'Tajawal',sans-serif" }}>الإجابة الصحيحة</p>
              <p className="text-white font-bold text-base" style={{ fontFamily: "'Tajawal',sans-serif" }}>{currentQ.answer}</p>
              <p className="text-white/30 text-xs mt-2 font-exo">الوقت المسجل: {fmt(pendingElapsed)}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => judge('correct')} className="rounded-xl py-3.5 font-bold text-base" style={{ background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.4)', color: '#34d399', fontFamily: "'Tajawal',sans-serif" }}>إجابة صحيحة</button>
              <button onClick={() => judge('wrong')} className="rounded-xl py-3.5 font-bold text-base" style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', color: '#f87171', fontFamily: "'Tajawal',sans-serif" }}>إجابة خاطئة</button>
            </div>
          </div>
        )}

        {phase === 'pickPlayer' && (
          <div className="flex flex-col gap-3 animate-slide-up">
            <p className="text-white/50 text-sm text-center" style={{ fontFamily: "'Tajawal',sans-serif" }}>مين اللي جاوب؟</p>
            <div className="grid grid-cols-4 gap-2">
              {rightRow.map((u) => (
                <button key={u.id} onClick={() => pickPlayer(u.id)} className="rounded-xl py-3 text-xs font-bold text-white" style={{ background: `${u.color}18`, border: `1px solid ${u.color}30` }}>{u.name}</button>
              ))}
            </div>
            <div className="grid grid-cols-4 gap-2">
              {leftRow.map((u) => (
                <button key={u.id} onClick={() => pickPlayer(u.id)} className="rounded-xl py-3 text-xs font-bold text-white" style={{ background: `${u.color}18`, border: `1px solid ${u.color}30` }}>{u.name}</button>
              ))}
            </div>
          </div>
        )}

        {phase === 'done' && rec && (
          <div className="flex flex-col gap-3 animate-slide-up">
            <div className="rounded-2xl p-4" style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.3)' }}>
              <p className="text-green-400/60 text-xs mb-1" style={{ fontFamily: "'Tajawal',sans-serif" }}>الإجابة الصحيحة</p>
              <p className="text-white font-bold text-base" style={{ fontFamily: "'Tajawal',sans-serif" }}>{currentQ.answer}</p>
              <div className="flex flex-col gap-1.5 mt-3">
                {rec.attempts.map((a, i) => {
                  const player = allUsers.find((u) => u.id === a.player_id);
                  return (
                    <div
                      key={i}
                      className="flex items-center justify-between text-xs px-3 py-2 rounded-lg"
                      style={{ background: a.result === 'correct' ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)', color: a.result === 'correct' ? '#34d399' : '#f87171' }}
                    >
                      <span>محاولة {a.n} — {player?.name ?? '؟'}</span>
                      <span className="font-exo">{a.result === 'correct' ? 'صح' : 'غلط'} · {fmt(a.time_s)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {qIdx < questions.length - 1 ? (
                <button onClick={nextQuestionNav} className="rounded-xl py-3.5 font-bold text-white text-sm" style={{ background: `linear-gradient(135deg,${GRAD_FROM},${GRAD_TO})`, fontFamily: "'Tajawal',sans-serif" }}>التالي</button>
              ) : (
                <button onClick={() => openStats(round)} className="rounded-xl py-3.5 font-bold text-white text-sm" style={{ background: 'linear-gradient(135deg,#10b981,#06b6d4)', fontFamily: "'Tajawal',sans-serif" }}>انتهت الجولة — الإحصائيات</button>
              )}
              <button onClick={doResetQuestion} className="rounded-xl py-3.5 font-bold text-sm glass-md text-white/50" style={{ fontFamily: "'Tajawal',sans-serif" }}>إعادة السؤال</button>
            </div>
          </div>
        )}
      </div>

      {confirmResetRound && (
        <ResetConfirmModal onConfirm={confirmAndResetRound} onCancel={() => setConfirmResetRound(false)} />
      )}
    </div>
  );
}

function ResetConfirmModal({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={onCancel}>
      <div className="glass-md rounded-2xl p-5 max-w-xs w-full" onClick={(e) => e.stopPropagation()}>
        <p className="text-white font-bold text-sm text-center mb-2" style={{ fontFamily: "'Tajawal',sans-serif" }}>تأكيد إعادة تعيين الجولة</p>
        <p className="text-white/40 text-xs text-center mb-4" style={{ fontFamily: "'Tajawal',sans-serif" }}>
          هيتم مسح كل الإجابات (والنقاط المرتبطة بيها) والبدء من السؤال الأول. مفيش رجوع بعد كده.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <button onClick={onConfirm} className="rounded-xl py-2.5 text-sm font-bold text-white" style={{ background: 'linear-gradient(135deg,#ef4444,#f97316)', fontFamily: "'Tajawal',sans-serif" }}>تأكيد</button>
          <button onClick={onCancel} className="rounded-xl py-2.5 text-sm font-bold text-white/60 glass-md" style={{ fontFamily: "'Tajawal',sans-serif" }}>إلغاء</button>
        </div>
      </div>
    </div>
  );
}

// ── Stats computation (mirrors the reference logic exactly) ────────────────
interface PlayerRoundStats {
  correct: number;
  wrong: number;
  correctTimes: number[];
  wrongTimes: number[];
  allTimes: number[];
}

function computeRoundStats(questions: GroupQuestion[], progress: Map<number, ProgressRecord>, users: User[]) {
  const correctList: string[] = [];
  const wrongList: string[] = [];
  const allTimes: number[] = [];
  const correctTimes: number[] = [];
  const wrongTimes: number[] = [];
  const playerStats: Record<string, PlayerRoundStats> = {};
  users.forEach((u) => { playerStats[u.id] = { correct: 0, wrong: 0, correctTimes: [], wrongTimes: [], allTimes: [] }; });

  questions.forEach((q) => {
    const rec = progress.get(q.position);
    if (!rec || !rec.final) return;
    if (rec.final === 'correct') correctList.push(q.question); else wrongList.push(q.question);
    rec.attempts.forEach((a) => {
      allTimes.push(a.time_s);
      if (a.result === 'correct') correctTimes.push(a.time_s); else wrongTimes.push(a.time_s);
      const ps = playerStats[a.player_id];
      if (ps) {
        ps.allTimes.push(a.time_s);
        if (a.result === 'correct') { ps.correct++; ps.correctTimes.push(a.time_s); }
        else { ps.wrong++; ps.wrongTimes.push(a.time_s); }
      }
    });
  });

  const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
  return {
    correctCount: correctList.length,
    wrongCount: wrongList.length,
    correctList,
    wrongList,
    avgOverall: avg(allTimes),
    avgCorrect: avg(correctTimes),
    avgWrong: avg(wrongTimes),
    playerStats,
    answeredCount: correctList.length + wrongList.length,
    total: questions.length,
  };
}
