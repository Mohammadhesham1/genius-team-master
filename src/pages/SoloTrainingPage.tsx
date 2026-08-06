import { useState, useEffect, useRef, useCallback } from 'react';
import type { User, PageName, Question, Subject } from '../types';
import { getAllSubjects, getSubjectById } from '../lib/api/subjects';
import { getOrCreateSoloProgress, getSoloQuestions, getQuestionCount, submitSoloAnswer, advanceSoloProgress, getReviewQuestions } from '../lib/api/solo';
import { notifyStreakChanged } from '../lib/api/streak';
import StreakBadge from '../components/StreakBadge';
import StudyTodayBadge from '../components/StudyTodayBadge';
import { STICKERS } from '../lib/stickersData';

interface SoloTrainingPageProps {
  user: User;
  navigate: (page: PageName, params?: Record<string, string>) => void;
}

type Phase =
  | 'pick-subject'
  | 'no-questions'
  | 'timer'
  | 'reveal'
  | 'sticker';

const TIMER = 30;

export default function SoloTrainingPage({ user, navigate: _navigate }: SoloTrainingPageProps) {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loadingSubjects, setLoadingSubjects] = useState(true);
  const [questionCounts, setQuestionCounts] = useState<Record<string, number>>({});

  const [subjectId, setSubjectId] = useState('');
  const [subject, setSubject] = useState<Subject | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loadingQuestions, setLoadingQuestions] = useState(false);
  const [qIdx, setQIdx] = useState(0);
  const [phase, setPhase] = useState<Phase>('pick-subject');
  const [timeLeft, setTimeLeft] = useState(TIMER);
  const [answer1, setAnswer1] = useState('');
  const [answer2, setAnswer2] = useState('');
  const [sessionScore, setSessionScore] = useState({ correct: 0, total: 0 });
  const [showSidebar, setShowSidebar] = useState(false);
  const [resultHistory, setResultHistory] = useState<{ qIdx: number; correct: boolean; attempt: 1 | 2 }[]>([]);
  const [reviewMode, setReviewMode] = useState(false);
  
  const [activeSticker, setActiveSticker] = useState<string | null>(null);
  const [streak, setStreak] = useState({ correct: 0, wrong: 0 });
  const [lastBrokenStreak, setLastBrokenStreak] = useState<{ type: 'correct' | 'wrong' | null; count: number }>({ type: null, count: 0 });

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inputRef1 = useRef<HTMLInputElement>(null);
  const inputRef2 = useRef<HTMLInputElement>(null);
  const questionStartRef = useRef<number | null>(null);

  const currentQ = questions[qIdx];

  useEffect(() => {
    let cancelled = false;
    setLoadingSubjects(true);
    getAllSubjects()
      .then(async (list) => {
        if (cancelled) return;
        setSubjects(list);
        const counts = await Promise.all(list.map((s) => getQuestionCount(s.id).catch(() => 0)));
        if (cancelled) return;
        const map: Record<string, number> = {};
        list.forEach((s, i) => { map[s.id] = counts[i]; });
        setQuestionCounts(map);
      })
      .catch(() => {
        if (!cancelled) setSubjects([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingSubjects(false);
      });
    return () => { cancelled = true; };
  }, [user.id]);

  const stopTimer = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

  const startCountdown = useCallback((seconds: number, onDone: () => void) => {
    stopTimer();
    setTimeLeft(seconds);
    timerRef.current = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) { clearInterval(timerRef.current!); timerRef.current = null; onDone(); return 0; }
        return t - 1;
      });
    }, 1000);
  }, [stopTimer]);

  useEffect(() => () => stopTimer(), [stopTimer]);

  const startSubject = async (sid: string) => {
    setLoadingQuestions(true);
    setSubjectId(sid);
    try {
      const [s, nextPos] = await Promise.all([getSubjectById(sid), getOrCreateSoloProgress(user.id, sid)]);
      const qs = await getSoloQuestions(sid, nextPos);
      setSubject(s);
      setQIdx(0);
      setSessionScore({ correct: 0, total: 0 });
      setResultHistory([]);
      setStreak({ correct: 0, wrong: 0 });
      setAnswer1(''); setAnswer2('');

      if (qs.length > 0) {
        setReviewMode(false);
        setQuestions(qs);
        setPhase('timer');
        questionStartRef.current = Date.now();
        startCountdown(TIMER, () => setPhase('reveal'));
        setTimeout(() => inputRef1.current?.focus(), 100);
        return;
      }

      const reviewQs = await getReviewQuestions(user.id, sid);
      if (reviewQs.length > 0) {
        setReviewMode(true);
        setQuestions(reviewQs);
        setPhase('timer');
        questionStartRef.current = Date.now();
        startCountdown(TIMER, () => setPhase('reveal'));
        setTimeout(() => inputRef1.current?.focus(), 100);
        return;
      }

      setReviewMode(false);
      setQuestions([]);
      setPhase('no-questions');
    } catch {
      setPhase('no-questions');
    } finally {
      setLoadingQuestions(false);
    }
  };

  const handleAnswerButton = () => {
    stopTimer();
    setPhase('reveal');
  };

  const recordAnswer = (isCorrect: boolean, correctOn: 1 | 2 | null) => {
    if (!currentQ) return;
    const now = Date.now();
    const elapsedMs = questionStartRef.current != null ? now - questionStartRef.current : null;
    const firstMs = answer1 ? elapsedMs : null;
    const secondMs = answer2 ? elapsedMs : null;
    const position = currentQ.position;

    submitSoloAnswer({
      userId: user.id,
      subjectId,
      questionId: currentQ.id,
      firstAnswer: answer1,
      firstTimeMs: firstMs,
      secondAnswer: answer2,
      secondTimeMs: secondMs,
      isCorrect,
      correctOn,
      isReview: reviewMode,
    })
      .then(() => {
        if (isCorrect) notifyStreakChanged(user.id);
      })
      .catch(() => {});

    if (!reviewMode && position != null) {
      advanceSoloProgress(user.id, subjectId, position + 1).catch(() => {});
    }
  };

  const showSticker = (isCorrect: boolean) => {
    const prevStreak = { ...streak };
    const newStreak = isCorrect 
      ? { correct: streak.correct + 1, wrong: 0 }
      : { correct: 0, wrong: streak.wrong + 1 };
    
    setStreak(newStreak);

    // Track the length of the streak that was just broken. This persists across
    // every answer of the new streak (not just the first one), so stickers that
    // require "after a streak of N or more" can check the real prior length even
    // on the 2nd/3rd answer of the new streak, not just the moment it switched.
    const switchedFromWrong = isCorrect && prevStreak.correct === 0 && prevStreak.wrong > 0;
    const switchedFromCorrect = !isCorrect && prevStreak.wrong === 0 && prevStreak.correct > 0;
    let brokenStreak = lastBrokenStreak;
    if (switchedFromWrong) {
      brokenStreak = { type: 'wrong', count: prevStreak.wrong };
      setLastBrokenStreak(brokenStreak);
    } else if (switchedFromCorrect) {
      brokenStreak = { type: 'correct', count: prevStreak.correct };
      setLastBrokenStreak(brokenStreak);
    }

    const priorStreakMeetsThreshold = (r: typeof STICKERS[number]['rules'], requiredType: 'correct' | 'wrong') => {
      if (!r.prevStreakCount) return true;
      if (brokenStreak.type !== requiredType) return false;
      return r.prevOrMore
        ? brokenStreak.count >= r.prevStreakCount
        : brokenStreak.count === r.prevStreakCount;
    };

    const eligible = STICKERS.filter(s => {
      const r = s.rules;
      if (r.isBoth) return true;
      if (r.isGeneral) {
        if (isCorrect && r.isCorrect) return true;
        if (!isCorrect && r.isWrong) return true;
      }
      if (r.streakCount > 0) {
        const currentVal = isCorrect ? newStreak.correct : newStreak.wrong;
        const matchesType = isCorrect ? r.isCorrect : r.isWrong;
        if (matchesType) {
          const currentOk = r.orMore ? currentVal >= r.streakCount : currentVal === r.streakCount;
          if (currentOk && priorStreakMeetsThreshold(r, isCorrect ? 'wrong' : 'correct')) return true;
        }
      }
      if (r.afterStreak && !r.streakCount) {
        if (isCorrect && r.isCorrect && prevStreak.wrong > 0 && priorStreakMeetsThreshold(r, 'wrong')) return true;
        if (!isCorrect && r.isWrong && prevStreak.correct > 0 && priorStreakMeetsThreshold(r, 'correct')) return true;
      }
      if (isCorrect && r.isCorrect && !r.streakCount && !r.afterStreak) return true;
      if (!isCorrect && r.isWrong && !r.streakCount && !r.afterStreak) return true;
      return false;
    });

    if (eligible.length > 0) {
      const picked = eligible[Math.floor(Math.random() * eligible.length)];
      setActiveSticker(picked.path);
      setPhase('sticker');
      
      setTimeout(() => {
        setActiveSticker(null);
        nextQuestion();
      }, 2000);
    } else {
      nextQuestion();
    }
  };

  const handleCorrect = (attempt: 1 | 2) => {
    recordAnswer(true, attempt);
    setSessionScore((s) => ({ correct: s.correct + 1, total: s.total + 1 }));
    setResultHistory((h) => [...h, { qIdx, correct: true, attempt }]);
    showSticker(true);
  };

  const handleWrong = () => {
    recordAnswer(false, null);
    setSessionScore((s) => ({ ...s, total: s.total + 1 }));
    setResultHistory((h) => [...h, { qIdx, correct: false, attempt: 2 }]);
    showSticker(false);
  };

  const nextQuestion = () => {
    const next = qIdx + 1;
    if (next >= questions.length) {
      setPhase('pick-subject');
      setSubjectId('');
      setSubject(null);
      return;
    }
    setQIdx(next);
    setAnswer1(''); setAnswer2('');
    setPhase('timer');
    questionStartRef.current = Date.now();
    startCountdown(TIMER, () => setPhase('reveal'));
    setTimeout(() => inputRef1.current?.focus(), 100);
  };

  const jumpToQuestion = (i: number) => {
    stopTimer();
    setQIdx(i);
    setPhase('timer');
    setAnswer1(''); setAnswer2('');
    questionStartRef.current = Date.now();
    startCountdown(TIMER, () => setPhase('reveal'));
  };

  const timerMax = TIMER;
  const timerColor = timeLeft > 10 ? '#10b981' : timeLeft > 5 ? '#f59e0b' : '#ef4444';

  if (phase === 'pick-subject') {
    return (
      <div className="relative min-h-dvh flex flex-col pb-28">
        <div className="px-4 pt-12 pb-4 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-black gradient-text" style={{ fontFamily: "'Tajawal',sans-serif" }}>التمرين الفردي</h1>
            <p className="text-white/35 text-sm mt-1" style={{ fontFamily: "'Tajawal',sans-serif" }}>اختر فرعاً للبدء</p>
          </div>
          <div className="flex flex-col gap-1.5 items-end">
            <StreakBadge userId={user.id} size="md" />
            <StudyTodayBadge userId={user.id} size="md" />
          </div>
        </div>
        {loadingSubjects ? (
          <div className="px-4 grid grid-cols-2 gap-3 mt-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-2xl animate-glow-pulse" style={{ height: 72, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }} />
            ))}
          </div>
        ) : (
          <div className="px-4 grid grid-cols-2 gap-3 mt-2">
            {subjects.map((s) => (
              <button
                key={s.id}
                onClick={() => startSubject(s.id)}
                disabled={loadingQuestions}
                className="rounded-2xl p-4 text-right transition-all duration-200 hover:scale-[1.02] disabled:opacity-50"
                style={{
                  background: `${s.color}15`,
                  border: `1px solid ${s.color}30`,
                }}
              >
                <p className="font-bold text-white text-sm" style={{ fontFamily: "'Tajawal',sans-serif" }}>{s.name}</p>
                <p className="text-white/30 text-xs font-exo mt-0.5">
                  {questionCounts[s.id] ?? '...'} سؤال
                </p>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (phase === 'no-questions') {
    return (
      <div className="relative min-h-dvh flex flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-4xl">🎉</p>
        <p className="text-white font-bold" style={{ fontFamily: "'Tajawal',sans-serif" }}>
          جاوبت كل الأسئلة المتاحة في هذا الفرع!
        </p>
        <p className="text-white/30 text-sm" style={{ fontFamily: "'Tajawal',sans-serif" }}>
          هيظهر المزيد لما يتم إضافة أسئلة جديدة
        </p>
        <button
          onClick={() => { setPhase('pick-subject'); setSubjectId(''); setSubject(null); }}
          className="mt-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white"
          style={{ background: 'linear-gradient(135deg,#3b82f6,#8b5cf6)' }}
        >
          رجوع للفروع
        </button>
      </div>
    );
  }

  if (loadingQuestions || !subject) {
    return (
      <div className="relative min-h-dvh flex items-center justify-center">
        <div className="w-8 h-8 rounded-full animate-spin-slow" style={{ border: '3px solid rgba(255,255,255,0.15)', borderTopColor: '#60a5fa' }} />
      </div>
    );
  }

  const isAnswerPhase = phase === 'timer';

  return (
    <div className="relative min-h-dvh flex flex-col pb-28 overflow-hidden">
      <div className="px-4 pt-10 pb-3 flex items-center gap-3">
        <button
          onClick={() => { stopTimer(); setPhase('pick-subject'); setSubjectId(''); setSubject(null); }}
          className="w-9 h-9 rounded-xl flex items-center justify-center glass-md"
          style={{ color: subject.color }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </button>
        <div className="flex-1">
          <p className="text-sm font-bold" style={{ color: subject.color, fontFamily: "'Tajawal',sans-serif" }}>{subject.name}</p>
          {reviewMode ? (
            <p className="text-amber-400/70 text-[11px] font-bold mt-0.5" style={{ fontFamily: "'Tajawal',sans-serif" }}>
              جولة الإعادة بنصف النقاط
            </p>
          ) : (
            <p className="text-white/30 text-xs font-exo">{qIdx + 1} / {questions.length}</p>
          )}
        </div>
        <StreakBadge userId={user.id} size="sm" />
        <div className="flex items-center gap-2">
          <span className="text-green-400 text-sm font-bold font-exo">{sessionScore.correct}</span>
          <span className="text-white/20 text-xs">/</span>
          <span className="text-white/40 text-sm font-exo">{sessionScore.total}</span>
        </div>
        <button
          onClick={() => setShowSidebar(!showSidebar)}
          className="w-9 h-9 rounded-xl flex items-center justify-center glass-md"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
          </svg>
        </button>
      </div>

      <div className="px-4 mb-3">
        <div className="h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
          <div
            className="h-full rounded-full transition-none"
            style={{
              width: `${((qIdx) / questions.length) * 100}%`,
              background: `linear-gradient(90deg,${subject.gradFrom},${subject.gradTo})`,
            }}
          />
        </div>
      </div>

      <div className="px-4 flex-1 flex flex-col gap-4">
        <div className="relative flex flex-col items-center gap-4">
          <div className="relative w-24 h-24 flex items-center justify-center">
            {phase === 'sticker' && activeSticker ? (
              <img 
                src={activeSticker} 
                alt="sticker" 
                className="w-48 h-48 object-contain animate-bounce-subtle"
              />
            ) : (
              <>
                <svg className="absolute inset-0 -rotate-90" width="96" height="96" viewBox="0 0 96 96">
                  <circle className="timer-track" cx="48" cy="48" r="44" strokeWidth="4"/>
                  <circle
                    className="timer-fill"
                    cx="48" cy="48" r="44"
                    strokeWidth="4"
                    stroke={timerColor}
                    strokeDasharray="276.46"
                    strokeDashoffset={276.46 - (timeLeft / timerMax) * 276.46}
                    style={{ filter: `drop-shadow(0 0 6px ${timerColor})` }}
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span
                    className="text-2xl font-black font-exo"
                    style={{ color: timerColor, textShadow: `0 0 10px ${timerColor}` }}
                  >
                    {timeLeft}
                  </span>
                  <span className="text-white/20 text-[10px] font-bold uppercase tracking-widest font-exo">ثانية</span>
                </div>
              </>
            )}
          </div>

          <div className="w-full glass-lg rounded-3xl p-6 text-center relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 opacity-20" style={{ background: `linear-gradient(90deg,transparent,${subject.color},transparent)` }} />
            <p className="text-white text-lg font-bold leading-relaxed" style={{ fontFamily: "'Tajawal',sans-serif" }}>
              {currentQ?.question || 'جاري التحميل...'}
            </p>
          </div>
        </div>

        {isAnswerPhase && (
          <div className="flex flex-col gap-3 animate-slide-up">
            <div className="relative group">
              <input
                ref={inputRef1}
                type="text"
                value={answer1}
                onChange={(e) => setAnswer1(e.target.value)}
                placeholder="الإجابة الأولى..."
                className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-4 text-white placeholder:text-white/20 focus:outline-none focus:border-white/30 transition-all text-right"
                style={{ fontFamily: "'Tajawal',sans-serif" }}
              />
            </div>
            <div className="relative group">
              <input
                ref={inputRef2}
                type="text"
                value={answer2}
                onChange={(e) => setAnswer2(e.target.value)}
                placeholder="الإجابة الثانية (اختياري)..."
                className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-4 text-white placeholder:text-white/20 focus:outline-none focus:border-white/30 transition-all text-right"
                style={{ fontFamily: "'Tajawal',sans-serif" }}
              />
            </div>
            <button
              onClick={handleAnswerButton}
              className="w-full py-4 rounded-2xl font-black text-white shadow-lg transition-all active:scale-[0.98] mt-2"
              style={{ background: `linear-gradient(135deg,${subject.gradFrom},${subject.gradTo})`, fontFamily: "'Tajawal',sans-serif" }}
            >
              تمت الإجابة
            </button>
          </div>
        )}

        {phase === 'reveal' && currentQ && (
          <RevealPanel
            question={currentQ}
            answer1={answer1}
            answer2={answer2}
            onCorrect={handleCorrect}
            onWrong={handleWrong}
          />
        )}
      </div>

      {showSidebar && (
        <QuestionSidebar
          questions={questions}
          currentIdx={qIdx}
          resultHistory={resultHistory}
          subject={subject}
          onSelect={(i) => { jumpToQuestion(i); setShowSidebar(false); }}
          onClose={() => setShowSidebar(false)}
        />
      )}
    </div>
  );
}

function RevealPanel({ question, answer1, answer2, onCorrect, onWrong }: {
  question: Question;
  answer1: string;
  answer2: string;
  onCorrect: (attempt: 1 | 2) => void;
  onWrong: () => void;
}) {
  const [choiceMode, setChoiceMode] = useState(false);

  return (
    <div className="flex flex-col gap-3 animate-slide-up">
      <div className="rounded-2xl p-4" style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.3)' }}>
        <p className="text-green-400/60 text-xs mb-1" style={{ fontFamily: "'Tajawal',sans-serif" }}>الإجابة الصحيحة</p>
        <p className="text-white font-bold text-base" style={{ fontFamily: "'Tajawal',sans-serif" }}>{question.answer}</p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <p className="text-white/30 text-[10px] mb-1 font-exo">إجابتك الأولى</p>
          <p className="text-white text-sm" style={{ fontFamily: "'Tajawal',sans-serif" }}>{answer1 || '—'}</p>
        </div>
        <div className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <p className="text-white/30 text-[10px] mb-1 font-exo">إجابتك الثانية</p>
          <p className="text-white text-sm" style={{ fontFamily: "'Tajawal',sans-serif" }}>{answer2 || '—'}</p>
        </div>
      </div>

      {!choiceMode ? (
        <div className="grid grid-cols-2 gap-3 mt-1">
          <button
            onClick={() => setChoiceMode(true)}
            className="rounded-xl py-3.5 font-bold text-base transition-all duration-200"
            style={{ background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.4)', color: '#34d399', fontFamily: "'Tajawal',sans-serif", boxShadow: '0 0 16px rgba(16,185,129,0.25)' }}
          >
            صح <span className="text-[10px] font-normal align-middle">(صح)</span>
          </button>
          <button
            onClick={onWrong}
            className="rounded-xl py-3.5 font-bold text-base transition-all duration-200"
            style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', color: '#f87171', fontFamily: "'Tajawal',sans-serif", boxShadow: '0 0 16px rgba(239,68,68,0.25)' }}
          >
            غلط
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2 mt-1">
          <p className="text-white/40 text-xs text-center" style={{ fontFamily: "'Tajawal',sans-serif" }}>أي إجابة كانت صحيحة؟</p>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => onCorrect(1)}
              className="rounded-xl py-3 font-bold text-sm"
              style={{ background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.4)', color: '#34d399', fontFamily: "'Tajawal',sans-serif" }}
            >
              الأولى
            </button>
            <button
              onClick={() => onCorrect(2)}
              className="rounded-xl py-3 font-bold text-sm"
              style={{ background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.4)', color: '#34d399', fontFamily: "'Tajawal',sans-serif" }}
            >
              الثانية
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function QuestionSidebar({ questions, currentIdx, resultHistory, subject, onSelect, onClose }: {
  questions: Question[];
  currentIdx: number;
  resultHistory: { qIdx: number; correct: boolean }[];
  subject: Subject;
  onSelect: (i: number) => void;
  onClose: () => void;
}) {
  const resultMap: Record<number, boolean> = {};
  resultHistory.forEach((r) => { resultMap[r.qIdx] = r.correct; });

  return (
    <div
      className="fixed inset-0 z-50 flex"
      onClick={onClose}
    >
      <div className="flex-1" />
      <div
        className="h-full w-72 flex flex-col overflow-hidden animate-slide-up"
        style={{ background: 'rgba(6,9,26,0.97)', backdropFilter: 'blur(24px)', borderRight: `1px solid ${subject.color}20` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 pt-12 pb-4" style={{ borderBottom: `1px solid ${subject.color}15` }}>
          <p className="font-bold text-white text-sm" style={{ fontFamily: "'Tajawal',sans-serif" }}>الأسئلة</p>
          <button onClick={onClose} className="text-white/40 hover:text-white/80">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-2">
          {questions.map((q, i) => {
            const done = i in resultMap;
            const correct = resultMap[i];
            const isCurrent = i === currentIdx;
            return (
              <button
                key={q.id}
                onClick={() => onSelect(i)}
                className="w-full text-right rounded-xl px-3 py-2.5 mb-1.5 flex items-center gap-2.5 transition-all duration-150"
                style={{
                  background: isCurrent ? `${subject.color}15` : done ? (correct ? 'rgba(16,185,129,0.07)' : 'rgba(239,68,68,0.07)') : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${isCurrent ? subject.color + '40' : done ? (correct ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)') : 'rgba(255,255,255,0.06)'}`,
                }}
              >
                <span
                  className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold font-exo"
                  style={{
                    background: done ? (correct ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.25)') : 'rgba(255,255,255,0.06)',
                    color: done ? (correct ? '#34d399' : '#f87171') : 'rgba(255,255,255,0.3)',
                  }}
                >
                  {done ? (correct ? '✓' : '✗') : i + 1}
                </span>
                <span
                  className="flex-1 text-xs text-white/60 truncate"
                  style={{ fontFamily: "'Tajawal',sans-serif" }}
                >
                  {q.question.slice(0, 40)}...
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
