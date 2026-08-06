import { useState, useEffect, useRef } from 'react';
import type { User, PageName } from './types';
import { loadSavedUserId, saveUserId, clearSavedUser, getUserById, startPresence } from './lib/auth';

import AmbientOrbs from './components/AmbientOrbs';
import BottomNav   from './components/BottomNav';
import InviteNotifications from './components/InviteNotifications';
import LoginPage        from './pages/LoginPage';
import HomePage         from './pages/HomePage';
import SubjectPage      from './pages/SubjectPage';
import OneVsOnePage     from './pages/OneVsOnePage';
import SoloTrainingPage from './pages/SoloTrainingPage';
import GroupTrainingPage from './pages/GroupTrainingPage';
import StatisticsPage   from './pages/StatisticsPage';

interface RouteState {
  page: PageName;
  params?: Record<string, string>;
}

// Kept in sessionStorage (not localStorage) on purpose: it should survive a refresh
// of this tab, but a fresh visit/new tab should still land on home like normal.
const ROUTE_STORAGE_KEY = 'app-route';
const VALID_PAGES: PageName[] = ['home', 'subject', 'oneonone', 'solo', 'group', 'stats'];

function loadSavedRoute(): RouteState | null {
  try {
    const raw = sessionStorage.getItem(ROUTE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RouteState;
    if (!parsed || !VALID_PAGES.includes(parsed.page)) return null;
    if (parsed.page === 'subject' && !parsed.params?.subjectId) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveRoute(route: RouteState) {
  try {
    if (!VALID_PAGES.includes(route.page)) return;
    sessionStorage.setItem(ROUTE_STORAGE_KEY, JSON.stringify(route));
  } catch {
    /* sessionStorage unavailable (private mode, etc.) — just skip persisting */
  }
}

function clearSavedRoute() {
  try {
    sessionStorage.removeItem(ROUTE_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [route, setRoute] = useState<RouteState>({ page: 'login' });

  // Resume the saved session (if any) from Supabase on first load, instead of
  // a synchronous localStorage-only lookup, since the user now lives in the DB.
  useEffect(() => {
    let cancelled = false;
    const savedId = loadSavedUserId();
    if (!savedId) {
      setCheckingSession(false);
      return;
    }
    getUserById(savedId)
      .then((user) => {
        if (cancelled) return;
        if (user) {
          setCurrentUser(user);
          setRoute(loadSavedRoute() ?? { page: 'home' });
        }
      })
      .catch(() => {
        /* couldn't reach Supabase — fall back to the login screen */
      })
      .finally(() => {
        if (!cancelled) setCheckingSession(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep a device-session heartbeat alive while someone is logged in, so other
  // members can see who's online when picking 1v1 opponents/referees.
  useEffect(() => {
    if (!currentUser) return;
    const stopPresence = startPresence(currentUser.id);
    return stopPresence;
  }, [currentUser]);

  // OneVsOnePage reports its locally-tracked matchId here as it changes (created,
  // joined, or cleared) so a refresh mid-match restores straight back into it —
  // not just when arriving fresh via an invite notification.
  const updateActiveMatchId = (matchId: string) => {
    if (route.page !== 'oneonone') return;
    const nextRoute: RouteState = matchId
      ? { page: 'oneonone', params: { ...route.params, matchId } }
      : { page: 'oneonone', params: undefined };
    setRoute(nextRoute);
    saveRoute(nextRoute);
  };

  const navigate = (page: PageName, params?: Record<string, string>) => {
    setRoute({ page, params });
    saveRoute({ page, params });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // The 1v1 page can register a guard here while the host is in the lobby
  // or a joined participant is waiting for the match to start, so tapping
  // a different tab in the bottom nav asks for confirmation first instead
  // of silently abandoning the round.
  const leaveGuardRef = useRef<((target: RouteState, proceed: () => void) => void) | null>(null);
  const guardedNavigate = (page: PageName, params?: Record<string, string>) => {
    if (route.page === 'oneonone' && page !== 'oneonone' && leaveGuardRef.current) {
      leaveGuardRef.current({ page, params }, () => navigate(page, params));
      return;
    }
    navigate(page, params);
  };

  const handleLogin = (user: User) => {
    setCurrentUser(user);
    saveUserId(user.id);
    setRoute({ page: 'home' });
  };

  const handleLogout = () => {
    clearSavedUser();
    clearSavedRoute();
    setCurrentUser(null);
    setRoute({ page: 'login' });
  };

  if (checkingSession) {
    return (
      <div
        style={{ background: '#06091a', minHeight: '100dvh', position: 'relative' }}
        className="flex items-center justify-center"
      >
        <AmbientOrbs />
        <p className="gradient-text font-black text-lg relative z-10" style={{ fontFamily: "'Tajawal',sans-serif" }}>
          جاري التحميل...
        </p>
      </div>
    );
  }

  if (route.page === 'login' || !currentUser) {
    return (
      <div style={{ background: '#06091a', minHeight: '100dvh', position: 'relative' }}>
        <AmbientOrbs />
        <LoginPage onLogin={handleLogin} />
      </div>
    );
  }

  const mainPages = ['home', 'oneonone', 'solo', 'group', 'stats'] as PageName[];
  const showNav = mainPages.includes(route.page) || route.page === 'subject';

  return (
    <div style={{ background: '#06091a', minHeight: '100dvh', position: 'relative' }}>
      <AmbientOrbs />
      <InviteNotifications user={currentUser} navigate={navigate} />

      {/* Page render */}
      <div className="relative z-10">
        {route.page === 'home' && (
          <HomePage user={currentUser} navigate={navigate} onLogout={handleLogout} />
        )}
        {route.page === 'subject' && route.params?.subjectId && (
          <SubjectPage
            user={currentUser}
            subjectId={route.params.subjectId}
            navigate={navigate}
          />
        )}
        {route.page === 'oneonone' && (
          <OneVsOnePage
            user={currentUser}
            navigate={navigate}
            registerLeaveGuard={(fn) => { leaveGuardRef.current = fn; }}
            openMatchId={route.params?.matchId}
            onMatchIdChange={updateActiveMatchId}
          />
        )}
        {route.page === 'solo' && (
          <SoloTrainingPage user={currentUser} navigate={navigate} />
        )}
        {route.page === 'group' && (
          <GroupTrainingPage user={currentUser} navigate={navigate} />
        )}
        {route.page === 'stats' && (
          <StatisticsPage user={currentUser} navigate={navigate} />
        )}
      </div>

      {/* Bottom nav */}
      {showNav && (
        <BottomNav currentPage={route.page} navigate={guardedNavigate} />
      )}
    </div>
  );
}
