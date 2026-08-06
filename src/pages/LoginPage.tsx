import { useState, useRef, useEffect } from 'react';
import type { User } from '../types';
import { getAllUsers, signIn } from '../lib/auth';

interface LoginPageProps {
  onLogin: (user: User) => void;
}

export default function LoginPage({ onLogin }: LoginPageProps) {
  const [users, setUsers] = useState<User[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [reloadTick, setReloadTick] = useState(0);

  const [selected, setSelected] = useState<User | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [shaking, setShaking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingUsers(true);
    setLoadError('');
    getAllUsers()
      .then((list) => {
        if (!cancelled) setUsers(list);
      })
      .catch((err) => {
        if (!cancelled) {
          const detail = err?.message || err?.error_description || JSON.stringify(err);
          setLoadError(`تعذّر الاتصال بالخادم: ${detail}`);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingUsers(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadTick]);

  const rightRow = users.filter((u) => u.row === 'right');
  const leftRow  = users.filter((u) => u.row === 'left');

  useEffect(() => {
    if (selected) {
      passwordRef.current?.focus();
    }
  }, [selected]);

  const handleUserSelect = (user: User) => {
    setSelected(user);
    setPassword('');
    setError('');
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!selected || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const authedUser = await signIn(selected.id, password);
      if (authedUser) {
        onLogin(authedUser);
        return;
      }
      setError('كلمة المرور غير صحيحة');
      setShaking(true);
      setTimeout(() => setShaking(false), 600);
      setPassword('');
      passwordRef.current?.focus();
    } catch {
      setError('تعذّر تسجيل الدخول، تحقق من الاتصال');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative min-h-dvh flex flex-col items-center justify-center px-4 pb-10 overflow-hidden">
      {/* Background mesh */}
      <div
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          background:
            'radial-gradient(ellipse 80% 60% at 50% 0%, rgba(59,130,246,0.15) 0%, transparent 70%), radial-gradient(ellipse 60% 80% at 80% 100%, rgba(168,85,247,0.12) 0%, transparent 70%), #06091a',
        }}
      />

      <div className="relative z-10 w-full max-w-sm flex flex-col items-center gap-7 animate-slide-up">
        {/* Logo / Title */}
        <div className="text-center select-none">
          <h1
            className="text-3xl font-black gradient-text"
            style={{ fontFamily: "'Tajawal', sans-serif", letterSpacing: '-0.01em' }}
          >
            فريق العباقرة
          </h1>
          <p className="text-white/40 text-sm mt-1">اختر حسابك للمتابعة</p>
        </div>

        {/* User grid */}
        {loadingUsers && (
          <div className="w-full flex flex-col items-center gap-3 py-6">
            <div
              className="w-8 h-8 rounded-full animate-spin-slow"
              style={{ border: '3px solid rgba(255,255,255,0.15)', borderTopColor: '#60a5fa' }}
            />
            <p className="text-white/30 text-xs">جاري تحميل الحسابات...</p>
          </div>
        )}

        {!loadingUsers && loadError && (
          <div className="w-full glass-md rounded-2xl p-5 flex flex-col items-center gap-3 text-center">
            <p className="text-red-400 text-sm">{loadError}</p>
            <button
              onClick={() => setReloadTick((t) => t + 1)}
              className="text-xs font-bold px-4 py-2 rounded-lg text-white/70"
              style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)' }}
            >
              إعادة المحاولة
            </button>
          </div>
        )}

        {!loadingUsers && !loadError && (
          <div className="w-full flex flex-col gap-3">
            <div className="grid grid-cols-4 gap-2.5">
              {rightRow.map((user) => (
                <UserCard
                  key={user.id}
                  user={user}
                  active={selected?.id === user.id}
                  onClick={() => handleUserSelect(user)}
                />
              ))}
            </div>
            <div className="grid grid-cols-4 gap-2.5">
              {leftRow.map((user) => (
                <UserCard
                  key={user.id}
                  user={user}
                  active={selected?.id === user.id}
                  onClick={() => handleUserSelect(user)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Password section */}
        <div
          className="w-full glass-md rounded-2xl overflow-hidden transition-all duration-500"
          style={{
            maxHeight: 200,
            opacity: selected ? 1 : 0,
            transform: selected ? 'scaleY(1)' : 'scaleY(0)',
            transformOrigin: 'top',
            padding: selected ? '20px' : '0 20px',
            borderColor: selected ? `${selected.color}40` : 'rgba(255,255,255,0.12)',
            boxShadow: selected ? `0 0 24px ${selected.color}30` : 'none',
          }}
        >
          {selected && (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <p className="text-center text-white/60 text-sm">
                مرحباً يا{' '}
                <span className="font-bold text-white">{selected.name}</span>
              </p>

              {/* Password input */}
              <div
                className={`relative rounded-xl overflow-hidden transition-all duration-150 ${shaking ? 'animate-[shake_0.4s_ease]' : ''}`}
                style={{
                  background: 'rgba(0,0,0,0.3)',
                  border: `1px solid ${error ? '#ef4444' : `${selected.color}60`}`,
                  boxShadow: error ? '0 0 12px rgba(239,68,68,0.4)' : `0 0 12px ${selected.color}30`,
                }}
              >
                <input
                  ref={passwordRef}
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  value={password}
                  disabled={submitting}
                  onChange={(e) => {
                    setPassword(e.target.value.replace(/\D/g, '').slice(0, 6));
                    setError('');
                  }}
                  placeholder="● ● ● ● ● ●"
                  className="w-full bg-transparent text-center text-white text-2xl py-3 px-4 font-exo disabled:opacity-50"
                  style={{
                    letterSpacing: '0.3em',
                    caretColor: selected.color,
                  }}
                  autoComplete="current-password"
                />
                {/* Shimmer line */}
                <div
                  className="absolute bottom-0 left-0 right-0 h-px"
                  style={{ background: `linear-gradient(90deg,transparent,${selected.color},transparent)` }}
                />
              </div>

              {error && (
                <p className="text-red-400 text-xs text-center animate-scale-in">{error}</p>
              )}

              <button
                type="submit"
                disabled={password.length !== 6 || submitting}
                className="w-full rounded-xl py-3 font-bold text-white transition-all duration-300 disabled:opacity-30"
                style={{
                  background: `linear-gradient(135deg,${selected.color},${selected.gradient.includes(',') ? selected.gradient.split(',').slice(-1)[0].replace(')', '').trim() : selected.color})`,
                  boxShadow: password.length === 6 ? `0 0 20px ${selected.color}60` : 'none',
                  fontSize: '1rem',
                  fontFamily: "'Tajawal', sans-serif",
                }}
              >
                {submitting ? '...جاري الدخول' : 'دخول'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

// Harry Potter Glasses + Lightning Scar — Mohamed (Improved)
function IconHarryPotter() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7" cy="14" r="4"/>
      <circle cx="17" cy="14" r="4"/>
      <path d="M11 14h2"/>
      <path d="M3 13.5l1-1"/>
      <path d="M21 13.5l-1-1"/>
      <path d="M13 3l-2 5h3l-2 5" strokeWidth="2" stroke="#FFD700"/>
    </svg>
  );
}

// Eye of Horus — Heba (Professional Style)
function IconEyeOfHorus() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12c4-6 16-6 20 0-4 6-16 6-20 0z"/>
      <circle cx="12" cy="12" r="3.5" fill="currentColor" fillOpacity="0.2"/>
      <circle cx="12" cy="12" r="1.5" fill="currentColor"/>
      <path d="M12 15.5v3c0 1-1 2-2 2"/>
      <path d="M18 13.5c1 2 0 4-2 5"/>
      <path d="M6 13.5c-1 2-1 4 1 5"/>
    </svg>
  );
}

// Calculator — Alaa
function IconCalculator() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="2" width="16" height="20" rx="2"/>
      <line x1="8" y1="6" x2="16" y2="6"/>
      <line x1="16" y1="14" x2="16" y2="14"/>
      <line x1="12" y1="14" x2="12" y2="14"/>
      <line x1="8" y1="14" x2="8" y2="14"/>
      <line x1="16" y1="18" x2="16" y2="18"/>
      <line x1="12" y1="18" x2="12" y2="18"/>
      <line x1="8" y1="18" x2="8" y2="18"/>
      <line x1="16" y1="10" x2="16" y2="10"/>
      <line x1="12" y1="10" x2="12" y2="10"/>
      <line x1="8" y1="10" x2="8" y2="10"/>
    </svg>
  );
}

// Science Flask — Ahmed
function IconFlask() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 3h6"/>
      <path d="M10 3v6.5L4.8 18a2 2 0 0 0 1.7 3h11a2 2 0 0 0 1.7-3L14 9.5V3"/>
      <path d="M7.5 14.5h9"/>
    </svg>
  );
}

// Lightbulb — Nour
function IconLightbulb() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18h6"/>
      <path d="M10 21h4"/>
      <path d="M12 3a6 6 0 00-3.5 10.9c.6.45 1 1.15 1 1.9V17h5v-1.2c0-.75.4-1.45 1-1.9A6 6 0 0012 3z"/>
    </svg>
  );
}

// Open Palm facing screen — Hassan (Realistic)
function IconPalmFacingIn() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 21c-3.5 0-6-2.5-6-6.5V9a1.5 1.5 0 0 1 3 0v5h1V5.5a1.5 1.5 0 0 1 3 0v8.5h1V4.5a1.5 1.5 0 0 1 3 0v9.5h1V7a1.5 1.5 0 0 1 3 0v8c0 4-2.5 6-6 6z"/>
    </svg>
  );
}

