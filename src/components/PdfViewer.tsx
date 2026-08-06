import { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
// eslint-disable-next-line import/no-unresolved
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { useStudyTimer } from '../hooks/useStudyTimer';
import { logStudySession } from '../lib/api/study';
import { STICKERS } from '../lib/stickersData';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const PDFJS_VERSION = '6.2.108'; // must match the "pdfjs-dist" version in package.json
const CMAP_URL = `https://unpkg.com/pdfjs-dist@${PDFJS_VERSION}/cmaps/`;
const STANDARD_FONT_DATA_URL = `https://unpkg.com/pdfjs-dist@${PDFJS_VERSION}/standard_fonts/`;
const RENDER_SCALE = 3; // raster resolution baked into each canvas, independent of on-screen zoom — high enough to stay crisp up to ~300% zoom

// Weaker/older phones silently fail (or run out of memory) when a <canvas> gets too big or
// too many stay allocated at once — that's the "works for some, blank/black for others" bug.
// These two guards keep every device inside safe limits:
const MAX_CANVAS_DIMENSION = 4096; // stay under common mobile GPU texture-size limits
const MAX_CANVAS_AREA = 16 * 1024 * 1024; // ~16MP, safe headroom across iOS/Android
const RENDER_KEEP_MARGIN = 900; // px outside the viewport a page's canvas is kept in memory before being evicted

/** Clamp the raster scale so the resulting canvas never exceeds device-safe dimensions/area. */
function safeScale(naturalWidth: number, naturalHeight: number, desiredScale: number): number {
  let scale = desiredScale;
  if (naturalWidth * scale > MAX_CANVAS_DIMENSION || naturalHeight * scale > MAX_CANVAS_DIMENSION) {
    scale = Math.min(MAX_CANVAS_DIMENSION / naturalWidth, MAX_CANVAS_DIMENSION / naturalHeight);
  }
  if (naturalWidth * naturalHeight * scale * scale > MAX_CANVAS_AREA) {
    scale = Math.sqrt(MAX_CANVAS_AREA / (naturalWidth * naturalHeight));
  }
  return scale;
}

const GENERAL_CORRECT_STICKERS = STICKERS.filter(
  (s) => s.rules.isBoth || (s.rules.isGeneral && s.rules.isCorrect) || (s.rules.isCorrect && !s.rules.streakCount && !s.rules.afterStreak)
);
function pickConfirmSticker(): string | null {
  if (GENERAL_CORRECT_STICKERS.length === 0) return null;
  return GENERAL_CORRECT_STICKERS[Math.floor(Math.random() * GENERAL_CORRECT_STICKERS.length)].path;
}

interface PdfViewerProps {
  url: string;
  accentColor?: string;
  userId: string;
  cardId: string;
  subjectId: string;
}

/** One page: reserves its real size immediately (at zoom), then renders its canvas once scrolled near. */
function PdfPage({
  doc,
  pageNumber,
  zoom,
  registerObserver,
}: {
  doc: PDFDocumentProxy;
  pageNumber: number;
  zoom: number;
  registerObserver: (el: HTMLDivElement, pageNumber: number) => void;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [naturalSize, setNaturalSize] = useState({ width: 595, height: 842 }); // A4-ish default until known
  const [rendered, setRendered] = useState(false);
  const [visible, setVisible] = useState(false);
  const attemptRef = useRef(0); // render retry counter, reset whenever the page is evicted/re-triggered

  // Single observer: pulls the page in a bit before it reaches the viewport (to render ahead of
  // scroll), and evicts its canvas once it's well outside the viewport again (to free memory —
  // without this, a long PDF keeps every canvas it has ever shown allocated forever, which is
  // exactly what makes rendering silently fail partway through on weaker phones).
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    registerObserver(el, pageNumber);
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setVisible(true);
          } else {
            setVisible(false);
            const canvas = canvasRef.current;
            if (canvas) { canvas.width = 0; canvas.height = 0; }
            attemptRef.current = 0;
            setRendered(false);
          }
        });
      },
      { rootMargin: `${RENDER_KEEP_MARGIN}px 0px` }
    );
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageNumber]);

  useEffect(() => {
    if (!visible || rendered) return;
    let cancelled = false;
    doc.getPage(pageNumber).then((page) => {
      if (cancelled) return;
      const natural = page.getViewport({ scale: 1 });
      setNaturalSize({ width: natural.width, height: natural.height });

      // Halve the scale on each retry — covers devices that fail at full resolution
      // due to memory pressure rather than a real, unrecoverable render error.
      const scale = safeScale(natural.width, natural.height, RENDER_SCALE) / 2 ** attemptRef.current;
      const renderViewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = Math.max(1, Math.round(renderViewport.width));
      canvas.height = Math.max(1, Math.round(renderViewport.height));
      const task = page.render({ canvas, viewport: renderViewport });
      task.promise
        .then(() => { if (!cancelled) setRendered(true); })
        .catch(() => {
          if (cancelled) return;
          if (attemptRef.current < 2) {
            // likely ran out of canvas memory at this size — try again smaller
            attemptRef.current += 1;
            setVisible(false);
            setTimeout(() => { if (!cancelled) setVisible(true); }, 50);
          }
        });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [visible, rendered, doc, pageNumber]);

  const displayWidth = Math.round(naturalSize.width * zoom);
  const displayHeight = Math.round(naturalSize.height * zoom);

  return (
    <div ref={wrapperRef} data-page={pageNumber} style={{ width: displayWidth, height: displayHeight, margin: '0 auto 10px' }}>
      <div
        style={{
          width: '100%',
          height: '100%',
          background: rendered ? 'transparent' : 'rgba(255,255,255,0.04)',
          borderRadius: 6,
          overflow: 'hidden',
        }}
      >
        <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
      </div>
    </div>
  );
}

export default function PdfViewer({ url, accentColor = '#60a5fa', userId, cardId, subjectId }: PdfViewerProps) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageElsRef = useRef<Map<number, HTMLDivElement>>(new Map());
  const currentPageRef = useRef(1);

  // ── Study-time + per-page tracking ──────────────────────────────────────
  const totalSecondsRef = useRef(0);
  const pageStatsRef = useRef<Map<number, { seconds: number; taps: number }>>(new Map());

  const flush = () => {
    const seconds = totalSecondsRef.current;
    if (seconds <= 0) return;
    const pages = Array.from(pageStatsRef.current.entries()).map(([page, s]) => ({ page, seconds: s.seconds, taps: s.taps }));
    totalSecondsRef.current = 0;
    pageStatsRef.current = new Map();
    logStudySession(userId, cardId, subjectId, seconds, pages).catch(() => {});
  };

  const { presenceCheck, confirmPresence } = useStudyTimer({
    enabled: true,
    onTick: () => {
      totalSecondsRef.current += 1;
      const p = currentPageRef.current;
      const stats = pageStatsRef.current.get(p) ?? { seconds: 0, taps: 0 };
      stats.seconds += 1;
      pageStatsRef.current.set(p, stats);
    },
    onFlush: flush,
  });

  const [confirmSticker, setConfirmSticker] = useState<string | null>(null);
  const handleConfirmPresence = () => {
    confirmPresence();
    const sticker = pickConfirmSticker();
    if (sticker) {
      setConfirmSticker(sticker);
      setTimeout(() => setConfirmSticker(null), 2000);
    }
  };

  // Uses pointerdown, not click: a browser 'click' only fires if the finger doesn't move at
  // all between touch-start and touch-end, so almost every real tap while reading — which
  // ends in a small scroll to the next bit of the page — was being silently dropped. Counting
  // on pointerdown instead means the tap registers the instant the screen is touched, whatever
  // happens after (scroll, hold, or a real stationary tap).
  const registerTap = (e: React.PointerEvent) => {
    const target = e.target as HTMLElement;
    const pageEl = target.closest('[data-page]') as HTMLElement | null;
    const page = pageEl ? Number(pageEl.dataset.page) : currentPageRef.current;
    const stats = pageStatsRef.current.get(page) ?? { seconds: 0, taps: 0 };
    stats.taps += 1;
    pageStatsRef.current.set(page, stats);
  };

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setDoc(null);
    setNumPages(0);
    // Reset page tracking so a new PDF doesn't start out showing the previous
    // document's current-page / stats (this is what caused indicators like "38 / 1").
    setCurrentPage(1);
    currentPageRef.current = 1;
    pageElsRef.current = new Map();
    totalSecondsRef.current = 0;
    pageStatsRef.current = new Map();
    const loadingTask = pdfjsLib.getDocument({
      url,
      cMapUrl: CMAP_URL,
      cMapPacked: true,
      standardFontDataUrl: STANDARD_FONT_DATA_URL,
      disableFontFace: true,
    });
    loadingTask.promise
      .then((pdf) => {
        if (cancelled) return;
        setDoc(pdf);
        setNumPages(pdf.numPages);
      })
      .catch(() => { if (!cancelled) setError('تعذّر تحميل الملف'); });
    return () => {
      cancelled = true;
      loadingTask.destroy();
    };
  }, [url]);

  // Track which page is most visible, for the "x / y" indicator + per-page time attribution.
  useEffect(() => {
    if (!doc || pageElsRef.current.size === 0) return;
    // The observer callback only reports entries whose ratio just crossed one of the
    // thresholds — not every page currently being observed. Comparing only those meant
    // the "best" page was picked from a partial, stale snapshot each time (this is what
    // made the page indicator and per-page time/tap attribution drift, e.g. "38 / 1").
    // Keeping a running ratio per page and recomputing the max over all of them fixes it.
    const ratios = new Map<number, number>();
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const page = Number((entry.target as HTMLElement).dataset.page);
          ratios.set(page, entry.intersectionRatio);
        });
        let bestPage = 0;
        let bestRatio = 0;
        ratios.forEach((ratio, page) => {
          if (ratio > bestRatio) { bestRatio = ratio; bestPage = page; }
        });
        if (bestPage > 0) {
          setCurrentPage(bestPage);
          currentPageRef.current = bestPage;
        }
      },
      { threshold: [0, 0.25, 0.5, 0.75, 1] }
    );
    pageElsRef.current.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [doc, numPages]);

  const registerObserver = (el: HTMLDivElement, pageNumber: number) => {
    pageElsRef.current.set(pageNumber, el);
  };

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center px-6">
        <p className="text-white/50 text-sm text-center" style={{ fontFamily: "'Tajawal',sans-serif" }}>{error}</p>
      </div>
    );
  }

  if (!doc) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: `${accentColor}40`, borderTopColor: 'transparent' }} />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 relative">
      {/* Zoom + page indicator */}
      <div className="flex items-center justify-between px-4 py-2 flex-shrink-0" style={{ borderBottom: `1px solid ${accentColor}15` }}>
        <span className="font-exo text-xs text-white/40">{currentPage} / {numPages}</span>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setZoom((z) => Math.max(0.6, +(z - 0.2).toFixed(2)))}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-white/60 text-sm font-bold"
            style={{ background: 'rgba(255,255,255,0.06)' }}
          >−</button>
          <span className="font-exo text-[11px] text-white/40 w-9 text-center">{Math.round(zoom * 100)}%</span>
          <button
            onClick={() => setZoom((z) => Math.min(3, +(z + 0.2).toFixed(2)))}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-white/60 text-sm font-bold"
            style={{ background: 'rgba(255,255,255,0.06)' }}
          >+</button>
        </div>
      </div>

      {/* Continuous scroll of pages — plain block layout (not flex-centered) so
          overflow from zooming past 100% actually stays reachable by scrolling. */}
      <div ref={scrollRef} className="flex-1 overflow-auto px-3 py-3" onPointerDown={registerTap}>
        {Array.from({ length: numPages }, (_, i) => i + 1).map((pageNumber) => (
          <PdfPage key={pageNumber} doc={doc} pageNumber={pageNumber} zoom={zoom} registerObserver={registerObserver} />
        ))}
      </div>

      {/* Presence check — confirms someone is actually studying, not just leaving the PDF open */}
      {presenceCheck && (
        <div onClick={handleConfirmPresence} className="absolute inset-0 z-[65]" style={{ background: 'rgba(6,9,26,0.4)' }}>
          <button
            onClick={handleConfirmPresence}
            className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[70] px-5 py-3 rounded-2xl flex items-center gap-2 animate-slide-up"
            style={{ background: 'rgba(6,9,26,0.95)', border: `1px solid ${accentColor}50`, boxShadow: `0 0 24px ${accentColor}40` }}
          >
            <span className="text-white font-bold text-sm" style={{ fontFamily: "'Tajawal',sans-serif" }}>لسه بتذاكر؟ دوس هنا 👆</span>
          </button>
        </div>
      )}

      {/* Positive feedback sticker after confirming presence */}
      {confirmSticker && (
        <div className="fixed inset-0 z-[75] flex items-center justify-center pointer-events-none">
          <img src={confirmSticker} alt="sticker" className="w-40 h-40 animate-slide-up" />
        </div>
      )}
    </div>
  );
}
