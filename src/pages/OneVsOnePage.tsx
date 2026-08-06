import { useState, useEffect, useRef } from 'react';
import type { User, PageName, Subject } from '../types';
import { UserAvatar } from '../components/UserIcons';
import { getAllSubjects } from '../lib/api/subjects';
import { getAllUsers, getOnlineUserIds } from '../lib/auth';
import {
  createMatch,
  sendInvites as sendMatchInvites,
  getMatchInvites,
  cancelInvite,
  cancelMatch,
  getPendingInvitesForUser,
  respondToInvite,
  getMatch,
  startMatch,
  setOwnMatchRole,
  withdrawFromMatch,
  subscribeToMatchInvites,
  subscribeToIncomingInvites,
  subscribeToMatchRoom,
  type InviteWithUser,
  type PendingInvite,
} from '../lib/api/matches';
import MatchPlayPage from './MatchPlayPage';

interface OneVsOnePageProps {
  user: User;
  navigate: (page: PageName, params?: Record<string, string>) => void;
  registerLeaveGuard?: (
    fn: ((target: { page: PageName; params?: Record<string, string> }, proceed: () => void) => void) | null
  ) => void;
  /** Set when arriving here right after accepting an invite notification from
   * elsewhere in the app — jumps straight into that match's lobby instead of
   * the menu. */
  openMatchId?: string;
  /** Called whenever the locally-tracked matchId changes, so App.tsx can keep
   * it in the persisted route and restore straight into this match after a
   * page refresh — not just when arriving via an invite notification. */
  onMatchIdChange?: (matchId: string) => void;
}

type Step = 'menu' | 'create-subject' | 'create-players' | 'lobby' | 'join' | 'waiting-start' | 'play';

