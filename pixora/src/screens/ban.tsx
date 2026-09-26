import React, { useEffect, useRef, useState } from 'react';
import { ShieldOff, Send } from 'lucide-react';

// Coin celebration: rolling coin → ✓ pops in → confetti splash from the sides
function UnbanCelebration({ onDone }: { onDone: () => void }) {
  const [stage, setStage] = useState<'rolling' | 'check' | 'confetti'>('rolling');
  useEffect(() => {
    const t1 = setTimeout(() => setStage('check'), 2600);
    const t2 = setTimeout(() => setStage('confetti'), 3200);
    const t3 = setTimeout(onDone, 5200);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, []);
  const pieces = React.useMemo(() => Array.from({ length: 36 }, (_, i) => ({
    left: 20 + Math.random() * 60,
    delay: Math.random() * 0.5,
    dur: 1.2 + Math.random() * 1.2,
    size: 5 + Math.random() * 6,
    color: ['#f43f5e', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#a855f7', '#ec4899', '#14b8a6'][i % 8],
    dx: (Math.random() - 0.5) * 220,
    rot: Math.random() * 720 - 360,
  })), []);
  return (
    <div className="fixed inset-0 z-[85] bg-neutral-950/95 backdrop-blur flex flex-col items-center justify-center">
      {/* confetti burst */}
      {stage !== 'rolling' && pieces.map((p, i) => (
        <span key={i} className="absolute rounded-sm" style={{
          left: `${p.left}%`, top: '46%', width: p.size, height: p.size, background: p.color,
          animation: `confetti ${p.dur}s ${p.delay}s ease-out forwards`,
          ['--dx' as any]: `${p.dx}px`, ['--rot' as any]: `${p.rot}deg`,
        }} />
      ))}
      {/* coin */}
      <div className={stage === 'rolling' ? 'coin-roll' : 'coin-stop'}>
        <div className="w-28 h-28 rounded-full bg-gradient-to-br from-emerald-400 via-green-500 to-emerald-600 shadow-[0_0_60px_rgba(34,197,94,0.5)] flex items-center justify-center border-4 border-emerald-300/60">
          {stage !== 'rolling' && (
            <svg viewBox="0 0 24 24" className="w-14 h-14 text-white check-pop" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6L9 17l-5-5" />
            </svg>
          )}
        </div>
      </div>
      <h1 className="text-white text-2xl font-bold mt-8">You're back!</h1>
      <p className="text-neutral-400 text-sm mt-2">Your ban was lifted. Log in to continue.</p>
    </div>
  );
}

// Full-screen ban gate. Shown when the account is banned (login rejected,
// session revoked, or a live ban push arrives). Offers "Request review".
export function BanScreen({ email, reason, onLogout }: { email: string; reason?: string | null; onLogout: () => void }) {
  const [phase, setPhase] = useState<'idle' | 'requesting' | 'requested' | 'error'>('idle');
  const [checked, setChecked] = useState(false);
  const [message, setMessage] = useState('');

  const [celebrating, setCelebrating] = useState(false);
  useEffect(() => {
    if (!email) return;
    // if an appeal is already pending/reviewed for this email, reflect it
    fetch(`/api/auth/appeal-status?email=${encodeURIComponent(email)}`)
      .then(r => r.json())
      .then(d => {
        if (d.status === 'pending' || d.status === 'reviewing') setPhase('requested');
        setChecked(true);
      })
      .catch(() => setChecked(true));
    // poll account status: the moment the ban is lifted, celebrate
    const iv = setInterval(async () => {
      try {
        const r = await fetch(`/api/auth/ban-status?email=${encodeURIComponent(email)}`);
        const d = await r.json();
        if (d.active) { clearInterval(iv); setCelebrating(true); }
      } catch {}
    }, 5000);
    return () => clearInterval(iv);
  }, [email]);
  if (celebrating) return <UnbanCelebration onDone={() => { onLogout(); }} />;

  const requestReview = async () => {
    setPhase('requesting');
    try {
      const r = await fetch('/api/auth/appeal', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, message: 'Requesting review of my account ban.' }),
      });
      if (!r.ok) throw new Error('failed');
      setPhase('requested');
    } catch {
      setPhase('error');
    }
  };

  return (
    <div className="min-h-screen bg-neutral-950 flex items-center justify-center p-6" dir="ltr">
      <div className="max-w-sm w-full text-center">
        <div className="w-20 h-20 mx-auto rounded-3xl bg-red-950 border border-red-900 flex items-center justify-center mb-6">
          <ShieldOff size={36} className="text-red-500" />
        </div>
        <h1 className="text-white text-2xl font-bold mb-2">You can no longer use Pixora</h1>
        <p className="text-neutral-400 text-sm mb-1">
          Your account{email ? ` (${email})` : ''} has been banned for violating our community guidelines.
        </p>
        {reason && <p className="text-neutral-500 text-xs mb-1">Reason: {reason}</p>}
        <p className="text-neutral-500 text-xs mb-8">If you believe this is a mistake, you can request a review.</p>

        {phase === 'requested' ? (
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl px-4 py-4 text-sm text-neutral-300">
            <span className="inline-flex items-center gap-2 text-neutral-400">
              <span className="w-4 h-4 border-2 border-neutral-600 border-t-white rounded-full animate-spin inline-block" />
              Requesting review…
            </span>
            <p className="text-neutral-500 text-xs mt-2">Our team will look at your appeal. You'll be able to use Pixora again if it's overturned.</p>
          </div>
        ) : (
          <button
            onClick={requestReview}
            disabled={phase === 'requesting'}
            className="w-full py-3 rounded-2xl bg-white text-black font-semibold text-sm hover:bg-neutral-200 transition disabled:opacity-50"
          >
            {phase === 'requesting' ? (
              <span className="inline-flex items-center gap-2 justify-center">
                <span className="w-4 h-4 border-2 border-neutral-400 border-t-black rounded-full animate-spin inline-block" />
                Requesting review…
              </span>
            ) : 'Request review'}
          </button>
        )}
        {phase === 'error' && <p className="text-red-400 text-xs mt-3">Could not submit request. Try again.</p>}
        <button onClick={onLogout} className="mt-4 text-neutral-500 text-xs hover:text-neutral-300">Return to login</button>
      </div>
    </div>
  );
}

// Full-screen suspension notice (less severe than ban)
export function SuspendedScreen({ reason }: { reason?: string | null }) {
  return (
    <div className="min-h-screen bg-neutral-950 flex items-center justify-center p-6">
      <div className="max-w-sm w-full text-center">
        <div className="w-20 h-20 mx-auto rounded-3xl bg-amber-950 border border-amber-900 flex items-center justify-center mb-6">
          <ShieldOff size={36} className="text-amber-500" />
        </div>
        <h1 className="text-white text-2xl font-bold mb-2">Account suspended</h1>
        <p className="text-neutral-400 text-sm">{reason || 'Your account is currently suspended.'}</p>
      </div>
    </div>
  );
}
