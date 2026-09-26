import React, { useEffect, useState } from 'react';
import { Heart, MessageCircle, UserPlus, AtSign, Repeat2, Bell, Settings as Cog, ShieldCheck, Download, Trash2, LogOut, KeyRound, Mail, Smartphone, Globe, Check, X, Video, Mic, PhoneOff, Store, Crown, BadgeCheck, Radio, Users, Wallet, Megaphone, BarChart3, Phone } from 'lucide-react';
import { api } from '../api';
import { Avatar, Btn, Input, Modal, Spinner, fmt, timeAgo } from '../ui';
import { t, setLang, getLang, type Lang } from '../i18n';

import type { User, Post } from '../types';
import { CallHistory } from './calls';
import { Shield as ShieldIcon } from 'lucide-react';
import { OwnerTools } from './ownertools';

export function Notifications({ me, onProfile, onOpenPost }: { me: User; onProfile: (u: string) => void; onOpenPost: (id: string) => void }) {
  const [items, setItems] = useState<any[]>([]);
  const [requests, setRequests] = useState<any[]>([]);
  useEffect(() => {
    api.get('/notifications').then(d => setItems(d.notifications));
    api.get('/follow/requests').then(d => setRequests(d.requests));
  }, []);
  const icon = { like: Heart, comment: MessageCircle, reply: MessageCircle, follow: UserPlus, follow_request: UserPlus, mention: AtSign, repost: Repeat2, message: MessageCircle, story_reply: MessageCircle, tip: Wallet, subscribe: Crown, order: Store } as any;
  return (
    <div className="pb-24 max-w-xl mx-auto">
      <h1 className="text-white font-bold text-xl p-4">{t('notifications')}</h1>
      {requests.length > 0 && (
        <div className="mx-4 mb-4 bg-neutral-900 rounded-2xl p-4">
          <h3 className="text-white text-sm font-semibold mb-3">Follow requests</h3>
          {requests.map(u => (
            <div key={u.id} className="flex items-center gap-3 py-2">
              <Avatar src={u.avatarUrl} size={36} />
              <button className="flex-1 text-left text-white text-sm" onClick={() => onProfile(u.username)}>{u.username}</button>
              <Btn className="!px-3 !py-1.5 text-xs" onClick={async () => { await api.post(`/follow/requests/${u.id}`, { accept: true }); setRequests(rs => rs.filter(r => r.id !== u.id)); }}><Check size={14} /></Btn>
              <Btn variant="ghost" className="!px-3 !py-1.5 text-xs" onClick={async () => { await api.post(`/follow/requests/${u.id}`, { accept: false }); setRequests(rs => rs.filter(r => r.id !== u.id)); }}><X size={14} /></Btn>
            </div>
          ))}
        </div>
      )}
      <div className="divide-y divide-neutral-900">
        {items.map(n => {
          const Icon = icon[n.type] || Bell;
          return (
            <button key={n.id} className={`flex items-center gap-3 w-full px-4 py-3 text-left hover:bg-neutral-900/50 ${!n.read ? 'bg-violet-950/20' : ''}`}
              onClick={() => { api.post('/notifications/read', { id: n.id }); if (n.entityType === 'post' || n.entityType === 'story') onOpenPost(n.entityId); else if (n.actor) onProfile(n.actor.username); }}>
              {n.actor ? <Avatar src={n.actor.avatarUrl} size={40} /> : <div className="w-10 h-10 rounded-full bg-neutral-800 flex items-center justify-center"><Icon size={18} className="text-white" /></div>}
              <Icon size={16} className="text-violet-400 shrink-0" />
              <p className="text-sm text-neutral-300 flex-1">
                {n.actor && <button className="text-white font-semibold" onClick={e => { e.stopPropagation(); onProfile(n.actor.username); }}>{n.actor.username} </button>}
                {n.type.replace('_', ' ')} {n.body ? <span className="text-neutral-500">· {n.body}</span> : null}
              </p>
              <span className="text-neutral-600 text-xs">{timeAgo(n.createdAt)}</span>
            </button>
          );
        })}
        {!items.length && <p className="text-center text-neutral-500 text-sm py-16">No notifications yet</p>}
      </div>
    </div>
  );
}

