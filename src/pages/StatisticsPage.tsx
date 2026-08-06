import { useState, useEffect } from 'react';
import type { User, PageName } from '../types';
import { UserAvatar } from '../components/UserIcons';
import {
  getLeaderboard,
  getGroupRadar,
  getGroupSpeed,
  getRivalries,
  subscribeToPoints,
  subscribeToGroupProgress,
  type UserDetailStats,
  type GroupRadarResult,
  type GroupSpeedRow,
  type RivalryRow,
} from '../lib/api/stats';
import {
  getStudyLeaderboard,
  getStudyBySubject,
  getStudyLastWeekBySubject,
  getStudyDayDetail,
  type StudyLeaderboardRow,
  type StudySubjectRow,
  type StudyDailyRow,
  type StudyDayCardDetail,
} from '../lib/api/study';
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis,
  ResponsiveContainer, Legend,
  BarChart, Bar, XAxis, YAxis, Tooltip, Cell,
  CartesianGrid,
} from 'recharts';

interface StatisticsPageProps {
  user: User;
  navigate: (page: PageName, params?: Record<string, string>) => void;
}

export default function StatisticsPage({ navigate: _navigate }: StatisticsPageProps) {
  const [expandedMember, setExpandedMember] = useState<string | null>(null);
  const [leaderboard, setLeaderboard] = useState<UserDetailStats[]>([]);
  const [radar, setRadar] = useState<GroupRadarResult>({ rows: [], groupA: [], groupB: [] });
  const [speed, setSpeed] = useState<GroupSpeedRow[]>([]);
  const [rivalries, setRivalries] = useState<RivalryRow[]>([]);
  const [studyLeaderboard, setStudyLeaderboard] = useState<StudyLeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);

  const loadAll = () => {
    return Promise.all([getLeaderboard(), getGroupRadar(), getGroupSpeed(), getRivalries(3)]).then(
      ([lb, r, sp, rv]) => {
        setLeaderboard(lb);
        setRadar(r);
        setSpeed(sp);
        setRivalries(rv);
      }
    );
  };

  const loadStudy = () => {
    return getStudyLeaderboard().then(setStudyLeaderboard).catch(() => {});
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadAll()
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    loadStudy();
    // Keep the leaderboard fresh as points come in from anywhere in the app.
    const unsubPoints = subscribeToPoints(() => {
      getLeaderboard().then((lb) => { if (!cancelled) setLeaderboard(lb); }).catch(() => {});
      getStudyLeaderboard().then((sl) => { if (!cancelled) setStudyLeaderboard(sl); }).catch(() => {});
      getRivalries(3).then((rv) => { if (!cancelled) setRivalries(rv); }).catch(() => {});
    });
    // Keep group radar/speed/leaderboard/rivalries fresh as rounds/matches are played or reset.
    const unsubGroup = subscribeToGroupProgress(() => {
      Promise.all([getLeaderboard(), getGroupRadar(), getGroupSpeed(), getRivalries(3)])
        .then(([lb, r, sp, rv]) => { if (!cancelled) { setLeaderboard(lb); setRadar(r); setSpeed(sp); setRivalries(rv); } })
        .catch(() => {});
    });
    return () => { cancelled = true; unsubPoints(); unsubGroup(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const soloStudy = [...leaderboard].sort((a, b) => b.soloAnswered - a.soloAnswered);
  const radarUsersFirst = radar.groupA;
  const radarUsersRest = radar.groupB;

  if (loading) {
    return (
      <div className="relative min-h-dvh flex items-center justify-center">
        <div className="w-8 h-8 rounded-full animate-spin-slow" style={{ border: '3px solid rgba(255,255,255,0.15)', borderTopColor: '#60a5fa' }} />
      </div>
    );
  }

  return (
    <div className="relative min-h-dvh flex flex-col pb-28 overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-12 pb-4">
        <h1 className="text-2xl font-black gradient-text" style={{ fontFamily: "'Tajawal',sans-serif" }}>الإحصائيات</h1>
        <p className="text-white/30 text-sm" style={{ fontFamily: "'Tajawal',sans-serif" }}>أداء الفريق</p>
      </div>

      <div className="px-4 flex flex-col gap-6 overflow-y-auto">

        {/* ── Section 1: Radar charts ── */}
        <Section title="مقارنة التدريب الجماعي" subtitle="الإجابات الصحيحة لكل جولة">
          {radar.rows.length === 0 ? (
            <EmptyNote text="لسه محدش لعب تدريب جماعي" />
          ) : (
            <>
              <div className="w-full h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={radar.rows} cx="50%" cy="50%" outerRadius="70%">
                    <PolarGrid />
                    <PolarAngleAxis dataKey="subject" tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.5)', fontFamily: "'Tajawal',sans-serif" }} />
                    <Tooltip
                      contentStyle={{ background: 'rgba(6,9,26,0.95)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, fontFamily: "'Tajawal',sans-serif" }}
                      labelStyle={{ color: 'white' }}
                      itemStyle={{ color: '#fff' }}
                      formatter={(value: number, name: string) => {
                        const u = radarUsersFirst.find((x) => x.userId === name);
                        return [`${value} نقطة`, u?.name ?? name];
                      }}
                    />
                    {radarUsersFirst.map((u) => (
                      <Radar
                        key={u.userId}
                        name={u.name}
                        dataKey={u.userId}
                        stroke={u.color}
                        fill={u.color}
                        fillOpacity={0.08}
                        strokeWidth={2}
                        dot={false}
                        style={{ filter: `drop-shadow(0 0 4px ${u.color})` }}
                      />
                    ))}
                    <Legend
                      formatter={(v) => <span style={{ color: radarUsersFirst.find((u) => u.userId === v)?.color ?? '#fff', fontFamily: "'Tajawal',sans-serif", fontSize: 11 }}>{radarUsersFirst.find((u) => u.userId === v)?.name ?? v}</span>}
                      iconType="circle"
                      iconSize={8}
                    />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
              {radarUsersRest.length > 0 && (
                <div className="w-full h-72 mt-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart data={radar.rows} cx="50%" cy="50%" outerRadius="70%">
                      <PolarGrid />
                      <PolarAngleAxis dataKey="subject" tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.5)', fontFamily: "'Tajawal',sans-serif" }} />
                      <Tooltip
                        contentStyle={{ background: 'rgba(6,9,26,0.95)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, fontFamily: "'Tajawal',sans-serif" }}
                        labelStyle={{ color: 'white' }}
                        itemStyle={{ color: '#fff' }}
                        formatter={(value: number, name: string) => {
                          const u = radarUsersRest.find((x) => x.userId === name);
                          return [`${value} نقطة`, u?.name ?? name];
                        }}
                      />
                      {radarUsersRest.map((u) => (
                        <Radar
                          key={u.userId}
                          name={u.name}
                          dataKey={u.userId}
                          stroke={u.color}
                          fill={u.color}
                          fillOpacity={0.08}
                          strokeWidth={2}
                          dot={false}
                          style={{ filter: `drop-shadow(0 0 4px ${u.color})` }}
                        />
                      ))}
                      <Legend
                        formatter={(v) => <span style={{ color: radarUsersRest.find((u) => u.userId === v)?.color ?? '#fff', fontFamily: "'Tajawal',sans-serif", fontSize: 11 }}>{radarUsersRest.find((u) => u.userId === v)?.name ?? v}</span>}
                        iconType="circle"
                        iconSize={8}
                      />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </>
          )}
        </Section>

        {/* ── Section 2: Speed Bar Chart ── */}
        <Section title="متوسط سرعة الإجابة" subtitle="ثواني — الأسرع أفضل">
          {speed.length === 0 ? (
            <EmptyNote text="لسه محدش سجل وقت إجابة في التدريب الجماعي" />
          ) : (
          <div className="w-full h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={speed} margin={{ top: 4, right: 4, bottom: 4, left: -20 }} barSize={18} barGap={0}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'rgba(255,255,255,0.5)', fontFamily: "'Tajawal',sans-serif" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.3)', fontFamily: "'Exo 2',sans-serif" }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ background: 'rgba(6,9,26,0.95)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, fontFamily: "'Tajawal',sans-serif" }}
                  labelStyle={{ color: 'white' }}
                  itemStyle={{ color: '#fff' }}
                  formatter={(value: number, name: string) => [`${value}s`, name === 'correct' ? 'صحيحة' : name === 'wrong' ? 'خاطئة' : 'العامة']}
                />
                <Bar dataKey="correct" stackId="speed" radius={[0, 0, 0, 0]}>
                  {speed.map((entry) => (
                    <Cell key={entry.userId} fill={entry.color} style={{ filter: `drop-shadow(0 0 4px ${entry.color})` }} />
                  ))}
                </Bar>
                <Bar dataKey="avg" stackId="total" radius={[0, 0, 0, 0]}>
                  {speed.map((entry) => (
                    <Cell key={entry.userId} fill={`${entry.color}55`} />
                  ))}
                </Bar>
                <Bar dataKey="wrong" stackId="worst" radius={[4, 4, 0, 0]}>
                  {speed.map((entry) => (
                    <Cell key={entry.userId} fill="rgba(239,68,68,0.5)" />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          )}
          <div className="flex items-center justify-center gap-5 mt-1">
            {[
              { label: 'متوسط سرعة الصحيحة', color: '#3b82f6', glow: true },
              { label: 'متوسط السرعة العامة', color: 'rgba(255,255,255,0.18)', glow: false },
              { label: 'متوسط سرعة الخاطئة', color: 'rgba(239,68,68,0.5)', glow: false },
            ].map((l) => (
              <div key={l.label} className="flex items-center gap-1.5">
                <span
                  className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                  style={{ background: l.color, boxShadow: l.glow ? `0 0 6px ${l.color}` : 'none' }}
                />
                <span className="text-white/40 text-[10px]" style={{ fontFamily: "'Tajawal',sans-serif" }}>{l.label}</span>
              </div>
            ))}
          </div>
        </Section>

        {/* ── Section 3: Solo study chart + leaderboard ── */}
        <div className="grid grid-cols-1 gap-4">
          <Section title="مذاكرة التدريب الفردي" subtitle="عدد الأسئلة المجاوبة">
            <div className="w-full h-52">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={soloStudy} layout="vertical" margin={{ top: 0, right: 8, left: 8, bottom: 0 }} barSize={14} barGap={2}>
                  <XAxis type="number" tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.3)', fontFamily: "'Exo 2',sans-serif" }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fill: 'rgba(255,255,255,0.6)', fontFamily: "'Tajawal',sans-serif" }} axisLine={false} tickLine={false} width={64} interval={0} />
                  <CartesianGrid horizontal={false} />
                  <Tooltip
                    contentStyle={{ background: 'rgba(6,9,26,0.95)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, fontFamily: "'Tajawal',sans-serif" }}
                    labelStyle={{ color: 'white' }}
                    itemStyle={{ color: '#fff' }}
                    formatter={(value: number, name: string) => [value, name === 'soloAnswered' ? 'مجاوب' : 'صحيح']}
                  />
                  <Bar dataKey="soloAnswered" radius={[0, 4, 4, 0]}>
                    {soloStudy.map((entry) => (
                      <Cell key={entry.userId} fill={entry.color} style={{ filter: `drop-shadow(0 0 3px ${entry.color})` }} />
                    ))}
                  </Bar>
                  <Bar dataKey="soloCorrect" radius={[0, 4, 4, 0]}>
                    {soloStudy.map((entry) => (
                      <Cell key={entry.userId} fill={`${entry.color}44`} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Section>

          {/* Solo leaderboard */}
          <Section title="ليدر بورد التدريب الفردي" subtitle="حسب عدد الأسئلة">
            <div className="flex flex-col gap-2">
              {soloStudy.map((entry, i) => (
                <div key={entry.userId} className="flex items-center gap-3 rounded-xl px-3 py-2.5"
                  style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold font-exo flex-shrink-0"
                    style={{ background: i < 3 ? `${entry.color}30` : 'rgba(255,255,255,0.05)', color: i < 3 ? entry.color : 'rgba(255,255,255,0.3)' }}>
                    {i + 1}
                  </span>
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ background: `${entry.color}20`, color: entry.color }}
                  >
                    <UserAvatar userId={entry.userId} name={entry.name} />
                  </div>
                  <span className="flex-1 text-white font-bold text-sm" style={{ fontFamily: "'Tajawal',sans-serif" }}>{entry.name}</span>
                  <span className="font-bold text-sm font-exo" style={{ color: entry.color }}>{entry.soloAnswered}</span>
                </div>
              ))}
            </div>
          </Section>
        </div>

        {/* ── Section 3b: Content study leaderboard ── */}
        <Section title="ليدر بورد المذاكرة" subtitle="وقت مذاكرة المحتوى (PDF)">
          {studyLeaderboard.length === 0 ? (
            <EmptyNote text="لسه محدش ذاكر محتوى" />
          ) : (
            <StudyLeaderboard rows={studyLeaderboard} />
          )}
        </Section>

        {/* ── Section 4: Top rivalries ── */}
        <Section title="أبرز المنافسات في 1v1" subtitle="أكثر المباريات تكراراً">
          {rivalries.length === 0 ? (
            <EmptyNote text="لسه محدش لعب 1v1" />
          ) : (
            <div className="flex flex-col gap-3">
              {rivalries.map((rivalry, i) => (
                <RivalryCard key={`${rivalry.player1.userId}-${rivalry.player2.userId}`} rivalry={rivalry} rank={i + 1} />
              ))}
            </div>
          )}
        </Section>

        {/* ── Section 5: Global leaderboard ── */}
        <Section title="الترتيب العام" subtitle="النقاط الإجمالية">
          <div className="flex flex-col gap-2">
            {leaderboard.map((entry, i) => {
              const isExpanded = expandedMember === entry.userId;
              return (
                <div key={entry.userId} className="rounded-2xl overflow-hidden transition-all duration-300"
                  style={{ background: `${entry.color}0a`, border: `1px solid ${entry.color}20`, boxShadow: isExpanded ? `0 0 16px ${entry.color}25` : 'none' }}>
                  <div className="flex items-center gap-3 px-3 py-3">
                    {/* Rank */}
                    <span className="w-6 text-center font-black text-sm font-exo flex-shrink-0"
                      style={{ color: i === 0 ? '#fbbf24' : i === 1 ? '#94a3b8' : i === 2 ? '#f97316' : 'rgba(255,255,255,0.3)' }}>
                      {i + 1}
                    </span>
                    {/* Avatar */}
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ background: entry.gradient, boxShadow: `0 0 8px ${entry.color}40` }}>
                      <UserAvatar userId={entry.userId} name={entry.name} />
                    </div>
                    {/* Name */}
                    <span className="flex-1 font-bold text-sm text-white" style={{ fontFamily: "'Tajawal',sans-serif" }}>{entry.name}</span>
                    {/* Points */}
                    <span className="font-bold text-sm font-exo" style={{ color: entry.color }}>{entry.totalPoints.toLocaleString()}</span>
                    {/* Expand arrow */}
                    <button
                      onClick={() => setExpandedMember(isExpanded ? null : entry.userId)}
                      className="w-7 h-7 rounded-lg flex items-center justify-center transition-all duration-300"
                      style={{ color: 'rgba(255,255,255,0.3)', transform: isExpanded ? 'rotate(180deg)' : 'rotate(0)' }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                    </button>
                  </div>

                  {/* Expanded profile */}
                  {isExpanded && (
                    <div className="px-4 pb-4 border-t border-white/5 pt-3 animate-slide-up">
                      <MemberProfile entry={entry} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Section>

        <div className="h-4" />
      </div>
    </div>
  );
}

// ── Member Profile ─────────────────────────────────────────────────────────
function MemberProfile({ entry }: { entry: UserDetailStats }) {
  const stats = [
    { label: 'نقاط التدريب الجماعي', value: entry.groupPoints, color: '#3b82f6' },
    { label: 'نقاط التدريب الفردي', value: entry.soloPoints, color: '#10b981' },
    { label: 'نقاط 1v1', value: entry.onevonePoints, color: '#ef4444' },
    { label: 'نقاط مذاكرة المحتوى', value: entry.studyPoints, color: '#34d399' },
    { label: 'إجمالي النقاط', value: entry.totalPoints, color: entry.color },
  ];
  return (
    <div className="flex flex-col gap-2">
      {stats.map((s) => (
        <div key={s.label} className="flex items-center justify-between">
          <span className="text-white/40 text-xs" style={{ fontFamily: "'Tajawal',sans-serif" }}>{s.label}</span>
          <span className="font-bold text-sm font-exo" style={{ color: s.color }}>{s.value.toLocaleString()}</span>
        </div>
      ))}
      <div className="h-px bg-white/5 my-1" />
      <div className="flex items-center justify-between">
        <span className="text-white/40 text-xs" style={{ fontFamily: "'Tajawal',sans-serif" }}>أسئلة الفردي</span>
        <span className="font-bold text-sm font-exo text-white/60">{entry.soloAnswered}</span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-white/40 text-xs" style={{ fontFamily: "'Tajawal',sans-serif" }}>أسئلة الجماعي</span>
        <span className="font-bold text-sm font-exo text-white/60">{entry.groupAnswered}</span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-white/40 text-xs" style={{ fontFamily: "'Tajawal',sans-serif" }}>مباريات 1v1</span>
        <span className="font-bold text-sm font-exo text-white/60">{entry.matchesPlayed}</span>
      </div>
    </div>
  );
}

// ── Study Leaderboard (time spent reading content, with drill-down) ────────
function formatHM(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.round((totalSeconds % 3600) / 60);
  if (h === 0) return `${m} د`;
  if (m === 0) return `${h} س`;
  return `${h} س ${m} د`;
}

function StudyLeaderboard({ rows }: { rows: StudyLeaderboardRow[] }) {
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [subjects, setSubjects] = useState<StudySubjectRow[]>([]);
  const [subjectsLoading, setSubjectsLoading] = useState(false);
  const [expandedSubject, setExpandedSubject] = useState<string | null>(null);
  const [week, setWeek] = useState<StudyDailyRow[]>([]);
  const [weekLoading, setWeekLoading] = useState(false);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const [dayDetail, setDayDetail] = useState<StudyDayCardDetail[]>([]);
  const [dayLoading, setDayLoading] = useState(false);

  const toggleUser = (userId: string) => {
    if (expandedUser === userId) {
      setExpandedUser(null);
      setExpandedSubject(null);
      return;
    }
    setExpandedUser(userId);
    setExpandedSubject(null);
    setSubjectsLoading(true);
    getStudyBySubject(userId).then(setSubjects).catch(() => setSubjects([])).finally(() => setSubjectsLoading(false));
  };

  const toggleSubject = (userId: string, subjectId: string) => {
    if (expandedSubject === subjectId) { setExpandedSubject(null); return; }
    setExpandedSubject(subjectId);
    setExpandedDay(null);
    setWeekLoading(true);
    getStudyLastWeekBySubject(userId, subjectId).then(setWeek).catch(() => setWeek([])).finally(() => setWeekLoading(false));
  };

  const toggleDay = (userId: string, subjectId: string, date: string) => {
    if (expandedDay === date) { setExpandedDay(null); return; }
    setExpandedDay(date);
    setDayLoading(true);
    getStudyDayDetail(userId, subjectId, date).then(setDayDetail).catch(() => setDayDetail([])).finally(() => setDayLoading(false));
  };

  const weekdayLabel = (dateStr: string) => {
    const names = ['أحد', 'اتنين', 'تلات', 'أربع', 'خميس', 'جمعة', 'سبت'];
    return names[new Date(dateStr + 'T12:00:00').getDay()];
  };

  return (
    <div className="flex flex-col gap-2">
      {rows.map((entry, i) => {
        const isExpanded = expandedUser === entry.userId;
        return (
          <div key={entry.userId} className="rounded-2xl overflow-hidden transition-all duration-300"
            style={{ background: `${entry.color}0a`, border: `1px solid ${entry.color}20`, boxShadow: isExpanded ? `0 0 16px ${entry.color}25` : 'none' }}>
            <button onClick={() => toggleUser(entry.userId)} className="w-full flex items-center gap-3 px-3 py-3 text-right">
              <span className="w-6 text-center font-black text-sm font-exo flex-shrink-0"
                style={{ color: i === 0 ? '#fbbf24' : i === 1 ? '#94a3b8' : i === 2 ? '#f97316' : 'rgba(255,255,255,0.3)' }}>
                {i + 1}
              </span>
              <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: entry.gradient, boxShadow: `0 0 8px ${entry.color}40` }}>
                <UserAvatar userId={entry.userId} name={entry.name} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm text-white" style={{ fontFamily: "'Tajawal',sans-serif" }}>{entry.name}</p>
                <p className="text-white/30 text-[10px] font-exo">النهاردة: {formatHM(entry.todaySeconds)}</p>
              </div>
              <div className="text-left flex-shrink-0">
                <p className="font-bold text-sm font-exo" style={{ color: entry.color }}>{formatHM(entry.totalSeconds)}</p>
                <p className="text-white/30 text-[10px] font-exo">{entry.studyPoints.toLocaleString()} نقطة</p>
              </div>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                style={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform .3s', flexShrink: 0 }}>
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </button>

            {isExpanded && (
              <div className="px-4 pb-4 border-t border-white/5 pt-3 animate-slide-up flex flex-col gap-2">
                {subjectsLoading ? (
                  <p className="text-white/25 text-xs text-center py-2" style={{ fontFamily: "'Tajawal',sans-serif" }}>...جاري التحميل</p>
                ) : subjects.length === 0 ? (
                  <EmptyNote text="لسه مذاكرش أي محتوى" />
                ) : (
                  subjects.map((s) => (
                    <div key={s.subjectId}>
                      <button
                        onClick={() => toggleSubject(entry.userId, s.subjectId)}
                        className="w-full flex items-center justify-between rounded-xl px-3 py-2 text-right"
                        style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${s.color}25` }}
                      >
                        <span className="text-white text-xs font-bold" style={{ fontFamily: "'Tajawal',sans-serif" }}>{s.subjectName}</span>
                        <span className="font-exo text-xs font-bold" style={{ color: s.color }}>{formatHM(s.totalSeconds)}</span>
                      </button>

                      {expandedSubject === s.subjectId && (
                        <div className="mt-2 mb-1 px-2 flex flex-col gap-1.5 animate-slide-up">
                          {weekLoading ? (
                            <p className="text-white/25 text-xs text-center py-2" style={{ fontFamily: "'Tajawal',sans-serif" }}>...جاري التحميل</p>
                          ) : (
                            week.map((d) => (
                              <div key={d.date}>
                                <button
                                  onClick={() => d.seconds > 0 && toggleDay(entry.userId, s.subjectId, d.date)}
                                  disabled={d.seconds === 0}
                                  className="w-full flex items-center justify-between py-1"
                                >
                                  <span className="text-white/40 text-[11px]" style={{ fontFamily: "'Tajawal',sans-serif" }}>{weekdayLabel(d.date)}</span>
                                  <span className="flex items-center gap-1">
                                    <span className="text-white/60 text-[11px] font-exo">{d.seconds > 0 ? formatHM(d.seconds) : '—'}</span>
                                    {d.seconds > 0 && (
                                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
                                        style={{ transform: expandedDay === d.date ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform .3s' }}>
                                        <polyline points="6 9 12 15 18 9"/>
                                      </svg>
                                    )}
                                  </span>
                                </button>

                                {expandedDay === d.date && (
                                  <div className="mb-2 mt-1 rounded-xl px-3 py-2.5 animate-slide-up" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
                                    {dayLoading ? (
                                      <p className="text-white/25 text-[11px] text-center py-1" style={{ fontFamily: "'Tajawal',sans-serif" }}>...جاري التحميل</p>
                                    ) : dayDetail.length === 0 ? (
                                      <p className="text-white/25 text-[11px] text-center py-1" style={{ fontFamily: "'Tajawal',sans-serif" }}>مفيش تفاصيل صفحات مسجلة</p>
                                    ) : (
                                      dayDetail.map((card) => (
                                        <div key={card.cardId} className="mb-2 last:mb-0">
                                          <div className="flex items-center justify-between mb-1.5">
                                            <span className="text-white/70 text-[11px] font-bold" style={{ fontFamily: "'Tajawal',sans-serif" }}>{card.cardTitle}</span>
                                            <span className="text-white/35 text-[10px] font-exo">وصل لصفحة {card.furthestPage}</span>
                                          </div>
                                          <div className="flex flex-col gap-1">
                                            {card.pages.map((p) => (
                                              <div key={p.page} className="flex items-center justify-between">
                                                <span className="text-white/40 text-[10px] font-exo">صفحة {p.page}</span>
                                                <span className="text-white/50 text-[10px] font-exo">{formatHM(p.seconds)} · {p.taps} لمسة</span>
                                              </div>
                                            ))}
                                          </div>
                                        </div>
                                      ))
                                    )}
                                  </div>
                                )}
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Rivalry Card ───────────────────────────────────────────────────────────
function RivalryCard({ rivalry, rank }: { rivalry: RivalryRow; rank: number }) {
  const c1 = rivalry.player1.color;
  const c2 = rivalry.player2.color;
  const total = rivalry.matchesPlayed;
  const draws = Math.max(total - rivalry.player1.wins - rivalry.player2.wins, 0);
  const w1pct = total ? (rivalry.player1.wins / total) * 100 : 50;
  const w2pct = total ? (rivalry.player2.wins / total) * 100 : 50;

  return (
    <div className="rounded-2xl p-4" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-white/25 text-xs font-exo">#{rank}</span>
        <span className="text-white/25 text-xs font-exo">{total} مبارة</span>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex-1 flex flex-col items-center gap-1">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: `${c1}25`, color: c1, border: `1px solid ${c1}40` }}>
            <UserAvatar userId={rivalry.player1.userId} name={rivalry.player1.name} />
          </div>
          <p className="text-white font-bold text-sm" style={{ fontFamily: "'Tajawal',sans-serif" }}>{rivalry.player1.name}</p>
          <p className="font-black text-xl font-exo" style={{ color: c1, textShadow: `0 0 10px ${c1}` }}>{rivalry.player1.wins}</p>
          <p className="text-white/20 text-[10px] font-exo">{rivalry.totalPoints1} نقطة</p>
        </div>

        <div className="flex flex-col items-center gap-2 flex-shrink-0">
          <span className="gradient-text font-black text-lg font-exo">VS</span>
          {draws > 0 && (
            <span className="text-white/30 text-[10px]" style={{ fontFamily: "'Tajawal',sans-serif" }}>{draws} تعادل</span>
          )}
          <div className="w-20 h-1.5 rounded-full overflow-hidden flex" style={{ background: 'rgba(255,255,255,0.06)' }}>
            <div className="h-full" style={{ width: `${w1pct}%`, background: c1 }} />
            <div className="h-full" style={{ width: `${w2pct}%`, background: c2 }} />
          </div>
        </div>

        <div className="flex-1 flex flex-col items-center gap-1">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: `${c2}25`, color: c2, border: `1px solid ${c2}40` }}>
            <UserAvatar userId={rivalry.player2.userId} name={rivalry.player2.name} />
          </div>
          <p className="text-white font-bold text-sm" style={{ fontFamily: "'Tajawal',sans-serif" }}>{rivalry.player2.name}</p>
          <p className="font-black text-xl font-exo" style={{ color: c2, textShadow: `0 0 10px ${c2}` }}>{rivalry.player2.wins}</p>
          <p className="text-white/20 text-[10px] font-exo">{rivalry.totalPoints2} نقطة</p>
        </div>
      </div>
    </div>
  );
}

function EmptyNote({ text }: { text: string }) {
  return <p className="text-white/25 text-xs text-center py-6" style={{ fontFamily: "'Tajawal',sans-serif" }}>{text}</p>;
}

// ── Section wrapper ────────────────────────────────────────────────────────
function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="glass-md rounded-2xl p-4">
      <div className="mb-4">
        <h2 className="text-base font-bold text-white" style={{ fontFamily: "'Tajawal',sans-serif" }}>{title}</h2>
        {subtitle && <p className="text-white/30 text-xs mt-0.5" style={{ fontFamily: "'Tajawal',sans-serif" }}>{subtitle}</p>}
        <div className="h-px mt-2.5" style={{ background: 'linear-gradient(90deg,rgba(59,130,246,0.5),transparent)' }} />
      </div>
      {children}
    </div>
  );
}
