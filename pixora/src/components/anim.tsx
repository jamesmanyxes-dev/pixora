import React from 'react';

// ---------- Pixora logo: animated gradient + glow + float (never static) ----------
export function PixoraLogo({ onClick }: { onClick?: () => void }) {
  return (
    <button onClick={onClick} className="pixora-logo text-xl sm:text-2xl font-extrabold tracking-tight bg-clip-text text-transparent" style={{ backgroundSize: '300% 300%' }}>
      Pixora
    </button>
  );
}

// ---------- Typing indicator: three bouncing dots ----------
export function TypingDots({ name }: { name?: string }) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-neutral-400">
      {name && <span>{name}</span>}
      <span className="flex gap-1">
        {[0, 1, 2].map(i => (
          <span key={i} className="w-1.5 h-1.5 rounded-full bg-violet-400 typing-dot" style={{ animationDelay: `${i * 0.18}s` }} />
        ))}
      </span>
    </div>
  );
}

// ---------- Like burst: heart grows/shrinks pop ----------
export function LikeBurst({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <svg viewBox="0 0 24 24" className="w-28 h-28 like-burst fill-red-500 text-red-500 drop-shadow-2xl">
        <path d="M20.8 4.6a5.5 5.5 0 00-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 00-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 000-7.8z" />
      </svg>
    </div>
  );
}

// ---------- Bell shake + badge pulse ----------
export const bellShake = 'bell-shake';
export const badgePulse = 'badge-pulse';

// ---------- Feed item: fade in + slight upward motion on scroll ----------
export function FadeIn({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [shown, setShown] = React.useState(false);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(es => { if (es[0].isIntersecting) { setShown(true); io.disconnect(); } }, { threshold: 0.08 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <div ref={ref} className={`feed-fade-in ${shown ? 'shown' : ''} ${className}`}>{children}</div>;
}

// ---------- Page transition wrapper ----------
export function PageTransition({ children, pageKey }: { children: React.ReactNode; pageKey: string }) {
  return <div key={pageKey} className="page-enter">{children}</div>;
}
