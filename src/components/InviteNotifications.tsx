import { useEffect, useState } from 'react';
import type { User, PageName } from '../types';
import {
  getPendingInvitesForUser,
  subscribeToIncomingInvites,
  respondToInvite,
  type PendingInvite,
} from '../lib/api/matches';

interface Props {
  user: User;
  navigate: (page: PageName, params?: Record<string, string>) => void;
}

const MUTE_MS = 15 * 60 * 1000;
const muteKey = (userId: string) => `1v1-invite-mute-until:${userId}`;

/**
 * A 1v1 invite reaching this user shows up as a floating notification no
 * matter which page they're currently on — with Accept / Reject / dismiss
 * (hide this one, still answerable from the "انضمام" list) / mute for 15
 * minutes.
 */
export default function InviteNotifications({ user, navigate }: Props) {
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [mutedUntil, setMutedUntil] = useState<number>(() => {
    const raw = localStorage.getItem(muteKey(user.id));
    return raw ? Number(raw) || 0 : 0;
  });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [, forceTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      getPendingInvitesForUser(user.id).then((list) => { if (!cancelled) setInvites(list); }).catch(() => {});
    };
    refresh();
    const unsub = subscribeToIncomingInvites(user.id, refresh);
    const poll = setInterval(refresh, 5000);
    return () => { cancelled = true; unsub(); clearInterval(poll); };
  }, [user.id]);

  // Re-check the mute countdown once a minute so the banner reappears the
  // moment the 15 minutes are up, without needing a page reload.
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 30000);
    return () => clearInterval(id);
  }, []);

  const muted = Date.now() < mutedUntil;
  const visible = invites.filter((i) => !dismissedIds.has(i.inviteId));
  const current = !muted && visible.length > 0 ? visible[0] : null;

  if (!current) return null;

  const handleAccept = async () => {
    setBusyId(current.inviteId);
    try {
      await respondToInvite(current.inviteId, current.matchId, user.id, current.isRef, true);
      setInvites((prev) => prev.filter((i) => i.inviteId !== current.inviteId));
      navigate('oneonone', { matchId: current.matchId });
    } catch {
      /* leave it in the list so they can retry */
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async () => {
    setBusyId(current.inviteId);
    try {
      await respondToInvite(current.inviteId, current.matchId, user.id, current.isRef, false);
      setInvites((prev) => prev.filter((i) => i.inviteId !== current.inviteId));
    } catch {
      /* leave it in the list so they can retry */
    } finally {
      setBusyId(null);
    }
  };

  const handleDismiss = () => {
    setDismissedIds((prev) => new Set(prev).add(current.inviteId));
  };

  const handleMute = () => {
    const until = Date.now() + MUTE_MS;
    localStorage.setItem(muteKey(user.id), String(until));
    setMutedUntil(until);
  };

  return (
    <div
      className="fixed top-3 left-3 right-3 z-[70] flex justify-center"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <div
        className="w-full max-w-sm rounded-2xl p-4 flex flex-col gap-3"
        style={{
          background: '#0c1024',
          border: '1px solid rgba(239,68,68,0.35)',
          boxShadow: '0 8px 30px rgba(0,0,0,0.5)',
        }}
      >
        <div className="flex items-center justify-between">
          <p className="text-white font-black text-sm" style={{ fontFamily: "'Tajawal',sans-serif" }}>
            دعوة {current.isRef ? 'تحكيم' : 'مباراة'} 1V1
          </p>
          <button onClick={handleDismiss} className="text-white/40 text-xs px-2 py-1">✕</button>
        </div>
        <p className="text-white/70 text-xs" style={{ fontFamily: "'Tajawal',sans-serif" }}>
          {current.creator?.name ?? 'أحد الأعضاء'} دعاك {current.isRef ? 'كحكم' : 'كلاعب'}
          {current.subject ? ` — ${current.subject.name}` : ''}
        </p>
        <div className="flex gap-2">
          <button
            onClick={handleAccept}
            disabled={busyId === current.inviteId}
            className="flex-1 rounded-xl py-2.5 text-sm font-bold text-white disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg,#10b981,#059669)' }}
          >
            قبول
          </button>
          <button
            onClick={handleReject}
            disabled={busyId === current.inviteId}
            className="flex-1 rounded-xl py-2.5 text-sm font-bold text-white disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg,#ef4444,#dc2626)' }}
          >
            رفض
          </button>
        </div>
        <button
          onClick={handleMute}
          className="text-white/40 text-xs text-center"
          style={{ fontFamily: "'Tajawal',sans-serif" }}
        >
          كتم الإشعارات لمدة ١٥ دقيقة
        </button>
      </div>
    </div>
  );
}
