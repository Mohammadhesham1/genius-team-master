import { useState, useRef, useEffect } from 'react';
import type { User, PageName, ContentCard, Subject } from '../types';
import { getSubjectById } from '../lib/api/subjects';
import { getContentCards } from '../lib/api/content';
import PdfViewer from '../components/PdfViewer';

interface SubjectPageProps {
  user: User;
  subjectId: string;
  navigate: (page: PageName, params?: Record<string, string>) => void;
}

const CARD_PEEK = 52; // px of each card peeking below the active one

function CardTypeIcon({ type }: { type: ContentCard['type'] }) {
  if (type === 'pdf') return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="16" y1="13" x2="8" y2="13"/>
      <line x1="16" y1="17" x2="8" y2="17"/>
      <polyline points="10 9 9 9 8 9"/>
    </svg>
  );
  if (type === 'link') return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
    </svg>
  );
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
      <circle cx="8.5" cy="8.5" r="1.5"/>
      <polyline points="21 15 16 10 5 21"/>
    </svg>
  );
}

export default function SubjectPage({ user, subjectId, navigate }: SubjectPageProps) {
  const [subject, setSubject] = useState<Subject | null>(null);
  const [cards, setCards] = useState<ContentCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [topCardId, setTopCardId] = useState<string | null>(null);
  const [openCard, setOpenCard] = useState<ContentCard | null>(null);
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    setTopCardId(null);
    setOpenCard(null);
    setLoading(true);
    Promise.all([getSubjectById(subjectId), getContentCards(subjectId)])
      .then(([s, c]) => {
        if (cancelled) return;
        setSubject(s);
        setCards(c);
      })
      .catch(() => {
        if (!cancelled) {
          setSubject(null);
          setCards([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [subjectId]);

  if (loading) {
    return (
      <div className="relative min-h-dvh flex items-center justify-center">
        <div
          className="w-8 h-8 rounded-full animate-spin-slow"
          style={{ border: '3px solid rgba(255,255,255,0.15)', borderTopColor: '#60a5fa' }}
        />
      </div>
    );
  }

  if (!subject) return null;

  const activeIdx = topCardId ? cards.findIndex((c) => c.id === topCardId) : -1;

  const handlePointerDown = (card: ContentCard) => {
    longPressRef.current = setTimeout(() => {
      setTopCardId(card.id);
    }, 400);
  };
  const handlePointerUp = () => {
    if (longPressRef.current) clearTimeout(longPressRef.current);
  };
  const handleClick = (card: ContentCard) => {
    if (topCardId === card.id) {
      setOpenCard(card);
    } else {
      setTopCardId(card.id);
    }
  };

  // Stack layout: top card is full-height, rest peek below
  const getCardStyle = (index: number): React.CSSProperties => {
    const isTop = cards[index].id === topCardId;
    let topOffset: number;

    if (topCardId) {
      if (isTop) {
        topOffset = 0;
      } else if (index < activeIdx) {
        // Cards above the active card go higher
        topOffset = index * CARD_PEEK;
      } else {
        // Cards below active card pile below it
        topOffset = 180 + (index - activeIdx) * CARD_PEEK;
      }
    } else {
      topOffset = index * CARD_PEEK;
    }

    return {
      position: 'absolute',
      left: 0,
      right: 0,
      top: topOffset,
      zIndex: isTop ? cards.length + 10 : cards.length - index,
      transition: 'top 0.42s cubic-bezier(0.23,1,0.32,1), box-shadow 0.3s ease',
    };
  };

  const stackHeight = cards.length * CARD_PEEK + 160;

  return (
    <div className="relative min-h-dvh flex flex-col pb-28 overflow-hidden">
      {/* Header */}
      <div className="sticky top-0 z-40 glass px-4 pt-10 pb-4" style={{ borderBottom: `1px solid ${subject.color}20` }}>
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('home')}
            className="w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-200 hover:bg-white/10"
            style={{ color: subject.color }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </button>
          <div>
            <h1 className="text-xl font-black text-white" style={{ fontFamily: "'Tajawal',sans-serif" }}>
              {subject.name}
            </h1>
          </div>
          <div className="mr-auto">
            <span
              className="text-xs px-3 py-1 rounded-full font-medium"
              style={{ background: `${subject.color}18`, color: subject.color, border: `1px solid ${subject.color}30` }}
            >
              {cards.length} ملف
            </span>
          </div>
        </div>
      </div>

      {/* Card stack */}
      <div
        className="px-4 flex-1 mt-4"
        onClick={(e) => {
          if (e.target === e.currentTarget) setTopCardId(null);
        }}
      >
        {cards.length === 0 ? (
          <p className="text-white/25 text-sm text-center py-10" style={{ fontFamily: "'Tajawal',sans-serif" }}>
            لا يوجد محتوى مضاف لهذا الفرع بعد
          </p>
        ) : (
        <div
          className="relative w-full"
          style={{ height: stackHeight }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setTopCardId(null);
          }}
        >
          {cards.map((card, i) => {
            const isTop = card.id === topCardId;
            return (
              <div
                key={card.id}
                className="wallet-card rounded-2xl overflow-hidden cursor-pointer select-none"
                style={{
                  ...getCardStyle(i),
                  background: isTop
                    ? `linear-gradient(145deg, ${subject.gradFrom}28, ${subject.gradTo}16)`
                    : `linear-gradient(145deg, rgba(255,255,255,0.06), rgba(255,255,255,0.03))`,
                  border: `1px solid ${isTop ? subject.color + '50' : 'rgba(255,255,255,0.10)'}`,
                  boxShadow: isTop
                    ? `0 8px 32px ${subject.glow}, 0 0 0 1px ${subject.color}30`
                    : '0 2px 8px rgba(0,0,0,0.3)',
                  backdropFilter: 'blur(20px)',
                  WebkitBackdropFilter: 'blur(20px)',
                }}
                onPointerDown={() => handlePointerDown(card)}
                onPointerUp={handlePointerUp}
                onPointerLeave={handlePointerUp}
                onClick={() => handleClick(card)}
                onMouseEnter={(e) => {
                  if (!isTop) (e.currentTarget as HTMLElement).style.boxShadow = `0 4px 20px ${subject.glow}`;
                }}
                onMouseLeave={(e) => {
                  if (!isTop) (e.currentTarget as HTMLElement).style.boxShadow = '0 2px 8px rgba(0,0,0,0.3)';
                }}
              >
                {/* Top shimmer line */}
                <div
                  className="absolute top-0 left-0 right-0 h-px"
                  style={{
                    background: `linear-gradient(90deg,transparent,${subject.color}${isTop ? 'cc' : '40'},transparent)`,
                  }}
                />

                {/* Card header — always visible */}
                <div className="flex items-center gap-3 px-4 py-3.5">
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{
                      background: `${subject.color}18`,
                      border: `1px solid ${subject.color}30`,
                      color: subject.color,
                    }}
                  >
                    <CardTypeIcon type={card.type} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p
                      className="text-sm font-bold text-white truncate"
                      style={{ fontFamily: "'Tajawal',sans-serif" }}
                    >
                      {card.title}
                    </p>
                    <p className="text-xs text-white/35 mt-0.5" style={{ fontFamily: "'Exo 2',sans-serif" }}>
                      {card.type === 'pdf' ? 'PDF Document' : card.type === 'link' ? 'External Link' : 'Image Gallery'}
                    </p>
                  </div>
                  <div style={{ color: isTop ? subject.color : 'rgba(255,255,255,0.25)' }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="15 18 9 12 15 6"/>
                    </svg>
                  </div>
                </div>

                {/* Expanded body — only when top card */}
                {isTop && (
                  <div className="px-4 pb-5 pt-1">
                    <div
                      className="h-px mb-4"
                      style={{ background: `linear-gradient(90deg,transparent,${subject.color}40,transparent)` }}
                    />
                    <div className="flex items-center justify-between">
                      <button
                        onClick={(e) => { e.stopPropagation(); setOpenCard(card); }}
                        className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all duration-200"
                        style={{
                          background: `linear-gradient(135deg,${subject.gradFrom},${subject.gradTo})`,
                          color: 'white',
                          boxShadow: `0 4px 14px ${subject.glow}`,
                          fontFamily: "'Tajawal',sans-serif",
                        }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                          <circle cx="12" cy="12" r="3"/>
                        </svg>
                        فتح
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setTopCardId(null); }}
                        aria-label="إغلاق"
                        className="w-8 h-8 rounded-xl flex items-center justify-center text-white/40 hover:text-white/70 hover:bg-white/5 transition-colors"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="18" y1="6" x2="6" y2="18"/>
                          <line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        )}
      </div>

      {/* Content viewer modal */}
      {openCard && (
        <ContentViewer card={openCard} subject={subject} user={user} onClose={() => setOpenCard(null)} />
      )}
    </div>
  );
}

// ── Content Viewer Modal ───────────────────────────────────────────────────
function ContentViewer({
  card,
  subject,
  user,
  onClose,
}: {
  card: ContentCard;
  subject: Subject;
  user: User;
  onClose: () => void;
}) {
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);

  const isGalleryType = card.type === 'image' || card.type === 'imageGroup';
  const galleryImages = card.images && card.images.length > 0
    ? card.images
    : isGalleryType && card.url
    ? [card.url]
    : [];

  // Study-time + per-page tracking now lives entirely inside PdfViewer.

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      style={{ background: 'rgba(6,9,26,0.95)', backdropFilter: 'blur(24px)' }}
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-4 pt-12 pb-4" style={{ borderBottom: `1px solid ${subject.color}20` }}>
        <button
          onClick={onClose}
          className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: `${subject.color}18`, color: subject.color }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-white truncate" style={{ fontFamily: "'Tajawal',sans-serif" }}>{card.title}</p>
          <p className="text-xs font-exo" style={{ color: subject.color }}>
            {card.type === 'pdf' ? 'PDF Reader' : card.type === 'link' ? 'External Link' : 'Image Viewer'}
          </p>
        </div>
        {card.url && card.type === 'link' && (
          <a
            href={card.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs px-3 py-1.5 rounded-lg font-bold flex-shrink-0"
            style={{ background: `${subject.color}18`, color: subject.color, border: `1px solid ${subject.color}30` }}
          >
            فتح في تبويب
          </a>
        )}
      </div>

      {/* Viewer body */}
      {card.type === 'pdf' && card.url ? (
        <PdfViewer url={card.url} accentColor={subject.color} userId={user.id} cardId={card.id} subjectId={subject.id} />
      ) : card.type === 'link' && card.url ? (
        <div className="flex-1 flex items-center justify-center p-6">
          <div
            className="w-full max-w-sm rounded-2xl p-8 text-center flex flex-col items-center gap-4"
            style={{ background: `${subject.color}10`, border: `1px solid ${subject.color}25`, boxShadow: `0 0 40px ${subject.glow}` }}
          >
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center"
              style={{ background: `linear-gradient(135deg,${subject.gradFrom},${subject.gradTo})`, boxShadow: `0 0 24px ${subject.glow}` }}
            >
              <CardTypeIcon type={card.type} />
            </div>
            <p className="text-white/50 text-xs break-all" style={{ fontFamily: "'Exo 2',sans-serif" }}>{card.url}</p>
            <a
              href={card.url}
              target="_blank"
              rel="noopener noreferrer"
              className="px-5 py-2.5 rounded-xl text-sm font-bold text-white"
              style={{ background: `linear-gradient(135deg,${subject.gradFrom},${subject.gradTo})`, boxShadow: `0 4px 14px ${subject.glow}` }}
            >
              فتح الرابط
            </a>
          </div>
        </div>
      ) : galleryImages.length > 0 ? (
        <div className="flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-2 gap-3">
            {galleryImages.map((src, i) => (
              <button
                key={src + i}
                onClick={() => setLightboxIdx(i)}
                className="rounded-xl overflow-hidden"
                style={{ border: `1px solid ${subject.color}30`, aspectRatio: '1' }}
              >
                <img src={src} alt={`${card.title} ${i + 1}`} className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center p-6">
          <div
            className="w-full max-w-sm rounded-2xl p-8 text-center"
            style={{
              background: `${subject.color}10`,
              border: `1px solid ${subject.color}25`,
              boxShadow: `0 0 40px ${subject.glow}`,
            }}
          >
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
              style={{ background: `linear-gradient(135deg,${subject.gradFrom},${subject.gradTo})`, boxShadow: `0 0 24px ${subject.glow}` }}
            >
              <CardTypeIcon type={card.type} />
            </div>
            <p className="text-white/50 text-sm" style={{ fontFamily: "'Tajawal',sans-serif" }}>
              لسه مفيش محتوى مرفوع لهذا الملف
            </p>
            <p className="text-white/25 text-xs mt-3" style={{ fontFamily: "'Tajawal',sans-serif" }}>
              أضف الرابط أو الصور في جدول content_cards على Supabase وهيظهر هنا تلقائي
            </p>
          </div>
        </div>
      )}

      {/* Fullscreen lightbox for gallery images */}
      {lightboxIdx !== null && galleryImages[lightboxIdx] && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.92)' }}
          onClick={() => setLightboxIdx(null)}
        >
          <img src={galleryImages[lightboxIdx]} alt={card.title} className="max-w-full max-h-full rounded-xl" />
        </div>
      )}
    </div>
  );
}