export default function OneVsOnePage({ user, navigate: _navigate, registerLeaveGuard, openMatchId, onMatchIdChange }: OneVsOnePageProps) {
  const [step, setStep] = useState<Step>('menu');
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [otherUsers, setOtherUsers] = useState<User[]>([]);
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set());
  const [pendingCount, setPendingCount] = useState(0);

  const [selectedSubjectId, setSelectedSubjectId] = useState('');
  const [selectedPlayers, setSelectedPlayers] = useState<string[]>([]);
  const [refUserId, setRefUserId] = useState('');
  const [selfIsRef, setSelfIsRef] = useState(false);
  const [sendingInvites, setSendingInvites] = useState(false);

  const [matchId, setMatchId] = useState('');
  const [invites, setInvites] = useState<InviteWithUser[]>([]);
  const [cancelTimers, setCancelTimers] = useState<Record<string, ReturnType<typeof setTimeout>>>({});
  const [starting, setStarting] = useState(false);

  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [loadingInvites, setLoadingInvites] = useState(false);
  const [respondingId, setRespondingId] = useState<string | null>(null);

  const [leaveConfirm, setLeaveConfirm] = useState<null | { role: 'host' | 'guest'; proceed: () => void }>(null);
  const [hostCancelledRound, setHostCancelledRound] = useState(false);

  const mountedRef = useRef(true);
  const cancelTimersRef = useRef(cancelTimers);
  cancelTimersRef.current = cancelTimers;
  useEffect(() => () => {
    mountedRef.current = false;
    Object.values(cancelTimersRef.current).forEach(clearTimeout);
  }, []);

  useEffect(() => { onMatchIdChange?.(matchId); }, [matchId, onMatchIdChange]);

  // Base data needed across steps.
  useEffect(() => {
    getAllSubjects().then(setSubjects).catch(() => setSubjects([]));
    getAllUsers()
      .then((all) => setOtherUsers(all.filter((u) => u.id !== user.id)))
      .catch(() => setOtherUsers([]));
  }, [user.id]);

  // Arrived here right after accepting an invite notification elsewhere in
  // the app (or after a refresh restored a matchId we were already part of)
  // — jump straight to the right screen instead of the menu. The host of the
  // match always belongs in their own lobby (with the invite/joined-players
  // view), never in the guest-only "waiting for host" screen.
  const openedMatchRef = useRef<string | null>(null);
  useEffect(() => {
    if (!openMatchId || openedMatchRef.current === openMatchId) return;
    openedMatchRef.current = openMatchId;
    getMatch(openMatchId).then((m) => {
      if (!m) return;
      setMatchId(openMatchId);
      setSelectedSubjectId(m.subjectId ?? '');
      setHostCancelledRound(false);
      const isHost = m.creatorId === user.id;
      setStep(m.status === 'active' ? 'play' : isHost ? 'lobby' : 'waiting-start');
    }).catch(() => {});
  }, [openMatchId, user.id]);

  useEffect(() => {
    if (step !== 'create-players') return;
    getOnlineUserIds().then(setOnlineIds).catch(() => {});
  }, [step]);

  useEffect(() => {
    if (step !== 'menu') return;
    getPendingInvitesForUser(user.id).then((list) => setPendingCount(list.length)).catch(() => {});
  }, [step, user.id]);

  // Lobby: keep invite statuses live.
  useEffect(() => {
    if (step !== 'lobby' || !matchId) return;
    let cancelled = false;
    const refresh = () => {
      getMatchInvites(matchId).then((list) => { if (!cancelled) setInvites(list); }).catch(() => {});
    };
    refresh();
    const unsub = subscribeToMatchInvites(matchId, refresh);
    const poll = setInterval(refresh, 4000);
    return () => { cancelled = true; unsub(); clearInterval(poll); };
  }, [step, matchId]);

  // Join: live list of invites waiting on this user.
  useEffect(() => {
    if (step !== 'join') return;
    let cancelled = false;
    setLoadingInvites(true);
    const refresh = () => {
      getPendingInvitesForUser(user.id)
        .then((list) => { if (!cancelled) setPendingInvites(list); })
        .catch(() => {})
        .finally(() => { if (!cancelled) setLoadingInvites(false); });
    };
    refresh();
    const unsub = subscribeToIncomingInvites(user.id, refresh);
    const poll = setInterval(refresh, 4000);
    return () => { cancelled = true; unsub(); clearInterval(poll); };
  }, [step, user.id]);

  // Waiting for the host to press start. Realtime pushes updates instantly,
  // but a dropped/backgrounded connection shouldn't be able to strand
  // someone here forever — poll as a fallback, and force a fresh check the
  // moment the tab/network comes back.
  useEffect(() => {
    if (step !== 'waiting-start' || !matchId) return;
    let cancelled = false;
    const check = () => {
      getMatch(matchId).then((m) => {
        if (cancelled || !m) return;
        if (m.status === 'active') setStep('play');
        else if (m.status === 'cancelled') setHostCancelledRound(true);
      }).catch(() => {});
    };
    check();
    const unsub = subscribeToMatchRoom(matchId, check);
    const poll = setInterval(check, 3000);
    const onFocus = () => check();
    window.addEventListener('online', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      cancelled = true;
      unsub();
      clearInterval(poll);
      window.removeEventListener('online', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [step, matchId]);

  // Let the app shell (bottom nav) ask for confirmation before leaving a
  // round that's already in motion — hosting a lobby, or waiting on one as
  // a joined player/referee — instead of silently abandoning it.
  useEffect(() => {
    if (!registerLeaveGuard) return;
    registerLeaveGuard((_target, proceed) => {
      if (step === 'lobby') {
        setLeaveConfirm({ role: 'host', proceed });
      } else if (step === 'waiting-start') {
        setLeaveConfirm({ role: 'guest', proceed });
      } else {
        proceed();
      }
    });
    return () => registerLeaveGuard(null);
  }, [step, registerLeaveGuard]);

  // A referee is already secured for this match if an earlier batch of
  // invites already has one pending or accepted — adding more players
  // shouldn't force picking (and inviting) a second one.
  const hasExistingRef = invites.some((r) => r.isRef && (r.status === 'pending' || r.status === 'accepted'));

  const handleSendInvites = async () => {
    if (selectedPlayers.length === 0 || (!refUserId && !hasExistingRef && !selfIsRef)) return;
    setSendingInvites(true);
    try {
      const targetMatchId = matchId || (await createMatch(selectedSubjectId, user.id));
      if (selfIsRef) {
        await setOwnMatchRole(targetMatchId, user.id, 'referee');
      }
      await sendMatchInvites(targetMatchId, selectedPlayers, selfIsRef ? null : refUserId || null);
      setMatchId(targetMatchId);
      setStarting(false);
      setStep('lobby');
    } catch {
      /* stay on this screen so they can retry */
    } finally {
      setSendingInvites(false);
    }
  };

  const confirmLeaveYes = async () => {
    if (!leaveConfirm) return;
    const { role, proceed } = leaveConfirm;
    setLeaveConfirm(null);
    try {
      if (matchId) {
        if (role === 'host') {
          await cancelMatch(matchId);
        } else {
          await withdrawFromMatch(matchId, user.id);
        }
      }
    } catch {
      /* don't trap the user behind a failed cleanup call */
    }
    setMatchId('');
    setInvites([]);
    setSelectedSubjectId('');
    setSelectedPlayers([]);
    setRefUserId('');
    setSelfIsRef(false);
    setHostCancelledRound(false);
    setStarting(false);
    setStep('menu');
    proceed();
  };

  const confirmLeaveNo = () => setLeaveConfirm(null);

  const handleBackArrow = () => {
    if (step === 'lobby') {
      setLeaveConfirm({ role: 'host', proceed: () => {} });
      return;
    }
    if (step === 'waiting-start') {
      setLeaveConfirm({ role: 'guest', proceed: () => {} });
      return;
    }
    setStep(step === 'create-players' ? 'create-subject' : 'menu');
  };

  const cancelRequest = (inviteId: string) => {
    const timer = setTimeout(() => {
      cancelInvite(inviteId).catch(() => {});
      if (mountedRef.current) {
        setInvites((prev) => prev.filter((r) => r.id !== inviteId));
        setCancelTimers((prev) => { const n = { ...prev }; delete n[inviteId]; return n; });
      }
    }, 5000);
    setCancelTimers((prev) => ({ ...prev, [inviteId]: timer }));
  };

  const undoCancel = (inviteId: string) => {
    if (cancelTimers[inviteId]) {
      clearTimeout(cancelTimers[inviteId]);
      setCancelTimers((prev) => { const n = { ...prev }; delete n[inviteId]; return n; });
    }
  };

  const inviteAnother = () => {
    setSelectedPlayers([]);
    setRefUserId('');
    setStep('create-players');
  };

  const handleStartMatch = async () => {
    setStarting(true);
    try {
      await startMatch(matchId, selectedSubjectId);
      setStep('play');
    } catch {
      setStarting(false);
    }
  };

  const handleAcceptInvite = async (inv: PendingInvite) => {
    setRespondingId(inv.inviteId);
    try {
      await respondToInvite(inv.inviteId, inv.matchId, user.id, inv.isRef, true);
      setMatchId(inv.matchId);
      setSelectedSubjectId(inv.subject?.id ?? '');
      setHostCancelledRound(false);
      setStep(inv.matchStatus === 'active' ? 'play' : 'waiting-start');
    } catch {
      /* keep them on the join screen */
    } finally {
      setRespondingId(null);
    }
  };

  const handleRejectInvite = async (inv: PendingInvite) => {
    setRespondingId(inv.inviteId);
    try {
      await respondToInvite(inv.inviteId, inv.matchId, user.id, inv.isRef, false);
      setPendingInvites((prev) => prev.filter((p) => p.inviteId !== inv.inviteId));
    } catch {
      /* noop */
    } finally {
      setRespondingId(null);
    }
  };

  const resetToMenu = () => {
    // Leaving a lobby that never started shouldn't leave a dangling match
    // and pending invites behind for the other side to sit on forever.
    if (step === 'lobby' && matchId) {
      cancelMatch(matchId).catch(() => {});
    }
    setStep('menu');
    setMatchId('');
    setInvites([]);
    setSelectedSubjectId('');
    setSelectedPlayers([]);
    setRefUserId('');
    setSelfIsRef(false);
    setHostCancelledRound(false);
    setStarting(false);
  };

  // A real 1v1 needs at least one accepted opponent *in addition to* the
  // referee — counting the referee's own acceptance toward this used to let
  // the host start a "match" against nobody.
  const acceptedPlayers = invites.filter((r) => r.status === 'accepted' && !r.isRef).length;
  const hasRef = selfIsRef || invites.some((r) => r.isRef && r.status === 'accepted');
  const canStart = acceptedPlayers >= 1 && hasRef;

  if (step === 'play' && matchId) {
    return (
      <MatchPlayPage
        matchId={matchId}
        subjectId={selectedSubjectId}
        user={user}
        onExit={resetToMenu}
      />
    );
  }

  return (
    <div className="relative min-h-dvh flex flex-col pb-28 overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-12 pb-4 flex items-center gap-3">
        {step !== 'menu' && (
          <button
            onClick={handleBackArrow}
            className="w-9 h-9 rounded-xl flex items-center justify-center glass-md"
            style={{ color: '#ef4444' }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </button>
        )}
        <div>
          <h1 className="text-2xl font-black gradient-text" style={{ fontFamily: "'Tajawal',sans-serif" }}>
            {step === 'menu' ? <span dir="ltr" style={{ unicodeBidi: 'isolate' }}>1V1</span>
              : step === 'create-subject' ? 'اختر الفرع'
              : step === 'create-players' ? 'اختر اللاعبين'
              : step === 'lobby' ? 'اللوبي'
              : step === 'waiting-start' ? 'اللوبي'
              : 'الانضمام لمباراة'}
          </h1>
        </div>
      </div>

      <div className="px-4 flex-1 overflow-y-auto">
        {/* ── Menu ── */}
        {step === 'menu' && (
          <div className="flex flex-col gap-4 mt-4">
            <MenuCard
              title="إنشاء مباراة"
              subtitle="ادعُ لاعبين وابدأ جولة"
              color="#ef4444"
              icon={<SwordsIcon />}
              onClick={() => setStep('create-subject')}
            />
            <MenuCard
              title="الانضمام لمباراة"
              subtitle={pendingCount > 0 ? `${pendingCount} دعوة في الانتظار` : 'دعوات الانتظار'}
              color="#3b82f6"
              icon={<JoinIcon />}
              onClick={() => setStep('join')}
            />
          </div>
        )}

        {/* ── Choose subject ── */}
        {step === 'create-subject' && (
          <div className="grid grid-cols-2 gap-3 mt-2">
            {subjects.map((s) => (
              <button
                key={s.id}
                onClick={() => { setSelectedSubjectId(s.id); setStep('create-players'); }}
                className="rounded-2xl p-4 text-right transition-all duration-200"
                style={{
                  background: `${s.color}15`,
                  border: `1px solid ${s.color}30`,
                  boxShadow: selectedSubjectId === s.id ? `0 0 20px ${s.glow}` : 'none',
                }}
              >
                <p className="font-bold text-white text-sm" style={{ fontFamily: "'Tajawal',sans-serif" }}>{s.name}</p>
              </button>
            ))}
          </div>
        )}

        {/* ── Choose players ── */}
        {step === 'create-players' && (
          <div className="flex flex-col gap-3 mt-2">
            <div className="glass-md rounded-2xl p-3 mb-1">
              <p className="text-white/40 text-xs text-center" style={{ fontFamily: "'Tajawal',sans-serif" }}>
                اختر لاعبين وحدد حكماً واحداً
              </p>
            </div>

            {!hasExistingRef && (
              <button
                onClick={() => { setSelfIsRef((v) => !v); if (!selfIsRef) setRefUserId(''); }}
                className="glass-md rounded-2xl p-3 flex items-center gap-3 transition-all duration-200"
                style={{
                  border: `1px solid ${selfIsRef ? '#f59e0b50' : 'rgba(255,255,255,0.08)'}`,
                  boxShadow: selfIsRef ? '0 0 14px rgba(245,158,11,0.3)' : 'none',
                }}
              >
                <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: user.gradient }}>
                  <UserAvatar userId={user.id} name={user.name} />
                </div>
                <div className="flex-1 text-right">
                  <p className="font-bold text-white text-sm" style={{ fontFamily: "'Tajawal',sans-serif" }}>{user.name} (أنت)</p>
                  <p className="text-xs" style={{ color: selfIsRef ? '#f59e0b' : 'rgba(255,255,255,0.35)' }}>
                    {selfIsRef ? 'ستكون الحكم' : 'اجعلني الحكم بدل دعوة أحد'}
                  </p>
                </div>
                <span
                  className="text-xs px-2 py-1 rounded-lg"
                  style={{
                    background: selfIsRef ? '#f59e0b20' : 'rgba(255,255,255,0.05)',
                    border: `1px solid ${selfIsRef ? '#f59e0b50' : 'rgba(255,255,255,0.10)'}`,
                    color: selfIsRef ? '#f59e0b' : 'rgba(255,255,255,0.4)',
                    fontFamily: "'Tajawal',sans-serif",
                  }}
                >
                  {selfIsRef ? 'الحكم' : 'حكم؟'}
                </span>
              </button>
            )}

            {otherUsers.map((u) => {
              const isSelected = selectedPlayers.includes(u.id);
              const isOnline = onlineIds.has(u.id);
              const isRef = refUserId === u.id;
              return (
                <div
                  key={u.id}
                  className="glass-md rounded-2xl p-3 flex items-center gap-3 transition-all duration-200"
                  style={{
                    border: `1px solid ${isSelected ? u.color + '50' : 'rgba(255,255,255,0.08)'}`,
                    boxShadow: isSelected ? `0 0 14px ${u.color}30` : 'none',
                  }}
                >
                  {/* Avatar */}
                  <div className="relative flex-shrink-0">
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center"
                      style={{ background: u.gradient, boxShadow: `0 0 10px ${u.color}40` }}
                    >
                      <UserAvatar userId={u.id} name={u.name} />
                    </div>
                    {isOnline && (
                      <span
                        className="absolute -bottom-0.5 -left-0.5 w-3 h-3 rounded-full border-2"
                        style={{ background: '#22c55e', borderColor: '#06091a' }}
                      />
                    )}
                  </div>

                  <div className="flex-1">
                    <p className="font-bold text-white text-sm" style={{ fontFamily: "'Tajawal',sans-serif" }}>{u.name}</p>
                    <p className="text-xs" style={{ color: isOnline ? '#22c55e' : 'rgba(255,255,255,0.3)' }}>
                      {isOnline ? 'متصل' : 'غير متصل'}
                    </p>
                  </div>

                  {/* Ref badge */}
                  {isSelected && (
                    <button
                      onClick={() => { setRefUserId(isRef ? '' : u.id); if (!isRef) setSelfIsRef(false); }}
                      className="text-xs px-2 py-1 rounded-lg transition-all duration-200"
                      style={{
                        background: isRef ? '#f59e0b20' : 'rgba(255,255,255,0.05)',
                        border: `1px solid ${isRef ? '#f59e0b50' : 'rgba(255,255,255,0.10)'}`,
                        color: isRef ? '#f59e0b' : 'rgba(255,255,255,0.4)',
                        fontFamily: "'Tajawal',sans-serif",
                      }}
                    >
                      {isRef ? 'الحكم' : 'حكم؟'}
                    </button>
                  )}

                  {/* Select toggle */}
                  <button
                    onClick={() => {
                      setSelectedPlayers((prev) =>
                        prev.includes(u.id) ? prev.filter((id) => id !== u.id) : [...prev, u.id]
                      );
                      if (isRef) setRefUserId('');
                    }}
                    className="w-7 h-7 rounded-lg flex items-center justify-center transition-all duration-200"
                    style={{
                      background: isSelected ? `${u.color}30` : 'rgba(255,255,255,0.05)',
                      border: `1px solid ${isSelected ? u.color : 'rgba(255,255,255,0.12)'}`,
                      color: isSelected ? u.color : 'rgba(255,255,255,0.3)',
                    }}
                  >
                    {isSelected ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    )}
                  </button>
                </div>
              );
            })}

            {selectedPlayers.length > 0 && (refUserId || hasExistingRef || selfIsRef) && (
              <button
                onClick={handleSendInvites}
                disabled={sendingInvites}
                className="w-full rounded-2xl py-4 font-black text-white text-lg mt-2 transition-all duration-300 disabled:opacity-50"
                style={{
                  background: 'linear-gradient(135deg,#ef4444,#f97316)',
                  boxShadow: '0 0 28px rgba(239,68,68,0.5)',
                  fontFamily: "'Tajawal',sans-serif",
                }}
              >
                {sendingInvites ? '...جاري الإرسال' : 'ارسل الدعوات'}
              </button>
            )}
            {selectedPlayers.length > 0 && !refUserId && !hasExistingRef && !selfIsRef && (
              <p className="text-amber-400/70 text-xs text-center" style={{ fontFamily: "'Tajawal',sans-serif" }}>
                اختر حكماً من اللاعبين المدعوين
              </p>
            )}
          </div>
        )}

        {/* ── Lobby ── */}
        {step === 'lobby' && (
          <div className="flex flex-col gap-4 mt-2">
            {/* Circle of participants */}
            <LobbyCircle user={user} invites={invites} hostIsRef={selfIsRef} />

            {/* Request cards */}
            <div className="flex flex-col gap-3">
              {invites.map((inv) => {
                const isCancelling = !!cancelTimers[inv.id];
                return (
                  <RequestCard
                    key={inv.id}
                    invite={inv}
                    isCancelling={isCancelling}
                    onCancel={() => cancelRequest(inv.id)}
                    onUndo={() => undoCancel(inv.id)}
                  />
                );
              })}
            </div>

            {/* Invite more */}
            <button
              onClick={inviteAnother}
              className="w-full rounded-xl py-3 text-sm font-bold glass-md transition-all duration-200 hover:bg-white/10"
              style={{ color: '#3b82f6', border: '1px solid rgba(59,130,246,0.3)', fontFamily: "'Tajawal',sans-serif" }}
            >
              + دعوة لاعب آخر
            </button>

            {canStart ? (
              <button
                onClick={handleStartMatch}
                disabled={starting}
                className="w-full rounded-2xl py-4 font-black text-white text-lg mt-1 disabled:opacity-60"
                style={{ background: 'linear-gradient(135deg,#10b981,#06b6d4)', boxShadow: '0 0 28px rgba(16,185,129,0.5)', fontFamily: "'Tajawal',sans-serif" }}
              >
                {starting ? '...جاري البدء' : 'ابدأ المباراة'}
              </button>
            ) : (
              <p className="text-white/25 text-xs text-center mt-1" style={{ fontFamily: "'Tajawal',sans-serif" }}>
                {!hasRef ? 'في انتظار قبول الحكم' : 'في انتظار قبول لاعب على الأقل'}
              </p>
            )}
          </div>
        )}

        {/* ── Waiting for host to start ── */}
        {step === 'waiting-start' && (
          hostCancelledRound ? (
            <div className="flex flex-col items-center gap-4 mt-10">
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center"
                style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)' }}
              >
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </div>
              <p className="text-red-400 text-sm text-center font-bold" style={{ fontFamily: "'Tajawal',sans-serif" }}>
                المضيف ألغى الجولة
              </p>
              <button
                onClick={resetToMenu}
                className="rounded-xl px-6 py-3 text-sm font-bold glass-md"
                style={{ color: '#3b82f6', border: '1px solid rgba(59,130,246,0.3)', fontFamily: "'Tajawal',sans-serif" }}
              >
                رجوع
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4 mt-10">
              <div
                className="w-8 h-8 rounded-full animate-spin-slow"
                style={{ border: '3px solid rgba(255,255,255,0.15)', borderTopColor: '#60a5fa' }}
              />
              <p className="text-white/50 text-sm text-center" style={{ fontFamily: "'Tajawal',sans-serif" }}>
                تم قبول الدعوة — في انتظار بدء المباراة من المضيف
              </p>
            </div>
          )
        )}

        {/* ── Join ── */}
        {step === 'join' && (
          <div className="flex flex-col gap-3 mt-4">
            {loadingInvites ? (
              <div className="flex flex-col items-center gap-3 py-10">
                <div className="w-8 h-8 rounded-full animate-spin-slow" style={{ border: '3px solid rgba(255,255,255,0.15)', borderTopColor: '#60a5fa' }} />
              </div>
            ) : pendingInvites.length === 0 ? (
              <div className="flex flex-col items-center gap-4 mt-6">
                <div
                  className="w-20 h-20 rounded-2xl flex items-center justify-center"
                  style={{ background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.25)' }}
                >
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="rgba(96,165,250,0.6)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                    <circle cx="9" cy="7" r="4"/>
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                    <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                  </svg>
                </div>
                <p className="text-white/40 text-center text-sm" style={{ fontFamily: "'Tajawal',sans-serif" }}>
                  لا توجد دعوات في انتظارك حالياً
                </p>
              </div>
            ) : (
              pendingInvites.map((inv) => (
                <div
                  key={inv.inviteId}
                  className="glass-md rounded-2xl p-4 flex items-center gap-3"
                  style={{ border: `1px solid ${inv.subject ? inv.subject.color + '30' : 'rgba(255,255,255,0.1)'}` }}
                >
                  <div
                    className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: inv.creator?.gradient ?? 'linear-gradient(135deg,#3b82f6,#8b5cf6)' }}
                  >
                    {inv.creator ? <UserAvatar userId={inv.creator.id} name={inv.creator.name} /> : '?' }
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-white text-sm" style={{ fontFamily: "'Tajawal',sans-serif" }}>
                      {inv.creator?.name ?? 'عضو'} يدعوك
                      {inv.isRef && <span className="text-amber-400 text-xs mr-1.5">• كحكم</span>}
                    </p>
                    <p className="text-xs" style={{ color: inv.subject?.color ?? 'rgba(255,255,255,0.4)' }}>
                      {inv.subject?.name ?? 'فرع غير معروف'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => handleAcceptInvite(inv)}
                      disabled={respondingId === inv.inviteId}
                      className="w-9 h-9 rounded-xl flex items-center justify-center disabled:opacity-50"
                      style={{ background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.4)', color: '#34d399' }}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    </button>
                    <button
                      onClick={() => handleRejectInvite(inv)}
                      disabled={respondingId === inv.inviteId}
                      className="w-9 h-9 rounded-xl flex items-center justify-center disabled:opacity-50"
                      style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', color: '#f87171' }}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {leaveConfirm && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center px-6"
          style={{ background: 'rgba(0,0,0,0.65)' }}
        >
          <div
            className="w-full max-w-sm rounded-2xl p-5"
            style={{ background: '#0c1024', border: '1px solid rgba(255,255,255,0.1)' }}
          >
            <p className="text-white font-black text-center mb-5 text-lg" style={{ fontFamily: "'Tajawal',sans-serif" }}>
              {leaveConfirm.role === 'host' ? 'هل تريد إنهاء الجولة؟' : 'هل تريد الانسحاب؟'}
            </p>
            <div className="flex gap-3">
              <button
                onClick={confirmLeaveYes}
                className="flex-1 rounded-xl py-3 font-bold text-white"
                style={{ background: 'linear-gradient(135deg,#ef4444,#f97316)', fontFamily: "'Tajawal',sans-serif" }}
              >
                نعم
              </button>
              <button
                onClick={confirmLeaveNo}
                className="flex-1 rounded-xl py-3 font-bold"
                style={{ background: 'rgba(255,255,255,0.08)', color: 'white', fontFamily: "'Tajawal',sans-serif" }}
              >
                لا
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Lobby Circle ───────────────────────────────────────────────────────────
function LobbyCircle({ user, invites, hostIsRef }: { user: User; invites: InviteWithUser[]; hostIsRef?: boolean }) {
  const total = invites.length + 1;
  const r = 68;
  const cx = 110;
  const cy = 110;

  const positions = Array.from({ length: total }).map((_, i) => {
    const angle = (i / total) * 2 * Math.PI - Math.PI / 2;
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  });

  return (
    <div
      className="rounded-2xl flex flex-col items-center py-5"
      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
    >
      <p className="text-white/40 text-xs mb-3" style={{ fontFamily: "'Tajawal',sans-serif" }}>حلقة المباراة</p>
      <div className="relative" style={{ width: 220, height: 220 }}>
        <svg className="absolute inset-0" width="220" height="220">
          {positions.map((pos, i) =>
            positions.slice(i + 1).map((pos2, j) => (
              <line key={`${i}-${j}`} x1={pos.x} y1={pos.y} x2={pos2.x} y2={pos2.y} stroke="rgba(255,255,255,0.06)" strokeWidth="1"/>
            ))
          )}
          <circle cx={cx} cy={cy} r={r + 16} stroke="rgba(59,130,246,0.08)" strokeWidth="1" fill="none" strokeDasharray="4 6"/>
        </svg>

        <AvatarDot user={user} pos={positions[0]} accepted isRef={hostIsRef} />

        {invites.map((inv, i) => (
          <AvatarDot key={inv.id} user={inv.toUser} pos={positions[i + 1]} accepted={inv.status === 'accepted'} isRef={inv.isRef} />
        ))}
      </div>
    </div>
  );
}

function AvatarDot({ user, pos, accepted, isRef }: { user: User; pos: { x: number; y: number }; accepted: boolean; isRef?: boolean }) {
  return (
    <div className="absolute flex flex-col items-center" style={{ left: pos.x - 20, top: pos.y - 20, width: 40 }}>
      <div
        className="w-10 h-10 rounded-full flex items-center justify-center relative"
        style={{
          background: accepted ? user.gradient : 'rgba(255,255,255,0.06)',
          border: `2px solid ${accepted ? user.color : 'rgba(255,255,255,0.15)'}`,
          boxShadow: accepted ? `0 0 12px ${user.color}60` : 'none',
          color: accepted ? 'white' : 'rgba(255,255,255,0.3)',
          transition: 'all 0.5s ease',
        }}
      >
        {accepted ? <UserAvatar userId={user.id} name={user.name} /> : '?' }
        {isRef && accepted && (
          <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-amber-400 flex items-center justify-center">
            <svg width="8" height="8" viewBox="0 0 24 24" fill="white" stroke="none"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
          </span>
        )}
      </div>
      <p className="text-white/40 text-[9px] mt-1 text-center" style={{ fontFamily: "'Tajawal',sans-serif", maxWidth: 42, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {user.name}
      </p>
    </div>
  );
}

// ── Request Card ───────────────────────────────────────────────────────────
function RequestCard({ invite, isCancelling, onCancel, onUndo }: {
  invite: InviteWithUser;
  isCancelling: boolean;
  onCancel: () => void;
  onUndo: () => void;
}) {
  const effectiveStatus = isCancelling ? 'rejected' : invite.status;
  const statusColor =
    effectiveStatus === 'accepted' ? '#22c55e' :
    effectiveStatus === 'rejected' || effectiveStatus === 'cancelled' ? '#ef4444' : '#f59e0b';
  const statusLabel =
    effectiveStatus === 'accepted' ? 'قبل' :
    effectiveStatus === 'rejected' ? 'رفض' :
    effectiveStatus === 'cancelled' ? 'ملغى' : 'في الانتظار';

  return (
    <div
      className="rounded-2xl overflow-hidden transition-all duration-300"
      style={{ background: `${invite.toUser.color}0d`, border: `1px solid ${invite.toUser.color}25`, opacity: isCancelling ? 0.6 : 1 }}
    >
      <div className="flex items-center gap-3 p-3">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: invite.toUser.gradient }}
        >
          <UserAvatar userId={invite.toUser.id} name={invite.toUser.name} />
        </div>
        <div className="flex-1">
          <p className="font-bold text-white text-sm" style={{ fontFamily: "'Tajawal',sans-serif" }}>
            {invite.toUser.name}
            {invite.isRef && <span className="text-amber-400 text-xs mr-1.5">• حكم</span>}
          </p>
          <p className="text-xs font-medium mt-0.5" style={{ color: statusColor }}>{statusLabel}</p>
        </div>
        {invite.status === 'pending' && !isCancelling && (
          <button
            onClick={onCancel}
            className="text-xs px-3 py-1.5 rounded-lg transition-colors"
            style={{ background: 'rgba(239,68,68,0.12)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.25)', fontFamily: "'Tajawal',sans-serif" }}
          >
            إلغاء
          </button>
        )}
        {invite.status === 'accepted' && (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        )}
      </div>

      {isCancelling && (
        <div className="px-3 pb-3 flex items-center gap-3">
          <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
            <div className="h-full rounded-full" style={{ background: '#ef4444', animation: 'undoDrain 5s linear forwards', width: '100%' }}/>
          </div>
          <button
            onClick={onUndo}
            className="text-xs px-2 py-1 rounded-lg"
            style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.7)', fontFamily: "'Tajawal',sans-serif" }}
          >
            تراجع
          </button>
        </div>
      )}
    </div>
  );
}

// ── Menu Card ──────────────────────────────────────────────────────────────
function MenuCard({ title, subtitle, color, icon, onClick }: {
  title: string; subtitle: string; color: string; icon: React.ReactNode; onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="relative rounded-2xl overflow-hidden text-right transition-all duration-300 p-5"
      style={{
        background: `${color}12`,
        border: `1px solid ${color}30`,
        boxShadow: hovered ? `0 8px 28px ${color}40` : `0 2px 12px ${color}15`,
        transform: hovered ? 'translateY(-2px)' : 'translateY(0)',
      }}
    >
      <div className="absolute top-0 left-0 right-0 h-px" style={{ background: `linear-gradient(90deg,transparent,${color}80,transparent)` }}/>
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: `${color}20`, color, border: `1px solid ${color}30`, boxShadow: hovered ? `0 0 16px ${color}40` : 'none' }}>
          {icon}
        </div>
        <div>
          <p className="text-lg font-black text-white" style={{ fontFamily: "'Tajawal',sans-serif" }}>{title}</p>
          <p className="text-sm text-white/40" style={{ fontFamily: "'Tajawal',sans-serif" }}>{subtitle}</p>
        </div>
      </div>
    </button>
  );
}

function SwordsIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.5 2l7.5 7.5-9 9L5 11l9-9z"/>
      <path d="M2 22l5-5M6 15l-4 4M15 8l1 1"/>
      <path d="M14 10l-8 8 2 2 8-8"/>
    </svg>
  );
}
function JoinIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
      <polyline points="10 17 15 12 10 7"/>
      <line x1="15" y1="12" x2="3" y2="12"/>
    </svg>
  );
}
