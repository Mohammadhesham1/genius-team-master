import { useEffect, useState } from 'react';
import { getUserStreak, subscribeToStreak, LEVEL_TARGET, type StreakInfo } from '../lib/api/streak';

interface StreakBadgeProps {
  userId: string;
  size?: 'sm' | 'md';
}

const FlameIcon = ({ size, color }: { size: number; color: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
    <path d="M12 2c1 3-3 4-3 8a3 3 0 0 0 6 0c0-1-.5-2-.5-2 1.5.5 2.5 2.5 2.5 4.5A5 5 0 0 1 12 17a5 5 0 0 1-5-5c0-4 3.5-5.5 3-8.5 1 .5 2 1.5 2 1.5z" />
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

export default function StreakBadge({ userId, size = 'md' }: StreakBadgeProps) {
  const [streak, setStreak] = useState<StreakInfo | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      getUserStreak(userId)
        .then((s) => { if (!cancelled) setStreak(s); })
        .catch(() => {});
    };
    load();
    const unsub = subscribeToStreak(userId, load);
    return () => { cancelled = true; unsub(); };
  }, [userId]);

  // Live-ticking countdown to the next 5am reset.
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  if (!streak) return null;

  const isMd = size === 'md';
  const flameColor = streak.atRisk ? '#94a3b8' : '#f59e0b';
  const pct = Math.min(100, (streak.todayCount / streak.target) * 100);

  return (
    <div
      className="inline-flex items-center gap-1.5 rounded-full flex-shrink-0"
      style={{
        padding: isMd ? '5px 10px' : '3px 8px',
        background: streak.atRisk ? 'rgba(148,163,184,0.1)' : 'rgba(245,158,11,0.12)',
        border: `1px solid ${streak.atRisk ? 'rgba(148,163,184,0.25)' : 'rgba(245,158,11,0.3)'}`,
      }}
    >
      <FlameIcon size={isMd ? 15 : 12} color={flameColor} />
      <span
        className="font-black font-exo"
        style={{ fontSize: isMd ? 13 : 11, color: flameColor }}
      >
        ×{streak.multiplier}
      </span>
      {isMd && (
        <div
          className="rounded-full overflow-hidden flex-shrink-0"
          style={{ width: 34, height: 4, background: 'rgba(255,255,255,0.1)' }}
        >
          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: flameColor }} />
        </div>
      )}
      <span
        className="font-exo font-bold"
        style={{ fontSize: isMd ? 10 : 9, color: 'rgba(255,255,255,0.6)' }}
      >
        {streak.todayCount}
      </span>
      <span
        className="font-exo font-bold"
        style={{ fontSize: isMd ? 10 : 9, color: 'rgba(255,255,255,0.3)' }}
      >
        /{LEVEL_TARGET}
      </span>
      <span
        className="font-exo"
        style={{ fontSize: isMd ? 9 : 8, color: 'rgba(255,255,255,0.28)' }}
      >
        {formatCountdown(streak.resetAt - now)}
      </span>
    </div>
  );
}
