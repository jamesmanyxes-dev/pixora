import React, { useEffect, useRef, useState } from 'react';
import { api, setTokens } from '../api';
import { Btn, Input, Spinner } from '../ui';
import { t } from '../i18n';
import type { User } from '../types';

declare global { interface Window { google: any } }

export function AuthScreen({ onAuth, onBanned, config }: { onAuth: (u: User, token: string, refresh: string) => void; onBanned?: (email: string) => void; config: any }) {
  const [mode, setMode] = useState<'login' | 'signup' | 'forgot'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const gref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (mode !== 'login' || !config?.googleClientId || !gref.current || !window.google) return;
    window.google.accounts.id.initialize({
      client_id: config.googleClientId,
      callback: async (resp: any) => {
        setBusy(true); setErr('');
        try {
          const d = await api.post('/auth/google', { credential: resp.credential });
          setTokens(d.token, d.refresh);
          if (d.needsOnboarding) { setMode('signup'); setStep(2); (window as any).__googleUser = d.user; }
          else onAuth(d.user, d.token, d.refresh);
        } catch (e: any) { setErr(e.code || 'google_signin_failed'); }
      },
    });
    window.google.accounts.id.renderButton(gref.current, { theme: 'filled_black', size: 'large', width: 320, text: 'continue_with' });
  }, [config, mode]);

  const finish = (d: any) => { setTokens(d.token, d.refresh); onAuth(d.user, d.token, d.refresh); };

  const submit = async () => {
    setBusy(true); setErr('');
    try {
      if (mode === 'signup') {
        if (step === 1) {
          const d = await api.post('/auth/register', { email, password, username, displayName });
          finish(d);
        } else {
          finish((window as any).__regUser);
        }
      } else if (mode === 'login') {
        const d = await api.post('/auth/login', { email, password });
        if (d.requires2fa) { setStep(2); return; }
        finish(d);
      } else if (mode === 'forgot' && step === 1) {
        const d = await api.post('/auth/forgot', { email });
        if (d.devCode) setDevCode(d.devCode);
        setStep(2);
      } else if (mode === 'forgot' && step === 2) {
        await api.post('/auth/reset', { email, code, password });
        setMode('login'); setStep(1); setErr('password_reset_ok');
      }
    } catch (e: any) {
      if (e.code === 'account_banned') { onBanned?.(email); return; }
      setErr(e.code || 'error');
    } finally { setBusy(false); }
  };

  const twoFactor = mode === 'login' && step === 2 && !devCode;
  const onboarding = mode === 'signup' && step === 2 && !!(window as any).__googleUser;
  const gu = (window as any).__googleUser;

  return (
    <div className="min-h-screen bg-neutral-950 flex flex-col items-center justify-center p-6" dir="ltr">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 mx-auto rounded-3xl bg-gradient-to-tr from-violet-600 to-pink-500 flex items-center justify-center mb-4">
            <svg viewBox="0 0 32 32" className="w-8 h-8"><circle cx="16" cy="16" r="7" fill="none" stroke="white" strokeWidth="3" /><circle cx="23" cy="9" r="2.5" fill="white" /></svg>
          </div>
          <h1 className="text-white text-2xl font-bold">Pixora</h1>
          <p className="text-neutral-500 text-sm mt-1">{mode === 'signup' ? (onboarding ? 'Finish setting up your account' : 'Create your account') : twoFactor ? 'Two-factor authentication' : 'Sign in to continue'}</p>
        </div>

        {onboarding ? (
          <div className="space-y-3">
            <p className="text-neutral-400 text-sm">Signed in as <span className="text-white">{(gu?.email) || email}</span></p>
            <PhoneStep user={gu} onComplete={async () => { const d = await api.get('/me'); finish(d); }} />
          </div>
        ) : twoFactor ? (
          <div className="space-y-3">
            <input id="reg-otp" className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2.5 text-sm text-white text-center tracking-[0.5em] outline-none focus:border-violet-500" placeholder="••••••" maxLength={8}
              onChange={e => setCode(e.target.value)} />
            <Btn className="w-full" disabled={busy} onClick={async () => { setBusy(true); try { finish(await api.post('/auth/login', { email, password, totp: code })); } catch (e: any) { setErr(e.code); } finally { setBusy(false); } }}>Verify</Btn>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              {mode === 'signup' && <>
                <input id="reg-otp" className="hidden" />
                <Input placeholder={t('username')} value={username} onChange={e => setUsername(e.target.value)} />
                <Input placeholder={t('displayName')} value={displayName} onChange={e => setDisplayName(e.target.value)} />
              </>}
              <Input placeholder={t('email')} value={email} onChange={e => setEmail(e.target.value)} type="email" />
              <Input placeholder={t('password')} value={password} onChange={e => setPassword(e.target.value)} type="password" />
              {devCode && <p className="text-amber-400 text-xs bg-amber-950/40 rounded-lg p-2">Delivery provider not configured — your code: <b>{devCode}</b></p>}
              {err === 'password_reset_ok' ? <p className="text-green-400 text-xs">Password reset. Log in.</p> : err && <p className="text-red-400 text-xs">{err.replace(/_/g, ' ')}</p>}
              <Btn className="w-full" disabled={busy} onClick={submit}>{busy ? <Spinner className="mx-auto" /> : mode === 'signup' ? t('signup') : t('login')}</Btn>
            </div>
            {mode === 'login' && config?.googleClientId && <div ref={gref} className="mt-4 flex justify-center" />}
            {mode === 'login' && !config?.googleClientId && (
              <div className="mt-4 text-center">
                <p className="text-neutral-500 text-xs mb-2">Google Sign-In activates when a Google OAuth client ID is configured (see /setup).</p>
              </div>
            )}
            <div className="flex justify-center gap-3 mt-4 text-[11px] text-neutral-600">
              <a href="#/privacy" className="hover:text-neutral-400">Privacy Policy</a>·
              <a href="#/terms" className="hover:text-neutral-400">Terms</a>·
              <a href="/downloads/pixora-v1.1.0.apk" className="text-violet-400 hover:text-violet-300">📱 Get the Android app</a>
            </div>
            <div className="flex justify-between mt-2 text-sm">
              <button className="text-neutral-400 hover:text-white" onClick={() => { setMode(mode === 'signup' ? 'login' : 'signup'); setStep(1); setErr(''); }}>
                {mode === 'signup' ? t('login') : t('signup')}
              </button>
              <button className="text-neutral-400 hover:text-white" onClick={() => { setMode('forgot'); setStep(1); setErr(''); }}>{t('forgot')}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function PhoneStep({ user, onComplete }: any) {
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [username, setUsername] = useState('');
  const [avail, setAvail] = useState<boolean | null>(null);
  const [sent, setSent] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(1);
  useEffect(() => { if (username.length >= 3) api.get(`/auth/username/check?q=${username}`).then(d => setAvail(d.available)); else setAvail(null); }, [username]);
  return (
    <>
      {step === 1 && <>
        <input id="reg-otp" className="hidden" />
        <p className="text-neutral-300 text-sm font-medium mb-2">Verify your phone</p>
        <Input placeholder="+15551234567" value={phone} onChange={e => setPhone(e.target.value)} />
        {sent ? <>
          <Input placeholder="6-digit code" value={otp} onChange={e => setOtp(e.target.value)} />
          {devCode && <p className="text-amber-400 text-xs bg-amber-950/40 rounded-lg p-2">SMS provider not configured — code: <b>{devCode}</b></p>}
          <Btn className="w-full" disabled={busy} onClick={async () => { setBusy(true); try { await api.post('/auth/phone/verify', { phone, code: otp }); setStep(2); } catch (e: any) { alert(e.code); } finally { setBusy(false); } }}>{t('verify')}</Btn>
        </> : <Btn className="w-full" disabled={busy || !phone.startsWith('+')} onClick={async () => { setBusy(true); try { const d = await api.post('/auth/phone/send', { phone }); setSent(true); if (d.devCode) setDevCode(d.devCode); } catch (e: any) { alert(e.code); } finally { setBusy(false); } }}>Send code</Btn>}
      </>}
      {step === 2 && <>
        <p className="text-neutral-300 text-sm font-medium mb-2">Choose your username</p>
        <Input placeholder="username" value={username} onChange={e => setUsername(e.target.value)} />
        {avail === true && <p className="text-green-400 text-xs">✓ available</p>}
        {avail === false && <p className="text-red-400 text-xs">✗ taken</p>}
        <Btn className="w-full mt-3" disabled={!avail || busy} onClick={async () => { setBusy(true); try { await api.post('/auth/username/set', { username }); onComplete(); } catch (e: any) { alert(e.code); } finally { setBusy(false); } }}>Create account</Btn>
      </>}
    </>
  );
}
