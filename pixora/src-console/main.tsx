import '../src/index.css';
import React, { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { createRoot } from 'react-dom/client';
import { Users, ShieldAlert, Flag, Megaphone, LayoutDashboard, Search, Check, X, Ban, Play, BadgeCheck, Mail, LogOut, Radio, RefreshCw, MessagesSquare, Eye } from 'lucide-react';

let token = sessionStorage.getItem('console_token') || '';

async function req(method: string, path: string, body?: any): Promise<any> {
  const r = await fetch(`/api${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 401) { sessionStorage.removeItem('console_token'); token = ''; location.reload(); return; }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'error');
  return d;
}

function Login({ onLogin }: { onLogin: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-tr from-violet-600 to-pink-500 flex items-center justify-center mb-3 text-white font-bold text-xl">P</div>
          <h1 className="text-white text-xl font-bold">Pixora Console</h1>
          <p className="text-neutral-500 text-xs mt-1">Owner control panel — admin accounts only</p>
        </div>
        <div className="space-y-3">
          <input className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2.5 text-sm text-white placeholder-neutral-500 outline-none focus:border-violet-500"
            placeholder="Admin email" value={email} onChange={e => setEmail(e.target.value)} type="email" />
          <input className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2.5 text-sm text-white placeholder-neutral-500 outline-none focus:border-violet-500"
            placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} type="password" />
          {err && <p className="text-red-400 text-xs">{err}</p>}
          <button disabled={busy} onClick={async () => {
            setBusy(true); setErr('');
            try {
              const d = await req('POST', '/auth/login', { email, password });
              if (!d.user?.isAdmin) { setErr('This account is not an admin.'); return; }
              sessionStorage.setItem('console_token', d.token);
              token = d.token;
              onLogin();
            } catch (e: any) {
              setErr(e.code === 'account_banned' ? 'Banned' : e.message || 'Login failed');
            } finally { setBusy(false); }
          }} className="w-full py-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium transition disabled:opacity-40">
            {busy ? 'Checking…' : 'Open console'}
          </button>
        </div>
      </div>
    </div>
  );
}

type Tab = 'overview' | 'users' | 'messages' | 'appeals' | 'reports' | 'moderation' | 'ads';

function Console() {
  const [tab, setTab] = useState<Tab>('overview');
  const [isOwner, setIsOwner] = useState(false);
  const [ov, setOv] = useState<any>(null);
  const [feed, setFeed] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [userQ, setUserQ] = useState('');
  const [appeals, setAppeals] = useState<any[]>([]);
  const [reports, setReports] = useState<any[]>([]);
  const [flags, setFlags] = useState<any[]>([]);
  const [ads, setAds] = useState<any[]>([]);
  const [convs, setConvs] = useState<any[]>([]);
  const [openConv, setOpenConv] = useState<null | { id: string; title: string; messages: any[] }>(null);
  const [inspect, setInspect] = useState<null | any>(null);
  const [liveReports, setLiveReports] = useState<any[]>([]);
  const [auditLog, setAuditLog] = useState<any[]>([]);
  const [toastMsg, setToastMsg] = useState('');
  const toast = (s: string) => { setToastMsg(s); setTimeout(() => setToastMsg(''), 2500); };

  useEffect(() => { req('GET', '/me').then(d => setIsOwner(!!d.user?.isOwner)).catch(() => {}); }, []);
  const load = async () => {
    const [o, u, a, r, m, ad, cv, au] = await Promise.all([
      req('GET', '/admin/overview'), req('GET', '/admin/users'),
      req('GET', '/admin/appeals'), req('GET', '/admin/reports'),
      req('GET', '/admin/moderation-queue'), req('GET', '/admin/ads'),
      req('GET', '/admin/conversations'), req('GET', '/admin/audit'),
    ]);
    setOv(o); setUsers(u.users); setAppeals(a.appeals); setReports(r.reports); setFlags(m.flags); setAds(ad.campaigns); setConvs(cv.conversations); setAuditLog(au.audit);
  };
  useEffect(() => { load().catch(console.log); }, []);

  // live feed
  useEffect(() => {
    const s = io({ auth: { token } });
    s.on('admin:user:joined', (u: any) => setFeed(f => [{ ...u, kind: 'join' }, ...f].slice(0, 40)));
    s.on('admin:appeal:new', (a: any) => { setFeed(f => [{ ...a, kind: 'appeal' }, ...f].slice(0, 40)); load(); });
    s.on('admin:report:new', (r: any) => {
      setLiveReports(rs => [{ ...r, key: Date.now() + Math.random() }, ...rs].slice(0, 20));
      setFeed(f => [{ ...r, kind: 'report', createdAt: r.createdAt }, ...f].slice(0, 40));
    });
    return () => { s.disconnect(); };
  }, []);

  const act = async (label: string, fn: () => Promise<any>) => {
    try { await fn(); toast(label + ' ✓'); load(); } catch (e: any) { toast(e.message || 'failed'); }
  };
  const patchUser = async (id: string, body: any, label: string) => act(label, () => req('POST', `/admin/users/${id}/status`, body));

  const filtered = users.filter(u => !userQ || (u.username || '').includes(userQ) || (u.email || '').includes(userQ));

  return (
    <div className="min-h-screen text-white flex">
      {/* sidebar */}
      <aside className="w-52 border-r border-neutral-900 p-4 flex flex-col gap-1 shrink-0">
        <div className="font-bold mb-4 flex items-center gap-2"><span className="w-7 h-7 rounded-lg bg-violet-600 flex items-center justify-center text-xs">P</span> Console</div>
        {([['overview', 'Overview', LayoutDashboard], ['users', 'Users', Users], ['appeals', 'Appeals', ShieldAlert], ['messages', 'Messages', MessagesSquare], ['reports', 'Reports', Flag], ['moderation', 'Moderation', ShieldAlert], ['ads', 'Ads', Megaphone]] as const).map(([k, label, Icon]) => (
          <button key={k} onClick={() => setTab(k)} className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm text-left ${tab === k ? 'bg-neutral-900 text-white' : 'text-neutral-400 hover:text-white'}`}>
            <Icon size={16} /> {label}
            {k === 'appeals' && appeals.some(a => a.status === 'pending') && <span className="ml-auto bg-red-500 text-[10px] rounded-full w-4 h-4 flex items-center justify-center">{appeals.filter(a => a.status === 'pending').length}</span>}
          </button>
        ))}
        <div className="mt-auto text-[11px] text-neutral-600">
          <a href="/" target="_blank" className="text-violet-400 hover:underline">Open public app ↗</a>
          <button className="block mt-2 hover:text-neutral-400" onClick={() => { sessionStorage.removeItem('console_token'); location.reload(); }}>Log out</button>
        </div>
      </aside>

      <main className="flex-1 p-6 max-w-5xl">
        {toastMsg && <div className="fixed top-4 right-4 bg-white text-black text-sm px-4 py-2 rounded-full z-50">{toastMsg}</div>}

        {tab === 'overview' && (
          <div className="space-y-6">
            <h1 className="text-lg font-bold">Overview</h1>
            {ov && <div className="grid grid-cols-5 gap-3">
              {[['Users', ov.users], ['Posts', ov.posts], ['Open reports', ov.reports], ['Flags', ov.flags], ['Messages', ov.messages]].map(([l, v]: any) => (
                <div key={l} className="bg-neutral-900 rounded-2xl p-4"><div className="text-2xl font-bold">{v}</div><div className="text-neutral-500 text-xs">{l}</div></div>
              ))}
            </div>}
            <div>
              <h2 className="text-sm font-semibold text-neutral-300 mb-2">Admin action log</h2>
              <div className="bg-neutral-900 rounded-2xl p-4 max-h-40 overflow-y-auto text-xs space-y-1">
                <div className="flex justify-end mb-1"><button onClick={async () => { try { const d = await req('POST', '/admin/undo-last-ban'); toast('Restored @' + d.undone.user); load(); } catch { toast('Nothing to undo'); } }} className="text-[10px] bg-green-900/60 text-green-300 rounded-lg px-2 py-1">Undo last ban/suspend</button></div>
                {auditLog.slice(0, 10).map((x, i) => (
                  <div key={i} className="flex justify-between text-neutral-400">
                    <span>@{x.admin_username} → {x.action} on @{x.target_username || x.target_id?.slice(0, 8)}</span>
                    <span className="text-neutral-600">{new Date(x.created_at).toLocaleString()}</span>
                  </div>
                ))}
                {!auditLog.length && <p className="text-neutral-600">No actions yet</p>}
              </div>
            </div>
            <div>
              <h2 className="text-sm font-semibold text-neutral-300 mb-2 flex items-center gap-2"><RefreshCw size={13} /> Live activity</h2>
              <div className="bg-neutral-900 rounded-2xl p-4 max-h-72 overflow-y-auto text-sm space-y-1.5">
                {feed.length === 0 && <p className="text-neutral-500 text-xs">Waiting for new users & appeals… (open in this tab; events arrive live)</p>}
                {feed.map((e, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    {e.kind === 'appeal'
                      ? <><ShieldAlert size={13} className="text-red-400" /><span className="text-neutral-300">Appeal from <b>{e.email}</b></span></>
                      : <><Users size={13} className="text-green-400" /><span className="text-neutral-300">New user joined: <b>{e.username || e.email}</b> via {e.method}</span></>}
                    <span className="text-neutral-600 text-[11px] ml-auto">{new Date(e.createdAt).toLocaleTimeString()}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {tab === 'users' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h1 className="text-lg font-bold">Users</h1>
              <div className="relative"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
                <input value={userQ} onChange={e => setUserQ(e.target.value)} placeholder="Search…" className="bg-neutral-900 border border-neutral-800 rounded-xl pl-8 pr-3 py-2 text-sm outline-none focus:border-violet-500 w-56" /></div>
            </div>
            <div className="bg-neutral-900 rounded-2xl overflow-hidden">
              <table className="w-full text-sm">
                <thead><tr className="text-neutral-500 text-xs text-left border-b border-neutral-800">
                  <th className="px-4 py-3">User</th><th className="px-2">Email ✓</th><th className="px-2">Badge</th><th className="px-2">Status</th><th className="px-2">Joined</th><th className="px-4 text-right">Actions</th>
                </tr></thead>
                <tbody>
                  {filtered.map(u => (
                    <tr key={u.id} className="border-b border-neutral-800/50 last:border-0">
                      <td className="px-4 py-3"><div className="font-medium">@{u.username || '—'} {u.is_admin && <span className="text-[10px] bg-violet-900 text-violet-300 rounded px-1">admin</span>}</div><div className="text-neutral-500 text-xs">{u.email}</div></td>
                      <td className="px-2">
                        <button title={u.email_verified ? 'Un-verify email' : 'Verify email'} onClick={() => act(u.email_verified ? 'Email un-verified' : 'Email verified', () => req('POST', `/admin/users/${u.id}/verify-email`, { verified: !u.email_verified }))}
                          className={`p-1 rounded ${u.email_verified ? 'text-green-400' : 'text-neutral-600 hover:text-white'}`}><Check size={15} /></button>
                      </td>
                      <td className="px-2">
                        <button title={u.is_verified ? 'Remove badge' : 'Grant verified badge'} onClick={() => act(u.is_verified ? 'Badge removed' : 'Badge granted', () => req('POST', `/admin/users/${u.id}/verify`, { verified: !u.is_verified }))}
                          className={`p-1 rounded ${u.is_verified ? 'text-sky-400' : 'text-neutral-600 hover:text-white'}`}><BadgeCheck size={15} /></button>
                      </td>
                      <td className="px-2"><span className={`text-[10px] rounded-full px-2 py-0.5 ${u.account_status === 'active' ? 'bg-green-900 text-green-300' : u.account_status === 'banned' ? 'bg-red-900 text-red-300' : u.account_status === 'suspended' ? 'bg-amber-900 text-amber-300' : 'bg-neutral-800 text-neutral-400'}`}>{u.account_status}</span></td>
                      <td className="px-2 text-neutral-500 text-xs">{new Date(u.created_at).toLocaleDateString()}</td>
                      <td className="px-4 py-2 text-right space-x-1">
                        {isOwner ? <>
                          {u.account_status !== 'active' && <button title="Reactivate" onClick={() => patchUser(u.id, { status: 'active' }, 'Account restored')} className="p-1.5 rounded bg-green-900/50 text-green-300 hover:bg-green-900"><Play size={13} /></button>}
                          {u.account_status === 'active' && <button title="Suspend" onClick={() => { if (confirm(`Suspend @${u.username || u.email}?`)) patchUser(u.id, { status: 'suspended', reason: 'Terms of service violation' }, 'Suspended'); }} className="p-1.5 rounded bg-amber-900/50 text-amber-300 hover:bg-amber-900"><Ban size={13} /></button>}
                          {u.account_status !== 'banned' && <button title="Ban" onClick={() => {
  const name = u.username || u.email || '';
  const typed = prompt(`To ban @${name}, type their username exactly:\n\n${name}`);
  if (typed === name) patchUser(u.id, { status: 'banned', reason: 'Community guidelines violation' }, 'User banned');
  else if (typed !== null) toast('Username did not match — not banned');
}} className="p-1.5 rounded bg-red-900/50 text-red-300 hover:bg-red-900"><X size={13} /></button>}
                        </> : <span className="text-[10px] text-neutral-600">Owner only</span>}
                        <button title="Full inspection" onClick={async () => { const d = await req('GET', `/admin/users/${u.id}/profile-full`); setInspect(d); }} className="p-1.5 rounded bg-neutral-800 text-neutral-300 hover:bg-neutral-700"><Eye size={13} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === 'appeals' && (
          <div className="space-y-4">
            <h1 className="text-lg font-bold">Ban appeals</h1>
            {appeals.length === 0 && <p className="text-neutral-500 text-sm">No appeals yet. When a banned user taps "Request review" it shows up here instantly.</p>}
            {appeals.map(a => (
              <div key={a.id} className="bg-neutral-900 rounded-2xl p-4">
                <div className="flex items-center justify-between">
                  <div><div className="font-medium">{a.email} {a.username && <span className="text-neutral-500 text-sm">@{a.username}</span>}
                    {a.ban_count > 0 && <span className="ml-2 text-[10px] bg-red-900/60 text-red-300 rounded px-1.5 py-0.5">{a.ban_count} previous ban{a.ban_count > 1 ? 's' : ''}</span>}</div>
                    <div className="text-neutral-500 text-xs">{a.message || '(no message)'} · {new Date(a.created_at).toLocaleString()}</div>
                    {a.ban_history && a.ban_history.length > 0 && (
                      <div className="mt-2 text-[11px] text-neutral-400 space-y-0.5">
                        {a.ban_history.map((h: any, i: number) => (
                          <div key={i}>• {h.status === 'banned' ? 'Banned' : h.status === 'suspended' ? 'Suspended' : 'Restored'} {new Date(h.bannedAt).toLocaleDateString()} — {h.reason || 'no reason'}{h.unbannedAt ? ` · unbanned ${new Date(h.unbannedAt).toLocaleDateString()}` : ''}</div>
                        ))}
                      </div>
                    )}</div>
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] rounded-full px-2 py-0.5 ${a.status === 'pending' ? 'bg-amber-900 text-amber-300' : a.status === 'overturned' ? 'bg-green-900 text-green-300' : 'bg-neutral-800 text-neutral-400'}`}>{a.status}</span>
                    {a.status === 'pending' && (isOwner ? <>
                      <button onClick={() => act('Marked reviewing', () => req('POST', `/admin/appeals/${a.id}/resolve`, { status: 'reviewing' }))} className="text-xs bg-neutral-800 rounded-lg px-2 py-1">Reviewing</button>
                      <button onClick={() => act('Ban upheld', () => req('POST', `/admin/appeals/${a.id}/resolve`, { status: 'upheld' }))} className="text-xs bg-red-900/60 text-red-300 rounded-lg px-2 py-1">Uphold ban</button>
                      <button onClick={() => act('Ban overturned — user restored', () => req('POST', `/admin/appeals/${a.id}/resolve`, { status: 'overturned' }))} className="text-xs bg-green-900/60 text-green-300 rounded-lg px-2 py-1">Overturn & restore</button>
                    </> : <span className="text-[10px] text-neutral-600">Owner only</span>)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'messages' && (
          <div className="space-y-4">
            <h1 className="text-lg font-bold">All conversations</h1>
            <p className="text-neutral-500 text-xs">Owner oversight — read any conversation on the platform.</p>
            {convs.map(c => (
              <div key={c.id} className="bg-neutral-900 rounded-2xl p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium">{c.is_group ? (c.title || 'Group') : (c.members?.filter((m: any) => m.id !== null).map((m: any) => '@' + m.username).join(' ↔ ') || 'Empty chat')}</div>
                    <div className="text-neutral-500 text-xs">{c.message_count} messages · last: {c.last_message ? `${c.last_message.sender}: "${(c.last_message.body || '[' + c.last_message.kind + ']').slice(0, 60)}"` : '—'}</div>
                  </div>
                  <button onClick={async () => {
                    const d = await req('GET', `/admin/conversations/${c.id}/messages`);
                    setOpenConv({ id: c.id, title: c.is_group ? (c.title || 'Group') : c.members?.map((m: any) => '@' + m.username).join(' ↔ '), messages: d.messages });
                  }} className="text-xs bg-violet-900/60 text-violet-300 rounded-lg px-3 py-1.5 flex items-center gap-1"><Eye size={12} />Read</button>
                </div>
              </div>
            ))}
            {!convs.length && <p className="text-neutral-500 text-sm">No conversations yet.</p>}
            {openConv && (
              <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setOpenConv(null)}>
                <div className="bg-neutral-950 border border-neutral-800 rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
                  <div className="p-4 border-b border-neutral-800 flex justify-between items-center">
                    <h3 className="text-white font-semibold">{openConv.title}</h3>
                    <button onClick={() => setOpenConv(null)} className="text-neutral-400"><X size={18} /></button>
                  </div>
                  <div className="flex-1 overflow-y-auto p-4 space-y-2">
                    {openConv.messages.map(m => (
                      <div key={m.id} className="text-sm">
                        <span className="text-violet-300 font-medium">@{m.sender.username}</span>
                        <span className="text-neutral-500 text-[10px] ml-2">{new Date(m.createdAt).toLocaleString()}</span>
                        <div className={m.deleted ? 'text-neutral-600 italic' : 'text-neutral-200'}>{m.deleted ? 'deleted' : (m.kind !== 'text' ? `[${m.kind}]` : m.body)}</div>
                      </div>
                    ))}
                    {!openConv.messages.length && <p className="text-neutral-500 text-sm">Empty conversation</p>}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'reports' && (
          <div className="space-y-4">
            <h1 className="text-lg font-bold">Reports</h1>
            {liveReports.length > 0 && (
              <div className="space-y-2">
                <h2 className="text-sm font-semibold text-amber-300 flex items-center gap-2"><Radio size={13} /> Just reported (live)</h2>
                {liveReports.map(r => (
                  <div key={r.key} className="bg-amber-950/30 border border-amber-900/50 rounded-2xl p-4">
                    <div className="text-xs text-amber-300 mb-2">MESSAGE REPORT · @{r.reporter} reported @{r.sender}</div>
                    <div className="bg-neutral-900 rounded-xl p-3 text-sm text-neutral-200 mb-2">"{r.messageBody}"</div>
                    <div className="text-xs text-neutral-500 mb-3">Reason: {r.reason} · Conversation: {(r.members || []).map((m: any) => '@' + m.username).join(', ')}</div>
                    <div className="flex gap-2">
                      {!isOwner && <span className="text-[10px] text-neutral-600">Owner only</span>}
                      <button onClick={async () => {
                        if (!isOwner) return;
                        if (!confirm('Remove this content?')) return;
                        await req('POST', `/admin/messages/${r.targetId}/action`, { action: 'remove' });
                        await req('DELETE', `/live/comments/${r.targetId}`).catch(() => {});
                        setLiveReports(rs => rs.filter(x => x.key !== r.key)); toast('Removed');
                      }} className="text-xs bg-red-900/60 text-red-300 rounded-lg px-3 py-1.5">{r.targetType === 'live_comment' ? 'Remove comment' : 'Remove message'}</button>
                      <button onClick={async () => { const typed = prompt(`To ban @${r.sender}, type their username exactly:\n\n${r.sender}`); if (typed === r.sender) { await req('POST', `/admin/messages/${r.targetId}/action`, { action: 'ban_sender', reason: r.reason }); setLiveReports(rs => rs.filter(x => x.key !== r.key)); toast('Sender banned'); } else if (typed !== null) toast('Username did not match — not banned'); }} className="text-xs bg-red-900 text-red-200 rounded-lg px-3 py-1.5">Ban sender</button>
                      <button onClick={async () => { await req('POST', `/admin/messages/${r.targetId}/action`, { action: 'dismiss' }); setLiveReports(rs => rs.filter(x => x.key !== r.key)); toast('Dismissed'); }} className="text-xs bg-neutral-800 rounded-lg px-3 py-1.5">Dismiss</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {reports.map(r => (
              <div key={r.id} className="bg-neutral-900 rounded-2xl p-4 flex items-center justify-between">
                <div><div className="text-sm">{r.target_type} · <span className="text-neutral-400">{r.reason}</span> · by @{r.reporter_username || 'anon'}</div>
                  <div className="text-neutral-600 text-xs">{r.details} · {new Date(r.created_at).toLocaleString()}</div></div>
                {r.status === 'open' ? <div className="flex gap-1">
                  <button onClick={() => act('Removed', () => req('POST', `/admin/reports/${r.id}/resolve`, { action: 'remove', targetType: r.target_type, targetId: r.target_id }))} className="text-xs bg-red-900/60 text-red-300 rounded-lg px-2 py-1">Remove content</button>
                  <button onClick={() => act('Dismissed', () => req('POST', `/admin/reports/${r.id}/resolve`, { action: 'dismiss' }))} className="text-xs bg-neutral-800 rounded-lg px-2 py-1">Dismiss</button>
                </div> : <span className="text-neutral-600 text-xs">{r.status}</span>}
              </div>
            ))}
          </div>
        )}

        {tab === 'moderation' && (
          <div className="space-y-4">
            <h1 className="text-lg font-bold">Auto-moderation queue</h1>
            {flags.length === 0 && <p className="text-neutral-500 text-sm">No flagged content.</p>}
            {flags.map(f => (
              <div key={f.id} className="bg-neutral-900 rounded-2xl p-4 flex items-center justify-between text-sm">
                <div className="truncate max-w-[70%]">{f.caption || f.target_id}</div>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] rounded px-1.5 ${f.flag === 'abuse' ? 'bg-red-900 text-red-300' : f.flag === 'spam' ? 'bg-amber-900 text-amber-300' : 'bg-neutral-800 text-neutral-300'}`}>{f.flag}</span>
                  {f.target_id && f.caption != null && <button onClick={() => act('Removed', () => req('DELETE', `/posts/${f.target_id}`))} className="text-xs bg-red-900/60 text-red-300 rounded-lg px-2 py-1">Remove post</button>}
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'ads' && (
          <div className="space-y-4">
            <h1 className="text-lg font-bold">Ad review</h1>
            {ads.map(c => (
              <div key={c.id} className="bg-neutral-900 rounded-2xl p-4 flex items-center justify-between">
                <div><div className="text-sm font-medium">{c.name} · @{c.username}</div>
                  <div className="text-neutral-500 text-xs">{c.headline} · ${(c.daily_budget_cents / 100).toFixed(2)}/day · {c.impressions} impr · {c.clicks} clicks</div></div>
                {c.status === 'pending' ? <div className="flex gap-1">
                  <button onClick={() => act('Approved', () => req('POST', `/admin/ads/${c.id}/review`, { status: 'approved' }))} className="text-xs bg-green-900/60 text-green-300 rounded-lg px-2 py-1">Approve</button>
                  <button onClick={() => act('Rejected', () => req('POST', `/admin/ads/${c.id}/review`, { status: 'rejected' }))} className="text-xs bg-red-900/60 text-red-300 rounded-lg px-2 py-1">Reject</button>
                </div> : <span className="text-neutral-500 text-xs">{c.status}</span>}
              </div>
            ))}
          </div>
        )}
        {inspect && (
          <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setInspect(null)}>
            <div className="bg-neutral-950 border border-neutral-800 rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="p-4 border-b border-neutral-800 flex justify-between items-center sticky top-0 bg-neutral-950">
                <h3 className="text-white font-semibold">@{inspect.user.username} — full profile</h3>
                <button onClick={() => setInspect(null)} className="text-neutral-400"><X size={18} /></button>
              </div>
              <div className="p-4 space-y-3 text-sm">
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-neutral-900 rounded-xl p-3"><div className="text-neutral-500">Email</div><div className="text-white">{inspect.user.email} {inspect.user.email_verified ? '✓' : '(unverified)'}</div></div>
                  <div className="bg-neutral-900 rounded-xl p-3"><div className="text-neutral-500">Phone</div><div className="text-white">{inspect.user.phone || '—'} {inspect.user.phone_verified ? '✓' : ''}</div></div>
                  <div className="bg-neutral-900 rounded-xl p-3"><div className="text-neutral-500">Status</div><div className="text-white">{inspect.user.account_status}{inspect.user.suspended_reason ? ` (${inspect.user.suspended_reason})` : ''}</div></div>
                  <div className="bg-neutral-900 rounded-xl p-3"><div className="text-neutral-500">Stats</div><div className="text-white">{inspect.user.post_count} posts · {inspect.user.follower_count} followers</div></div>
                </div>
                <div><h4 className="text-neutral-400 text-xs uppercase mb-1">Posts ({inspect.posts.length})</h4>
                  {inspect.posts.slice(0, 10).map(p => <div key={p.id} className="text-xs text-neutral-300 py-1 border-b border-neutral-800/50">{p.kind} · {(p.caption || '(media)').slice(0, 70)} · {p.like_count} likes · {p.status}</div>)}</div>
                <div><h4 className="text-neutral-400 text-xs uppercase mb-1">Reports against them</h4>
                  {inspect.reports.length ? inspect.reports.map(r => <div key={r.id} className="text-xs text-neutral-300 py-1">{r.reason} · {r.status}</div>) : <p className="text-xs text-neutral-600">None</p>}</div>
                <div><h4 className="text-neutral-400 text-xs uppercase mb-1">Login history</h4>
                  {inspect.logins.slice(0, 8).map((l: any, i: number) => <div key={i} className="text-xs text-neutral-300 py-0.5">{l.method} {l.success ? '✓' : '✗'} · {l.ip} · {new Date(l.created_at).toLocaleString()}</div>)}</div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function App() {
  const [authed, setAuthed] = useState(!!token);
  return authed ? <Console /> : <Login onLogin={() => setAuthed(true)} />;
}

createRoot(document.getElementById('console-root')!).render(<App />);
