import { useEffect, useState } from 'react';
import { getUserStudyStreak, subscribeToStudyStreak, STUDY_TARGET_SECONDS, type StudyStreakInfo } from '../lib/api/studyStreak';

interface StudyTodayBadgeProps {
  userId: string;
  size?: 'sm' | 'md';
}

const BookIcon = ({ size, color }: { size: number; color: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
  </svg>
);

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

const GREEN = '#34d399';

/**
 * Study streak badge — same shape as StreakBadge (icon, ×multiplier, progress
 * bar, count/target, countdown), just green and reading study minutes
 * instead of solo answers. Multiplier: reach 120 min (2h) in a day to advance
 * it tomorrow (caps ×5); miss a day and it drops back to ×1.
 */
export default function StudyTodayBadge({ userId, size = 'sm' }: StudyTodayBadgeProps) {
  const [streak, setStreak] = useState<StudyStreakInfo | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      getUserStudyStreak(userId)
        .then((s) => { if (!cancelled) setStreak(s); })
        .catch(() => {});
    };
    load();
    const unsub = subscribeToStudyStreak(userId, load);
    return () => { cancelled = true; unsub(); };
  }, [userId]);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  if (!streak) return null;

  const isMd = size === 'md';
  const pct = Math.min(100, (streak.todaySeconds / streak.targetSeconds) * 100);
  const todayMinutes = Math.floor(streak.todaySeconds / 60);
  const targetMinutes = Math.round(streak.targetSeconds / 60);

  return (
    <div
      className="inline-flex items-center gap-1.5 rounded-full flex-shrink-0"
      style={{
        padding: isMd ? '5px 10px' : '3px 8px',
        background: 'rgba(52,211,153,0.1)',
        border: '1px solid rgba(52,211,153,0.28)',
      }}
    >
      <BookIcon size={isMd ? 15 : 12} color={GREEN} />
      <span className="font-black font-exo" style={{ fontSize: isMd ? 13 : 11, color: GREEN }}>
        ×{streak.multiplier}
      </span>
      {isMd && (
        <div className="rounded-full overflow-hidden flex-shrink-0" style={{ width: 34, height: 4, background: 'rgba(255,255,255,0.1)' }}>
          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: GREEN }} />
        </div>
      )}
      <span className="font-exo font-bold" style={{ fontSize: isMd ? 10 : 9, color: 'rgba(255,255,255,0.6)' }}>
        {todayMinutes}
      </span>
      <span className="font-exo font-bold" style={{ fontSize: isMd ? 10 : 9, color: 'rgba(255,255,255,0.3)' }}>
        /{targetMinutes}
      </span>
      <span className="font-exo" style={{ fontSize: isMd ? 9 : 8, color: 'rgba(255,255,255,0.28)' }}>
        {formatCountdown(streak.resetAt - now)}
      </span>
    </div>
  );
}
