import { useState, useEffect } from 'react';
import type { User, PageName, Subject } from '../types';
import { getAllSubjects } from '../lib/api/subjects';
import StreakBadge from '../components/StreakBadge';
import StudyTodayBadge from '../components/StudyTodayBadge';

interface HomePageProps {
  user: User;
  navigate: (page: PageName, params?: Record<string, string>) => void;
  onLogout: () => void;
}

// زرار تسجيل الخروج ده يظهر لمحمد بس.
const ADMIN_NAME = 'محمد';

// ── Greeting logic ─────────────────────────────────────────────────────────
function buildGreeting(user: User): string {
  const hour = new Date().getHours();
  const isMorning = hour >= 5 && hour < 15; // 5am – 2:59pm

  // هبة: flat 50/50 chance of the "Welcome home MS Donadei" greeting every time.
  if (user.id === 'heba') {
    const nick = user.nicknames?.[0] ?? user.nameEn;
    if (Math.random() < 0.5) {
      return `Welcome home, ${nick}`;
    }
  }

  // Possible greetings
  const greetings = [
    isMorning ? `صباح الخير يا` : `مساء الخير يا`,
    `أهلا يا`,
    user.row === 'right' ? `منور يا` : `منورة يا`,
  ];

  const idx = Math.floor(Math.random() * greetings.length);
  const prefix = greetings[idx];

  // For محمد، حسن، عمر: randomly use nickname
  let displayName: string;
  if (user.nicknames?.length && !user.hebaEnglishOnly && Math.random() > 0.45) {
    const nick = user.nicknames[Math.floor(Math.random() * user.nicknames.length)];
    displayName = nick;
  } else {
    displayName = user.name;
  }

  return `${prefix} ${displayName}`;
}

// ── Subject icon SVGs ──────────────────────────────────────────────────────
const SUBJECT_ICONS: Record<string, JSX.Element> = {
  geography: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>,
  history:   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/></svg>,
  literature:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>,
  science:   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M9 2h6"/><path d="M10 2v6.5L4.8 18a2 2 0 0 0 1.7 3h11a2 2 0 0 0 1.7-3L14 8.5V2"/><path d="M7.5 14.5h9"/></svg>,
  general:   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 00-3.5 10.9c.6.45 1 1.15 1 1.9V17h5v-1.2c0-.75.4-1.45 1-1.9A6 6 0 0012 3z"/></svg>,
  sports:    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M4.93 4.93l4.24 4.24M14.83 9.17l4.24-4.24M14.83 14.83l4.24 4.24M9.17 14.83l-4.24 4.24M20 12h-4M8 12H4M12 4v4M12 20v-4"/></svg>,
  tech:      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>,
  mental:    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.46 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 4.44-1.14Z"/><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.46 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-4.44-1.14Z"/></svg>,
  cinema:    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/></svg>,
  music:     <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>,
  art:       <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="13.5" cy="6.5" r="0.5" fill="currentColor"/><circle cx="17.5" cy="10.5" r="0.5" fill="currentColor"/><circle cx="8.5" cy="7.5" r="0.5" fill="currentColor"/><circle cx="6.5" cy="12.5" r="0.5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.47-1.125-.29-.289-.438-.652-.438-1.042a1.8 1.8 0 0 1 1.8-1.8h2.13c3.117 0 5.33-2.37 5.33-5.24C22 6.22 17.523 2 12 2z"/></svg>,
  quickwit:  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>,
};

