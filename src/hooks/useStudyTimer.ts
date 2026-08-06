import { useEffect, useRef, useState } from 'react';

interface UseStudyTimerOptions {
  /** Only ticks while true. */
  enabled: boolean;
  /** Called once per active second (tab visible, not mid-presence-check). */
  onTick: () => void;
  /** Called every ~30s while active, and once more on close/unmount/tab-hide — signal to flush accumulated data. */
  onFlush: () => void;
}

const PRESENCE_MIN_DELAY_MS = 3 * 60 * 1000;
const PRESENCE_MAX_DELAY_MS = 7 * 60 * 1000;
const PRESENCE_TIMEOUT_MS = 20 * 1000;
const FLUSH_INTERVAL_MS = 30 * 1000;

/**
 * A lean "ticker": reports one active second at a time via onTick, and a
 * periodic + final flush signal via onFlush. The caller owns whatever it
 * wants to accumulate per tick (total seconds, per-page seconds, taps, etc).
 *
 * Relies on two signals to decide "active":
 *   1. document.visibilityState — pauses the instant the tab is backgrounded
 *      or the phone screen locks.
 *   2. Randomized presence checks every 3–7 min — a brief "لسه بتذاكر؟" ping
 *      the user must confirm within 20s, so a phone left open on the table
 *      stops earning time/points too.
 */
export function useStudyTimer({ enabled, onTick, onFlush }: UseStudyTimerOptions) {
  const runningRef = useRef(false);
  const awaitingPresenceRef = useRef(false);
  const [presenceCheck, setPresenceCheck] = useState(false);

  const tickIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const flushIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const presenceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextCheckTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onTickRef = useRef(onTick);
  onTickRef.current = onTick;
  const onFlushRef = useRef(onFlush);
  onFlushRef.current = onFlush;
  const scheduleNextCheckRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!enabled) return;

    const isForeground = () => document.visibilityState === 'visible';

    const scheduleNextCheck = () => {
      if (nextCheckTimeoutRef.current) clearTimeout(nextCheckTimeoutRef.current);
      const delay = PRESENCE_MIN_DELAY_MS + Math.random() * (PRESENCE_MAX_DELAY_MS - PRESENCE_MIN_DELAY_MS);
      nextCheckTimeoutRef.current = setTimeout(() => {
        if (!runningRef.current) { scheduleNextCheck(); return; }
        awaitingPresenceRef.current = true;
        setPresenceCheck(true);
        presenceTimeoutRef.current = setTimeout(() => {
          setPresenceCheck(false);
          awaitingPresenceRef.current = false;
          scheduleNextCheck();
        }, PRESENCE_TIMEOUT_MS);
      }, delay);
    };
    scheduleNextCheckRef.current = scheduleNextCheck;

    const syncRunning = () => {
      if (awaitingPresenceRef.current) { runningRef.current = false; return; }
      runningRef.current = isForeground();
      if (!runningRef.current) onFlushRef.current();
    };

    runningRef.current = isForeground();
    scheduleNextCheck();

    tickIntervalRef.current = setInterval(() => {
      if (runningRef.current) onTickRef.current();
    }, 1000);
    flushIntervalRef.current = setInterval(() => onFlushRef.current(), FLUSH_INTERVAL_MS);

    document.addEventListener('visibilitychange', syncRunning);
    window.addEventListener('pagehide', onFlushRef.current);
    window.addEventListener('beforeunload', onFlushRef.current);

    return () => {
      document.removeEventListener('visibilitychange', syncRunning);
      window.removeEventListener('pagehide', onFlushRef.current);
      window.removeEventListener('beforeunload', onFlushRef.current);
      if (tickIntervalRef.current) clearInterval(tickIntervalRef.current);
      if (flushIntervalRef.current) clearInterval(flushIntervalRef.current);
      if (presenceTimeoutRef.current) clearTimeout(presenceTimeoutRef.current);
      if (nextCheckTimeoutRef.current) clearTimeout(nextCheckTimeoutRef.current);
      onFlushRef.current();
    };
  }, [enabled]);

  const confirmPresence = () => {
    if (presenceTimeoutRef.current) clearTimeout(presenceTimeoutRef.current);
    awaitingPresenceRef.current = false;
    runningRef.current = document.visibilityState === 'visible';
    setPresenceCheck(false);
    scheduleNextCheckRef.current();
  };

  return { presenceCheck, confirmPresence };
}