// Clock — Mira
function IconClock() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="8.5"/>
      <path d="M12 7.5V12l3 2"/>
    </svg>
  );
}

// Professional Football/Soccer Ball — Omar
function IconFootball() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9"/>
      <path d="M12 8l2.5 1.8-.9 2.9h-3.2l-.9-2.9L12 8z" fill="currentColor" fillOpacity="0.2"/>
      <path d="M12 8V3m2.5 6.3l4.3-1.4m-3.4 4.3l2.6 4.1m-8 0l-2.6-4.1m-3.4-4.3l4.3 1.4"/>
    </svg>
  );
}

const USER_ICONS: Record<string, () => JSX.Element> = {
  mohamed: IconHarryPotter,
  heba: IconEyeOfHorus,
  alaa: IconCalculator,
  nour: IconLightbulb,
  hassan: IconPalmFacingIn,
  ahmed: IconFlask,
  mira: IconClock,
  omar: IconFootball,
};

function UserCard({ user, active, onClick }: { user: User; active: boolean; onClick: () => void }) {
  const initials = user.name.slice(0, 2);
  const Icon = USER_ICONS[user.id];

  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-2 rounded-2xl p-2.5 transition-all duration-300 select-none"
      style={{
        background: active
          ? `${user.color}20`
          : 'rgba(255,255,255,0.04)',
        border: `1px solid ${active ? user.color : 'rgba(255,255,255,0.08)'}`,
        boxShadow: active
          ? `0 0 18px ${user.color}50, 0 0 40px ${user.color}20`
          : 'none',
        transform: active ? 'scale(1.06) translateY(-2px)' : 'scale(1)',
      }}
    >
      {/* Avatar */}
      <div
        className="rounded-xl flex items-center justify-center font-black text-sm relative overflow-hidden"
        style={{
          width: 44,
          height: 44,
          background: active ? user.gradient : `${user.color}22`,
          boxShadow: active ? `0 0 14px ${user.color}60` : 'none',
          transition: 'all 0.3s ease',
          fontFamily: "'Tajawal', sans-serif",
        }}
      >
        {active && (
          <div
            className="absolute inset-0 opacity-40"
            style={{
              background: 'linear-gradient(135deg, rgba(255,255,255,0.3) 0%, transparent 60%)',
            }}
          />
        )}
        <span
          className="relative"
          style={{ color: active ? 'white' : user.color, textShadow: active ? '0 1px 4px rgba(0,0,0,0.4)' : 'none' }}
        >
          {Icon ? <Icon /> : initials}
        </span>
      </div>

      {/* Name */}
      <span
        className="text-xs font-semibold transition-colors duration-300"
        style={{
          color: active ? 'white' : 'rgba(255,255,255,0.55)',
          fontFamily: "'Tajawal', sans-serif",
          textShadow: active ? `0 0 10px ${user.color}` : 'none',
        }}
      >
        {user.name}
      </span>
    </button>
  );
}