export function Settings({ me, onUser, onLogout, toast }: any) {
  const [section, setSection] = useState<string>('account');
  const [sessions, setSessions] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [totp, setTotp] = useState<any>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [verif, setVerif] = useState<any>(null);
  const s = me.settings || {};
  const setSetting = (k: string, v2: any) => { const ns = { ...s, [k]: v2 }; onUser({ ...me, settings: ns }); api.patch('/me', { settings: ns }); };
  const loadSec = () => { api.get('/security/sessions').then(d => setSessions(d.sessions)); api.get('/security/login-history').then(d => setHistory(d.history)); };
  useEffect(() => { if (section === 'security') loadSec(); if (section === 'verification') api.get('/verification/status').then(d => setVerif(d.request)); }, [section]);

  const sections = [
    ['account', 'Account', Cog], ['privacy', 'Privacy', LockIcon], ['notifications', 'Notifications', Bell],
    ['security', 'Security', ShieldCheck], ['creator', 'Creator studio', BarChart3], ['business', 'Business', Store],
    ['monetization', 'Monetization', Wallet], ['marketplace', 'Marketplace', Store], ['communities', 'Communities', Users],
    ['ads', 'Advertise', Megaphone], ['live', 'Live', Radio], ['calls', 'Calls', Phone], ['ownertools', 'Owner tools', ShieldIcon], ['verification', 'Verification', BadgeCheck],
    ['data', 'Data & privacy', Download], ['appearance', 'Appearance & language', Globe],
  ] as const;

  return (
    <div className="pb-24 max-w-xl mx-auto">
      <h1 className="text-white font-bold text-xl p-4">{t('settings')}</h1>
      <div className="flex gap-2 px-4 overflow-x-auto no-scrollbar pb-3">
        {sections.map(([k, label, Icon]) => (
          <button key={k} onClick={() => setSection(k)} className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ${section === k ? 'bg-white text-black' : 'bg-neutral-900 text-neutral-400'}`}>
            <Icon size={13} />{label}
          </button>
        ))}
      </div>
      <div className="px-4 space-y-3">
        {section === 'account' && <AccountSection me={me} onUser={onUser} toast={toast} />}
        {section === 'privacy' && <PrivacySection me={me} onUser={onUser} />}
        {section === 'notifications' && <NotifPrefs s={s} setSetting={setSetting} />}
        {section === 'security' && (
          <>
            <Row label="Two-factor authentication">
              {me.twoFactorEnabled ? <Btn variant="danger" className="text-xs" onClick={async () => { await api.post('/security/2fa/disable'); onUser({ ...me, twoFactorEnabled: false }); }}>Disable 2FA</Btn>
                : <Btn className="text-xs" onClick={async () => setTotp(await api.post('/security/2fa/setup'))}>Enable 2FA</Btn>}
            </Row>
            <Row label="Revoke all other sessions"><Btn variant="ghost" className="text-xs" onClick={async () => { await api.post('/security/sessions/revoke-all'); loadSec(); }}>Revoke</Btn></Row>
            <div className="bg-neutral-900 rounded-2xl p-4">
              <h3 className="text-white text-sm font-semibold mb-2">Active sessions</h3>
              {sessions.map(x => <div key={x.id} className="flex items-center justify-between py-1.5 text-xs text-neutral-400">
                <span>{x.device?.slice(0, 40) || 'Unknown'}{x.current && ' (this device)'}</span>
                {!x.current && <button className="text-red-400" onClick={async () => { await api.post('/security/sessions/revoke', { id: x.id }); loadSec(); }}>revoke</button>}
              </div>)}
              <h3 className="text-white text-sm font-semibold mt-4 mb-2">Login history</h3>
              {history.slice(0, 10).map((h, i) => <div key={i} className="flex justify-between text-xs text-neutral-500 py-1"><span>{h.method} {h.success ? '✓' : '✗'} · {h.ip}</span><span>{timeAgo(h.created_at)}</span></div>)}
            </div>
            <TotpModal totp={totp} onClose={() => setTotp(null)} onEnabled={(codes: string[]) => { setTotp(null); setBackupCodes(codes); onUser({ ...me, twoFactorEnabled: true }); }} toast={toast} />
            <Modal open={!!backupCodes.length} onClose={() => setBackupCodes([])} title="Backup codes — save these now">
              <div className="grid grid-cols-2 gap-2">{backupCodes.map(c => <code key={c} className="bg-neutral-800 text-white rounded px-2 py-1 text-center text-xs">{c}</code>)}</div>
            </Modal>
          </>
        )}
        {section === 'creator' && <CreatorDashboard me={me} />}
        {section === 'business' && <BusinessSection me={me} onUser={onUser} />}
        {section === 'monetization' && <Monetization me={me} toast={toast} />}
        {section === 'marketplace' && <Marketplace me={me} toast={toast} />}
        {section === 'communities' && <Communities me={me} toast={toast} />}
        {section === 'ads' && <Ads me={me} toast={toast} />}
        {section === 'live' && <LiveSection me={me} toast={toast} />}
        {section === 'calls' && <CallHistory />}
        {section === 'ownertools' && (me.isOwner
    ? <OwnerTools me={me} toast={toast} />
    : <div className="bg-neutral-900 rounded-2xl p-4 text-sm text-neutral-400">Owner-only section. Ask the platform owner for access.</div>)}
        {section === 'verification' && <Verification me={me} verif={verif} setVerif={setVerif} toast={toast} />}
        {section === 'data' && <DataSection me={me} onLogout={onLogout} toast={toast} />}
        {section === 'appearance' && <Appearance me={me} onUser={onUser} />}
        <Row label={t('logOut')}><Btn variant="danger" className="text-xs" onClick={onLogout}>{t('logOut')}</Btn></Row>
      </div>
    </div>
  );
}

const Row = ({ label, children }: { label: any; children: React.ReactNode }) => (
  <div className="flex items-center justify-between bg-neutral-900 rounded-2xl px-4 py-3">
    <span className="text-white text-sm">{label}</span>{children}
  </div>
);
const LockIcon = (p: any) => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0110 0v4" /></svg>;
const Toggle = ({ on, set }: { on: boolean; set: (v: boolean) => void }) => (
  <button onClick={() => set(!on)} className={`w-10 h-6 rounded-full transition relative ${on ? 'bg-violet-600' : 'bg-neutral-700'}`}>
    <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${on ? 'left-4.5' : 'left-0.5'}`} style={{ left: on ? 18 : 2 }} />
  </button>
);

function AccountSection({ me, onUser, toast }: any) {
  const [username, setUsername] = useState(me.username);
  const [avail, setAvail] = useState<boolean | null>(null);
  useEffect(() => { if (username !== me.username) api.get(`/auth/username/check?q=${username}`).then(d => setAvail(d.available)); else setAvail(null); }, [username]);
  return (
    <>
      <div className="bg-neutral-900 rounded-2xl p-4 space-y-3">
        <div className="flex gap-2">
          <Input value={username} onChange={e => setUsername(e.target.value)} />
          <Btn className="text-xs shrink-0" disabled={username === me.username || avail === false} onClick={async () => { const d = await api.post('/me/change-username', { username }); onUser(d.user); toast('username_updated'); }}>{t('username')}</Btn>
        </div>
        {avail === false && <p className="text-red-400 text-xs">Username taken</p>}
      </div>
      <ChangeFlow label="Change email" icon={Mail} request={async (v2: string) => api.post('/me/change-email', { email: v2 })} verify={async (v2: string, code: string) => (await api.post('/me/change-email', { email: v2, code })).user} onUser={onUser} toast={toast} placeholder="new@email.com" />
      <ChangeFlow label="Change phone" icon={Smartphone} request={async (v2: string) => api.post('/me/change-phone', { phone: v2 })} verify={async (v2: string, code: string) => (await api.post('/me/change-phone', { phone: v2, code })).user} onUser={onUser} toast={toast} placeholder="+15551234567" />
      <PasswordChange toast={toast} />
    </>
  );
}

function ChangeFlow({ label, icon: Icon, request, verify, onUser, toast, placeholder }: any) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState(1);
  return (
    <>
      <Row label={label}><Btn variant="ghost" className="text-xs" onClick={() => { setOpen(true); setStep(1); }}><Icon size={14} /></Btn></Row>
      <Modal open={open} onClose={() => setOpen(false)} title={label}>
        {step === 1 ? <>
          <Input placeholder={placeholder} value={val} onChange={e => setVal(e.target.value)} className="mb-3" />
          <Btn className="w-full" onClick={async () => { const d = await request(val); if (d.devCode) { toast(`dev code: ${d.devCode}`); } setStep(2); }}>Send code</Btn>
        </> : <>
          <Input placeholder={t('enterCode')} value={code} onChange={e => setCode(e.target.value)} className="mb-3" />
          <Btn className="w-full" onClick={async () => { try { const u = await verify(val, code); onUser(u); setOpen(false); toast('updated'); } catch (e: any) { toast(e.code); } }}>{t('verify')}</Btn>
        </>}
      </Modal>
    </>
  );
}

function PasswordChange({ toast }: any) {
  const [cur, setCur] = useState(''); const [next, setNext] = useState('');
  return <div className="bg-neutral-900 rounded-2xl p-4 space-y-2">
    <Input type="password" placeholder="Current password" value={cur} onChange={e => setCur(e.target.value)} />
    <Input type="password" placeholder="New password" value={next} onChange={e => setNext(e.target.value)} />
    <Btn className="w-full text-xs" onClick={async () => { try { await api.post('/me/change-password', { current: cur, next }); toast('password_changed'); setCur(''); setNext(''); } catch (e: any) { toast(e.code); } }}>Change password</Btn>
  </div>;
}

function TotpModal({ totp, onClose, onEnabled, toast }: any) {
  const [code, setCode] = useState('');
  if (!totp) return null;
  return (
    <Modal open onClose={onClose} title="Set up 2FA">
      <p className="text-neutral-400 text-sm mb-2">Scan this with your authenticator app:</p>
      <code className="block bg-neutral-800 text-white rounded-lg p-3 text-xs break-all mb-3">{totp.otpauth}</code>
      <Input placeholder="6-digit code" value={code} onChange={e => setCode(e.target.value)} className="mb-3" />
      <Btn className="w-full" onClick={async () => { try { const d = await api.post('/security/2fa/enable', { code }); onEnabled(d.backupCodes); } catch (e: any) { toast(e.code); } }}>Enable</Btn>
    </Modal>
  );
}

function PrivacySection({ me, onUser }: any) {
  const set = (k: string, v2: any) => { onUser({ ...me, [k]: v2 }); api.patch('/me', { [k]: v2 }); };
  const ns = me.settings || {};
  const setN = (k: string, v2: any) => { onUser({ ...me, settings: { ...ns, [k]: v2 } }); api.patch('/me', { settings: { ...ns, [k]: v2 } }); };
  return (
    <>
      <Row label="Private account"><Toggle on={!!me.isPrivate} set={x => set('isPrivate', x)} /></Row>
      <Row label="Business account"><Toggle on={!!me.isBusiness} set={x => set('isBusiness', x)} /></Row>
      <div className="bg-neutral-900 rounded-2xl p-4 space-y-3">
        {['who_can_message', 'who_can_follow', 'who_can_tag', 'who_can_mention'].map(k => (
          <div key={k} className="flex items-center justify-between">
            <span className="text-neutral-300 text-sm capitalize">{k.replace(/_/g, ' ')}</span>
            <select value={ns[k] || 'everyone'} onChange={e => setN(k, e.target.value)} className="bg-neutral-800 text-white text-sm rounded-lg px-2 py-1.5">
              <option value="everyone">Everyone</option><option value="followers">Followers</option><option value="nobody">Nobody</option>
            </select>
          </div>
        ))}
      </div>
    </>
  );
}

function NotifPrefs({ s, setSetting }: any) {
  const prefs = s.notify || {};
  return <div className="bg-neutral-900 rounded-2xl p-4 space-y-3">
    {['likes', 'comments', 'messages', 'mentions', 'reposts', 'stories'].map(k => (
      <div key={k} className="flex items-center justify-between">
        <span className="text-neutral-300 text-sm capitalize">{k}</span>
        <Toggle on={prefs[k] !== false} set={x => setSetting('notify', { ...prefs, [k]: x })} />
      </div>
    ))}
  </div>;
}

function Appearance({ me, onUser }: any) {
  return <div className="bg-neutral-900 rounded-2xl p-4 space-y-3">
    <div>
      <span className="text-neutral-300 text-sm">{t('language')}</span>
      <div className="flex gap-2 mt-2 flex-wrap">
        {(['en', 'fr', 'es', 'ar', 'pt'] as Lang[]).map(l => (
          <button key={l} onClick={() => { setLang(l); location.reload(); }} className={`px-3 py-1.5 rounded-full text-xs uppercase ${me.language === l ? 'bg-white text-black' : 'bg-neutral-800 text-neutral-300'}`}>{l}</button>
        ))}
      </div>
    </div>
    <div>
      <span className="text-neutral-300 text-sm">{t('theme')}</span>
      <div className="flex gap-2 mt-2">
        {['system', 'dark', 'light'].map(th => <button key={th} onClick={() => { onUser({ ...me, theme: th }); api.patch('/me', { theme: th }); }} className={`px-3 py-1.5 rounded-full text-xs capitalize ${me.theme === th ? 'bg-white text-black' : 'bg-neutral-800 text-neutral-300'}`}>{th}</button>)}
      </div>
    </div>
  </div>;
}

function DataSection({ me, onLogout, toast }: any) {
  return (
    <>
      <Row label="Download my data"><a href="#" onClick={async e => { e.preventDefault(); const d = await api.get('/me/export'); const blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'pixora-data.json'; a.click(); }}><Btn variant="ghost" className="text-xs"><Download size={14} /></Btn></a></Row>
      <Row label="Deactivate account"><Btn variant="ghost" className="text-xs" onClick={async () => { if (!confirm('Deactivate your account?')) return; await api.post('/me/deactivate'); onLogout(); }}>Deactivate</Btn></Row>
      <Row label={<span className="text-red-400">Delete account permanently</span>}>
        <Btn variant="danger" className="text-xs" onClick={async () => { if (!confirm('Permanently delete your account and all data? This cannot be undone.')) return; await api.del('/me'); onLogout(); }}><Trash2 size={14} /></Btn>
      </Row>
    </>
  );
}

function Verification({ me, verif, setVerif, toast }: any) {
  return (
    <div className="bg-neutral-900 rounded-2xl p-4 space-y-3">
      {me.isVerified ? <p className="text-white text-sm flex items-center gap-2"><BadgeCheck size={16} className="text-sky-400" /> Your account is verified</p>
        : verif?.status === 'pending' ? <p className="text-neutral-400 text-sm">Verification request under review</p>
          : <RequestVerification setVerif={setVerif} toast={toast} />}
      {verif?.status === 'rejected' && <p className="text-red-400 text-sm">Previous request rejected: {verif.review_note}</p>}
    </div>
  );
}
function RequestVerification({ setVerif, toast }: any) {
  const [fullName, setFullName] = useState(''); const [category, setCategory] = useState('creator'); const [links, setLinks] = useState('');
  return <>
    <Input placeholder="Full legal name" value={fullName} onChange={e => setFullName(e.target.value)} />
    <select value={category} onChange={e => setCategory(e.target.value)} className="w-full bg-neutral-800 text-white text-sm rounded-lg px-3 py-2.5">
      <option value="creator">Creator</option><option value="business">Business</option><option value="public_figure">Public figure</option><option value="brand">Brand</option>
    </select>
    <Input placeholder="Proof links (comma separated)" value={links} onChange={e => setLinks(e.target.value)} />
    <Btn className="w-full text-xs" onClick={async () => { try { await api.post('/verification/request', { fullName, category, links: links.split(',').filter(Boolean) }); setVerif({ status: 'pending' }); toast('request_submitted'); } catch (e: any) { toast(e.code); } }}>Request verification</Btn>
  </>;
}

function CreatorDashboard({ me }: any) {
  const [d, setD] = useState<any>(null);
  useEffect(() => { api.get('/creator/dashboard').then(setD); }, []);
  if (!d) return <Spinner className="mx-auto my-8" />;
  return <div className="space-y-3">
    <div className="grid grid-cols-3 gap-2">
      <Stat label="Subscribers" value={d.subscribers} />
      <Stat label="Engagement" value={fmt(d.engagement)} />
      <Stat label="Impressions" value={fmt(d.impressions)} />
    </div>
    <div className="bg-neutral-900 rounded-2xl p-4">
      <h3 className="text-white text-sm font-semibold mb-2">Follower growth (30d)</h3>
      <Bars data={d.followerGrowth} />
    </div>
    <div className="bg-neutral-900 rounded-2xl p-4">
      <h3 className="text-white text-sm font-semibold mb-2">Audience active hours</h3>
      <div className="flex gap-1 items-end h-16">{d.activeHours.map((a: any) => <div key={a.hour} className="flex-1 bg-violet-600 rounded-t" style={{ height: `${Math.min(100, a.count * 8)}%` }} title={`${a.hour}:00`} />)}</div>
    </div>
    <div className="bg-neutral-900 rounded-2xl p-4">
      <h3 className="text-white text-sm font-semibold mb-2">Post performance</h3>
      {d.posts.slice(0, 8).map((p: any) => <div key={p.id} className="flex justify-between text-xs text-neutral-400 py-1.5 border-b border-neutral-800 last:border-0">
        <span className="truncate max-w-[50%]">{p.caption || '(media)'}</span>
        <span>❤ {fmt(p.likes)} · 💬 {fmt(p.comments)} · 👁 {fmt(p.views)}</span>
      </div>)}
    </div>
  </div>;
}

function Stat({ label, value }: any) {
  return <div className="bg-neutral-900 rounded-2xl p-3 text-center"><div className="text-white font-bold text-lg">{value}</div><div className="text-neutral-500 text-[11px]">{label}</div></div>;
}
function Bars({ data }: any) {
  const max = Math.max(1, ...data.map((x: any) => x.count));
  return <div className="flex gap-1 items-end h-16">{data.length ? data.map((x: any, i: number) => <div key={i} className="flex-1 bg-violet-600 rounded-t" style={{ height: `${(x.count / max) * 100}%` }} />) : <p className="text-neutral-500 text-xs">No data yet</p>}</div>;
}

function BusinessSection({ me, onUser }: any) {
  const [category, setCategory] = useState(me.businessCategory || '');
  const [contact, setContact] = useState('');
  const [hours, setHours] = useState('');
  const [dash, setDash] = useState<any>(null);
  useEffect(() => { if (me.isBusiness) api.get('/business/dashboard').then(setDash); }, [me.isBusiness]);
  return <>
    <div className="bg-neutral-900 rounded-2xl p-4 space-y-2">
      <Input placeholder="Business category" value={category} onChange={e => setCategory(e.target.value)} />
      <Input placeholder="Contact info" value={contact} onChange={e => setContact(e.target.value)} />
      <Input placeholder="Business hours" value={hours} onChange={e => setHours(e.target.value)} />
      <Btn className="w-full text-xs" onClick={async () => { const d = await api.post('/me/business', { category, contact, hours, business: true }); onUser(d.user); }}>{t('send')}</Btn>
    </div>
    {dash && <div className="bg-neutral-900 rounded-2xl p-4">
      <h3 className="text-white text-sm font-semibold mb-2">Business insights</h3>
      <div className="grid grid-cols-3 gap-2 mb-3">
        <Stat label="Reach" value={fmt(dash.reach)} /><Stat label="Impressions" value={fmt(dash.impressions)} /><Stat label="Posts" value={dash.posts.length} />
      </div>
      <Bars data={dash.followerGrowth} />
    </div>}
  </>;
}

function Monetization({ me, toast }: any) {
  const [w, setW] = useState<any>(null);
  useEffect(() => { api.get('/wallet').then(setW); }, []);
  if (!w) return null;
  return <>
    <div className="grid grid-cols-2 gap-2">
      <Stat label="Balance" value={`$${(w.wallet.balance_cents / 100).toFixed(2)}`} />
      <Stat label="Lifetime" value={`$${(w.wallet.lifetime_cents / 100).toFixed(2)}`} />
    </div>
    <div className="bg-neutral-900 rounded-2xl p-4">
      <h3 className="text-white text-sm font-semibold mb-2">Tips received</h3>
      {w.tips.length ? w.tips.map((tp: any, i: number) => <div key={i} className="flex justify-between text-xs text-neutral-400 py-1.5"><span>@{tp.from.username}{tp.note ? `: ${tp.note}` : ''}</span><span className="text-green-400">+${(tp.amountCents / 100).toFixed(2)}</span></div>) : <p className="text-neutral-500 text-xs">No tips yet</p>}
      <p className="text-neutral-600 text-[11px] mt-2">Tip and subscription payments settle via the ledger. Connect Stripe keys to charge real cards.</p>
    </div>
  </>;
}

function Marketplace({ me, toast }: any) {
  const [products, setProducts] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const load = () => api.get('/marketplace').then(d => setProducts(d.products));
  useEffect(() => { load(); }, []);
  return <>
    <Row label="Sell a product"><Btn className="text-xs" onClick={() => setOpen(true)}><Store size={14} /></Btn></Row>
    <div className="space-y-2">{products.map((p: any) => (
      <div key={p.id} className="bg-neutral-900 rounded-2xl p-4">
        <div className="flex justify-between"><div><div className="text-white text-sm font-semibold">{p.title}</div><div className="text-neutral-500 text-xs">@{p.seller.username}</div></div><div className="text-white font-bold">${(p.priceCents / 100).toFixed(2)}</div></div>
        {p.description && <p className="text-neutral-400 text-xs mt-1">{p.description}</p>}
        <Btn variant="ghost" className="mt-2 text-xs" onClick={async () => { const d = await api.post(`/marketplace/products/${p.id}/buy`); toast(d.providerConfigured ? 'order_pending_payment' : 'order_placed'); }}>Buy</Btn>
      </div>))}
    </div>
    <ProductModal open={open} onClose={() => setOpen(false)} onDone={() => { setOpen(false); load(); }} toast={toast} />
  </>;
}
function ProductModal({ open, onClose, onDone, toast }: any) {
  const [title, setTitle] = useState(''); const [desc, setDesc] = useState(''); const [price, setPrice] = useState(''); const [kind, setKind] = useState('physical'); const [media, setMedia] = useState<string[]>([]);
  return (
    <Modal open={open} onClose={onClose} title="New product">
      <Input placeholder="Title" value={title} onChange={e => setTitle(e.target.value)} className="mb-2" />
      <textarea placeholder="Description" rows={2} value={desc} onChange={e => setDesc(e.target.value)} className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-violet-500 resize-none mb-2" />
      <Input placeholder="Price (USD)" value={price} onChange={e => setPrice(e.target.value)} className="mb-2" />
      <select value={kind} onChange={e => setKind(e.target.value)} className="w-full bg-neutral-800 text-white text-sm rounded-lg px-3 py-2.5 mb-2">
        <option value="physical">Physical</option><option value="digital">Digital</option>
      </select>
      <label className="block text-neutral-400 text-sm mb-3 cursor-pointer">Images<input type="file" multiple accept="image/*" hidden onChange={async e => {
        const ids: string[] = [];
        for (const f of e.target.files!) { const fd = new FormData(); fd.append('file', f); const d = await api.upload('/media/upload', fd); ids.push(d.ids[0]); }
        setMedia(ids);
      }} /></label>
      {media.length > 0 && <p className="text-neutral-500 text-xs mb-2">{media.length} image(s)</p>}
      <Btn className="w-full" onClick={async () => { try { await api.post('/marketplace/products', { title, description: desc, priceUsd: Number(price), kind, mediaUrls: media }); onDone(); } catch (e: any) { toast(e.code); } }}>List product</Btn>
    </Modal>
  );
}

function Communities({ me, toast }: any) {
  const [list, setList] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(''); const [desc, setDesc] = useState('');
  const load = () => api.get('/communities').then(d => setList(d.communities));
  useEffect(() => { load(); }, []);
  return <>
    <Row label="Create community"><Btn className="text-xs" onClick={() => setOpen(true)}><Users size={14} /></Btn></Row>
    <div className="space-y-2">{list.map((c: any) => (
      <div key={c.id} className="bg-neutral-900 rounded-2xl p-4">
        <div className="flex justify-between items-center"><div><div className="text-white text-sm font-semibold">{c.name}</div><div className="text-neutral-500 text-xs">{fmt(c.member_count)} members · @{c.owner_username}</div></div>
          <Btn variant="ghost" className="text-xs" onClick={async () => { const d = await api.post(`/communities/${c.id}/join`); load(); }}>{c.joined ? 'Leave' : 'Join'}</Btn></div>
        {c.description && <p className="text-neutral-400 text-xs mt-1">{c.description}</p>}
      </div>))}
    </div>
    <Modal open={open} onClose={() => setOpen(false)} title="New community">
      <Input placeholder="Name" value={name} onChange={e => setName(e.target.value)} className="mb-2" />
      <Input placeholder="Description" value={desc} onChange={e => setDesc(e.target.value)} className="mb-3" />
      <Btn className="w-full" onClick={async () => { await api.post('/communities', { name, description: desc }); setOpen(false); load(); }}>Create</Btn>
    </Modal>
  </>;
}

function Ads({ me, toast }: any) {
  const [mine, setMine] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const load = () => api.get('/ads/campaigns').then(d => setMine(d.campaigns));
  useEffect(() => { load(); }, []);
  return <>
    <Row label="Create ad campaign"><Btn className="text-xs" onClick={() => setOpen(true)}><Megaphone size={14} /></Btn></Row>
    <div className="space-y-2">{mine.map((c: any) => (
      <div key={c.id} className="bg-neutral-900 rounded-2xl p-4">
        <div className="flex justify-between"><span className="text-white text-sm font-semibold">{c.name}</span><span className={`text-xs rounded-full px-2 py-0.5 ${c.status === 'approved' ? 'bg-green-900 text-green-300' : c.status === 'pending' ? 'bg-yellow-900 text-yellow-300' : 'bg-red-900 text-red-300'}`}>{c.status}</span></div>
        <div className="text-neutral-500 text-xs mt-1">{c.headline} · budget ${(c.daily_budget_cents / 100).toFixed(2)}/day · {c.impressions} impressions · {c.clicks} clicks</div>
      </div>))}
    </div>
    <Modal open={open} onClose={() => setOpen(false)} title="New campaign">
      <Input placeholder="Campaign name" value="" onChange={() => {}} className="mb-2 hidden" />
      <CampaignForm onDone={() => { setOpen(false); load(); }} toast={toast} />
    </Modal>
  </>;
}
function CampaignForm({ onDone, toast }: any) {
  const [name, setName] = useState(''); const [headline, setHeadline] = useState(''); const [body, setBody] = useState(''); const [budget, setBudget] = useState('10'); const [interests, setInterests] = useState('');
  return <>
    <Input placeholder="Campaign name" value={name} onChange={e => setName(e.target.value)} className="mb-2" />
    <Input placeholder="Headline" value={headline} onChange={e => setHeadline(e.target.value)} className="mb-2" />
    <Input placeholder="Body" value={body} onChange={e => setBody(e.target.value)} className="mb-2" />
    <Input placeholder="Daily budget USD" value={budget} onChange={e => setBudget(e.target.value)} className="mb-2" />
    <Input placeholder="Target interests (comma sep)" value={interests} onChange={e => setInterests(e.target.value)} className="mb-3" />
    <Btn className="w-full" onClick={async () => { try { await api.post('/ads/campaigns', { name, headline, body, dailyBudgetUsd: Number(budget), interests: interests.split(',').filter(Boolean) }); onDone(); toast('campaign_submitted_for_review'); } catch (e: any) { toast(e.code); } }}>Submit for review</Btn>
  </>;
}

function LiveSection({ me, toast }: any) {
  const [title, setTitle] = useState('');
  return <div className="bg-neutral-900 rounded-2xl p-4 space-y-2">
    <Input placeholder="Stream title" value={title} onChange={e => setTitle(e.target.value)} />
    <Btn className="w-full text-xs" onClick={async () => { const d = await api.post('/live/start', { title }); location.hash = `#/live/${d.stream.id}`; }}>Go live (camera + mic)</Btn>
    <p className="text-neutral-600 text-[11px]">Broadcasts your camera via WebRTC to viewers in real time.</p>
  </div>;
}

// ---------- Admin panel ----------
export function Admin({ me, toast }: { me: User; toast: (s: string) => void }) {
  const [ov, setOv] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [reports, setReports] = useState<any[]>([]);
  const [flags, setFlags] = useState<any[]>([]);
  const [ads, setAds] = useState<any[]>([]);
  useEffect(() => {
    api.get('/admin/overview').then(setOv);
    api.get('/admin/users').then(d => setUsers(d.users));
    api.get('/admin/reports').then(d => setReports(d.reports));
    api.get('/admin/moderation-queue').then(d => setFlags(d.flags));
    api.get('/admin/ads').then(d => setAds(d.campaigns));
  }, []);
  if (!ov) return <Spinner className="mx-auto my-8" />;
  if (!me.isAdmin) return <p className="text-center text-neutral-500 py-16">Admins only</p>;
  return (
    <div className="pb-24 max-w-2xl mx-auto p-4 space-y-4">
      <h1 className="text-white font-bold text-xl">Admin</h1>
      <div className="grid grid-cols-5 gap-2">
        <Stat label="Users" value={ov.users} /><Stat label="Posts" value={ov.posts} /><Stat label="Open reports" value={ov.reports} /><Stat label="Flags" value={ov.flags} /><Stat label="Messages" value={ov.messages} />
      </div>
      <div className="bg-neutral-900 rounded-2xl p-4">
        <h3 className="text-white text-sm font-semibold mb-2">Reports</h3>
        {reports.slice(0, 20).map(r => (
          <div key={r.id} className="flex items-center justify-between py-2 border-b border-neutral-800 last:border-0 text-xs">
            <span className="text-neutral-300">{r.target_type} · {r.reason} · by @{r.reporter_username || 'anon'} <span className="text-neutral-600">({r.status})</span></span>
            {r.status === 'open' && (me.isOwner ? <div className="flex gap-1">
              <Btn className="!px-2 !py-1 text-[11px]" onClick={async () => { await api.post(`/admin/reports/${r.id}/resolve`, { action: 'remove', targetType: r.target_type, targetId: r.target_id }); setReports(rs => rs.map(x => x.id === r.id ? { ...x, status: 'resolved' } : x)); }}>Remove</Btn>
              <Btn variant="ghost" className="!px-2 !py-1 text-[11px]" onClick={async () => { await api.post(`/admin/reports/${r.id}/resolve`, { action: 'dismiss' }); setReports(rs => rs.map(x => x.id === r.id ? { ...x, status: 'dismissed' } : x)); }}>Dismiss</Btn>
            </div> : <span className="text-neutral-600 text-[10px]">Owner only</span>)}
          </div>
        ))}
      </div>
      <div className="bg-neutral-900 rounded-2xl p-4">
        <h3 className="text-white text-sm font-semibold mb-2">Moderation queue (auto-flags)</h3>
        {flags.slice(0, 15).map(f => <div key={f.id} className="flex justify-between py-1.5 text-xs border-b border-neutral-800 last:border-0"><span className="text-neutral-300 truncate max-w-[60%]">{f.caption || f.target_id}</span><span className={`rounded px-1.5 ${f.flag === 'abuse' ? 'text-red-300' : 'text-yellow-300'}`}>{f.flag}</span></div>)}
      </div>
      <div className="bg-neutral-900 rounded-2xl p-4">
        <h3 className="text-white text-sm font-semibold mb-2">Users</h3>
        <div className="max-h-80 overflow-y-auto">{users.map(u => (
          <div key={u.id} className="flex items-center justify-between py-2 border-b border-neutral-800 last:border-0 text-xs">
            <div><span className="text-white">@{u.username}</span> <span className="text-neutral-500">{u.email}</span></div>
            <div className="flex gap-1 items-center">
              <span className={`rounded px-1.5 py-0.5 ${u.account_status === 'active' ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'}`}>{u.account_status}</span>
              {me.isOwner ? <>
                <Btn variant="ghost" className="!px-2 !py-1 text-[10px]" onClick={async () => { if (!confirm('Suspend @' + u.username + '?')) return; await api.post(`/admin/users/${u.id}/status`, { status: u.account_status === 'suspended' ? 'active' : 'suspended', reason: 'policy' }); setUsers(us => us.map(x => x.id === u.id ? { ...x, account_status: u.account_status === 'suspended' ? 'active' : 'suspended' } : x)); }}>{u.account_status === 'suspended' ? 'Unsuspend' : 'Suspend'}</Btn>
                <Btn variant="ghost" className="!px-2 !py-1 text-[10px]" onClick={async () => { await api.post(`/admin/users/${u.id}/verify`, { verified: !u.is_verified }); setUsers(us => us.map(x => x.id === u.id ? { ...x, is_verified: !u.is_verified } : x)); }}>{u.is_verified ? 'Unverify' : 'Verify'}</Btn>
              </> : <span className="text-neutral-600 text-[10px]">Owner only</span>}
            </div>
          </div>))}
        </div>
      </div>
      <div className="bg-neutral-900 rounded-2xl p-4">
        <h3 className="text-white text-sm font-semibold mb-2">Ad review</h3>
        {ads.map(c => <div key={c.id} className="flex items-center justify-between py-2 border-b border-neutral-800 last:border-0 text-xs">
          <span className="text-neutral-300">{c.name} · @{c.username} · {c.status}</span>
          {c.status === 'pending' && <div className="flex gap-1">
            <Btn className="!px-2 !py-1 text-[11px]" onClick={async () => { await api.post(`/admin/ads/${c.id}/review`, { status: 'approved' }); setAds(as => as.map(x => x.id === c.id ? { ...x, status: 'approved' } : x)); }}>Approve</Btn>
            <Btn variant="danger" className="!px-2 !py-1 text-[11px]" onClick={async () => { await api.post(`/admin/ads/${c.id}/review`, { status: 'rejected' }); setAds(as => as.map(x => x.id === c.id ? { ...x, status: 'rejected' } : x)); }}>Reject</Btn>
          </div>}
        </div>)}
      </div>
    </div>
  );
}