export default function HomePage({ user, navigate, onLogout }: HomePageProps) {
  const [greeting, setGreeting] = useState(() => buildGreeting(user));
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loading, setLoading] = useState(true);

  // Refresh greeting on mount (once per session would be enough)
  useEffect(() => {
    setGreeting(buildGreeting(user));
  }, [user]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getAllSubjects()
      .then((list) => {
        if (!cancelled) setSubjects(list);
      })
      .catch(() => {
        if (!cancelled) setSubjects([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  return (
    <div className="relative min-h-dvh flex flex-col pb-28 overflow-hidden">
      {/* Top greeting card */}
      <div className="px-4 pt-6">
        <GreetingCard user={user} greeting={greeting} onLogout={onLogout} />
      </div>

      {/* Section header */}
      <div className="px-4 mt-7 mb-3 flex items-center gap-3">
        <h2
          className="text-base font-bold text-white/80"
          style={{ fontFamily: "'Tajawal', sans-serif" }}
        >
          الفروع
        </h2>
        <div className="flex-1 h-px bg-gradient-to-l from-transparent via-white/10 to-transparent" />
        <span className="text-white/30 text-xs font-exo">{subjects.length}</span>
      </div>

      {/* Subject cards grid */}
      {loading ? (
        <div className="px-4 grid grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="rounded-2xl animate-glow-pulse"
              style={{ height: 108, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
            />
          ))}
        </div>
      ) : subjects.length === 0 ? (
        <div className="px-4">
          <p className="text-white/30 text-sm text-center py-8" style={{ fontFamily: "'Tajawal', sans-serif" }}>
            لا توجد فروع مسندة لك بعد
          </p>
        </div>
      ) : (
        <div className="px-4 grid grid-cols-2 gap-3">
          {subjects.map((subject, i) => (
            <SubjectCard
              key={subject.id}
              subject={subject}
              index={i}
              onClick={() => navigate('subject', { subjectId: subject.id })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Greeting Card ──────────────────────────────────────────────────────────
function GreetingCard({ user, greeting, onLogout }: { user: User; greeting: string; onLogout: () => void }) {
  return (
    <div
      className="relative rounded-2xl overflow-hidden"
      style={{
        background: `linear-gradient(135deg, ${user.color}20, rgba(255,255,255,0.03))`,
        border: `1px solid ${user.color}35`,
        boxShadow: `0 4px 32px ${user.color}25, inset 0 1px 0 rgba(255,255,255,0.08)`,
        padding: '20px 20px 18px',
      }}
    >
      {/* Shimmer line */}
      <div
        className="absolute top-0 left-0 right-0 h-px"
        style={{ background: `linear-gradient(90deg,transparent,${user.color}80,transparent)` }}
      />

      {/* Decorative circle */}
      <div
        className="absolute -top-8 -right-8 w-32 h-32 rounded-full pointer-events-none"
        style={{
          background: `radial-gradient(circle, ${user.color}22 0%, transparent 70%)`,
          filter: 'blur(16px)',
        }}
      />

      <div className="relative flex items-start justify-between gap-3">
        <div className="flex-1">
          <p
            className="text-xl font-bold text-white leading-snug"
            style={{ fontFamily: "'Tajawal', sans-serif", direction: 'rtl' }}
          >
            {greeting}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex flex-col gap-1.5 items-end">
            <StreakBadge userId={user.id} size="md" />
            <StudyTodayBadge userId={user.id} size="md" />
          </div>
          {user.name === ADMIN_NAME && (
            <button
              onClick={onLogout}
              className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)' }}
              aria-label="تسجيل خروج"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                <polyline points="16 17 21 12 16 7"/>
                <line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Subject Card ───────────────────────────────────────────────────────────
function SubjectCard({
  subject,
  index,
  onClick,
}: {
  subject: Subject;
  index: number;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="relative rounded-2xl overflow-hidden text-right transition-all duration-300 animate-slide-up"
      style={{
        animationDelay: `${index * 60}ms`,
        padding: '18px 16px',
        background: `linear-gradient(145deg, ${subject.gradFrom}22, ${subject.gradTo}12)`,
        border: `1px solid ${subject.color}30`,
        boxShadow: hovered
          ? `0 8px 32px ${subject.glow}, 0 0 0 1px ${subject.color}50`
          : `0 2px 12px ${subject.color}15`,
        transform: hovered ? 'translateY(-3px) scale(1.02)' : 'translateY(0) scale(1)',
      }}
    >
      {/* Top shimmer */}
      <div
        className="absolute top-0 left-0 right-0 h-px transition-opacity duration-300"
        style={{
          background: `linear-gradient(90deg,transparent,${subject.color}90,transparent)`,
          opacity: hovered ? 1 : 0.4,
        }}
      />

      {/* Decorative glow circle */}
      <div
        className="absolute -bottom-4 -left-4 w-20 h-20 rounded-full pointer-events-none transition-opacity duration-300"
        style={{
          background: `radial-gradient(circle, ${subject.color}30 0%, transparent 70%)`,
          filter: 'blur(12px)',
          opacity: hovered ? 1 : 0.5,
        }}
      />

      {/* Icon */}
      <div
        className="mb-3 w-10 h-10 rounded-xl flex items-center justify-center relative"
        style={{
          background: `${subject.color}18`,
          border: `1px solid ${subject.color}35`,
          color: subject.color,
          boxShadow: hovered ? `0 0 14px ${subject.color}50` : 'none',
          transition: 'box-shadow 0.3s ease',
        }}
      >
        <span className="w-5 h-5">{SUBJECT_ICONS[subject.id] ?? <DefaultIcon />}</span>
      </div>

      {/* Name */}
      <p
        className="text-sm font-bold text-white leading-tight"
        style={{ fontFamily: "'Tajawal', sans-serif", textShadow: hovered ? `0 0 12px ${subject.color}` : 'none' }}
      >
        {subject.name}
      </p>

      {/* Arrow */}
      <div
        className="absolute bottom-3 left-3 transition-all duration-300"
        style={{ color: subject.color, opacity: hovered ? 1 : 0.4, transform: hovered ? 'translateX(-3px)' : 'translateX(0)' }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
      </div>
    </button>
  );
}

function DefaultIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-full h-full">
      <circle cx="12" cy="12" r="10"/>
    </svg>
  );
}
