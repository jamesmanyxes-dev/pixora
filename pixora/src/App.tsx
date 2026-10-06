import React, { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { Home, Compass, Film, Send, User as UserIcon, Plus, Radio, Settings as Cog, Phone, PhoneIncoming, Search, Shield, LayoutDashboard, Users } from 'lucide-react';
import { api, getToken, setTokens } from './api';
import { Avatar, Spinner, Modal, Btn, Input } from './ui';
import { t } from './i18n';
import type { User, Post } from './types';
import { AuthScreen } from './screens/auth';
import { Feed, Composer, CommentsPanel, StoriesBar, StoryViewer, StoryUpload } from './screens/feed';
import { Explore, SearchPage, ReelsFeed, HashtagPage } from './screens/explore';
import { Profile, EditProfile } from './screens/profile';
import { Messages } from './screens/messages';
import { Notifications, Settings, Admin } from './screens/settings';
import { LivePage, LiveList } from './screens/live';
import { CallOverlay } from './screens/calls';
import { initPush, playNotifySound } from './push';
import { PixoraLogo, PageTransition } from './components/anim';
import { LegalPage } from './legal';
import { BanScreen, SuspendedScreen } from './screens/ban';

type Route = { name: string; param?: string };

function parseHash(): Route {
  const h = location.hash.replace(/^#\/?/, '');
  if (!h) return { name: 'home' };
  const [name, ...rest] = h.split('/');
  return { name: name || 'home', param: rest.join('/') || undefined };
}

export default function App() {
  const [me, setMe] = useState<User | null>(null);
  const [config, setConfig] = useState<any>(null);
  const [booting, setBooting] = useState(true);
  const [route, setRoute] = useState<Route>(parseHash);
  const [socket, setSocket] = useState<any>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [commentsPost, setCommentsPost] = useState<Post | null>(null);
  const [toastMsg, setToastMsg] = useState('');
  const [groups, setGroups] = useState<any[]>([]);
  const [storyOpen, setStoryOpen] = useState<number | null>(null);
  const [storyUpload, setStoryUpload] = useState(false);
  const [unreadNotifs, setUnreadNotifs] = useState(0);
  const [unreadDm, setUnreadDm] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [createKind, setCreateKind] = useState<'post' | 'reel'>('post');
  const [editOpen, setEditOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [sharedPost, setSharedPost] = useState<Post | null>(null);
  const [offline, setOffline] = useState(!navigator.onLine);
  useEffect(() => {
    const on = () => setOffline(false); const off = () => setOffline(true);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  const [activeCall, setActiveCall] = useState<any | null>(null); // {id, peer, kind, role}
  const [incomingCall, setIncomingCall] = useState<any | null>(null); // pre-answer
  const [callsOpen, setCallsOpen] = useState(false);
  const [banState, setBanState] = useState<null | { kind: 'banned' | 'suspended'; email: string; reason?: string | null }>(null);
  const callStartRef = useRef<number>(0);
  const pendingIdRef = useRef<string>(`c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const signalQueue = useRef<any[]>([]);

  const toast = (s: string) => { setToastMsg(s); setTimeout(() => setToastMsg(''), 2500); };

  // hash routing (deep links: #/profile/alice, #/settings, #/reels, ...)
  useEffect(() => {
    const onHash = () => { setRoute(parseHash()); setSearchOpen(false); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const go = (name: string, param?: string) => { location.hash = `#/${name}${param ? '/' + param : ''}`; };

  useEffect(() => {
    api.get('/config').then(setConfig).catch(() => {});
    if (getToken()) {
      api.get('/me').then(d => setMe(d.user)).catch(async (e: any) => {
        // network errors (offline at boot) must NEVER log the user out — retry next boot
        if (e instanceof TypeError || !e?.code) { setBooting(false); return; }
        if (e?.code === 'account_banned') {
          // ALWAYS double-check with the server before showing the gate — false bans are unacceptable
          let email = '';
          try { email = JSON.parse(atob(getToken().split('.')[1])).email || ''; } catch {}
          try {
            const r = await fetch(`/api/auth/ban-status?email=${encodeURIComponent(email)}`);
            const d = await r.json();
            if (!r.ok || d.active) { setTokens('', ''); return; } // not actually banned → plain logout
          } catch { setTokens('', ''); return; } // can't verify → never show the gate
          setBanState({ kind: 'banned', email });
        } else {
          // session expired / revoked / network issue → plain logout, NEVER a ban screen
          setTokens('', '');
        }
      }).finally(() => setBooting(false));
    } else setBooting(false);
  }, []);
  useEffect(() => {
    if (!me) return;
    initPush(); // ask permission + subscribe for real device notifications
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
    const s = io({ auth: { token: getToken() }, reconnectionDelayMax: 10000, timeout: 20000 });
    (window as any).__pixoraSocket = s;
    setSocket(s);
    s.on('notification:new', (n: any) => { setUnreadNotifs(x => x + 1); playNotifySound(); toast(`${String(n.type).replace('_', ' ')}`); });
    const seenMsgs = new Set<string>();
    s.on('message:new', (m: any) => {
      if (m.senderId === me.id) return;
      if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
        try {
          const n = new Notification(m.sender?.displayName || m.sender?.username || 'New message', {
            body: m.kind === 'text' ? m.body : `[${m.kind}]`, icon: '/icon.svg', tag: 'msg-' + m.conversationId,
          });
          n.onclick = () => { window.focus(); location.hash = '#/messages/' + m.conversationId; n.close(); };
        } catch {}
      }
      if (seenMsgs.has(m.id)) return; // guard against duplicate delivery
      seenMsgs.add(m.id);
      if (seenMsgs.size > 500) seenMsgs.clear();
      if (parseHash().name !== 'messages') setUnreadDm(x => x + 1);
    });
    // ---- incoming calls ----
    navigator.serviceWorker?.addEventListener('message', (ev: any) => {
      if (ev.data?.type === 'need-access-token' && ev.ports?.[0]) {
        ev.ports[0].postMessage(getToken());
      }
    });
    s.on('call:incoming', (c: any) => {
      // display-over-other-apps: if the app is backgrounded, fire a system notification
      if (document.hidden) {
        try {
          const n = new Notification(`Incoming ${c.kind} call — ${c.from.displayName || c.from.username}`, {
            body: 'Tap to answer', icon: '/icon.svg', requireInteraction: true, tag: 'call-' + c.callId,
          });
          n.onclick = () => { window.focus(); setIncomingCall({ callId: c.callId, peer: c.from, kind: c.kind }); n.close(); };
        } catch {}
        return;
      }
      setIncomingCall({ callId: c.callId, peer: c.from, kind: c.kind });
      callStartRef.current = Date.now();
    });
    s.on('call:started', ({ callId }: any) => {
      // caller learns the real call id created by the server
      if (activeCallRef.current && activeCallRef.current.role === 'caller') {
        setActiveCall((ac: any) => (ac ? { ...ac, id: callId } : ac));
        pendingIdRef.current = callId;
      }
    });
    // buffer signals that arrive before the call overlay mounts (callee side)
    s.on('call:signal', (payload: any) => { signalQueue.current.push(payload); });
    s.on('call:failed', ({ reason }: any) => { toast(reason || 'call_failed'); setActiveCall(null); setIncomingCall(null); });
    // live account status push (ban/suspend while online)
    s.on('account:status', async ({ status }: any) => {
      if (status !== 'banned' && status !== 'suspended') return;
      if (me.isAdmin) return; // admins are never gated by a live push
      // verify with the server before showing anything
      try {
        const r = await fetch(`/api/auth/ban-status?email=${encodeURIComponent(me.email || '')}`);
        const d = await r.json();
        if (!d.active === false) return; // actually active → ignore
        if (d.active) return;
        setBanState({ kind: status, email: me.email || '', reason: status === 'banned' ? 'Community guidelines violation' : null });
      } catch { /* can't verify → ignore */ }
    });
    s.on('call:ended', ({ callId }: any) => {
      if (incomingCallRef.current?.callId === callId) setIncomingCall(null);
    });
    return () => { s.disconnect(); };
  }, [me?.id]);
  const activeCallRef = useRef<any>(null);
  const incomingCallRef = useRef<any>(null);
  incomingCallRef.current = incomingCall;
  activeCallRef.current = activeCall;

  useEffect(() => { if (me) api.get('/stories').then(d => setGroups(d.groups)); }, [me, route.name]);
  useEffect(() => { if (me) api.get('/notifications').then(d => setUnreadNotifs(d.unread)); }, [me, route.name]);
  useEffect(() => { if (me) api.get('/conversations').then(d => setUnreadDm(d.conversations.reduce((a: number, c: any) => a + Number(c.unread), 0))); }, [me, route.name]);

  const onProfile = (u: string) => go('profile', uCamel(u));
  const uCamel = (u: string) => u;

  const logout = () => { api.post('/auth/logout').finally(() => { setTokens('', ''); setMe(null); socket?.disconnect(); go('home'); }); };

  const startCall = async (username: string, kind: 'audio' | 'video') => {
    try {
      const d = await api.get(`/users/${username}`);
      const peer = d.user;
      if (!peer?.id) { toast('user_not_found'); return; }
      signalQueue.current = [];
      pendingIdRef.current = `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      socket?.emit('call:start', { to: peer.id, kind });
      callStartRef.current = Date.now();
      setActiveCall({ id: pendingIdRef.current, peer, kind, role: 'caller' });
      setCallsOpen(false);
    } catch (e: any) { toast(e.code || 'call_failed'); }
  };

  // legal pages are public (Play Store requirement) — render before auth check
  if (route.name === 'privacy') return <LegalPage kind="privacy" onBack={() => go('home')} />;
  if (route.name === 'terms') return <LegalPage kind="terms" onBack={() => go('home')} />;
  if (booting) return <div className="min-h-screen bg-neutral-950 flex items-center justify-center"><Spinner /></div>;
  if (banState?.kind === 'banned')
    return <BanScreen email={banState.email} reason={banState.reason} onLogout={() => { setTokens('', ''); setBanState(null); setMe(null); go('home'); }} />;
  if (banState?.kind === 'suspended')
    return <SuspendedScreen reason={banState.reason} />;
  if (!me) return <AuthScreen config={config} onAuth={(u) => setMe(u)}
      onBanned={(email: string) => setBanState({ kind: 'banned', email })} />;

  const nav = [
    ['home', Home], ['reels', Film], ['search', Search], ['messages', Send], ['notifications', Heart], ['explore', Compass],
  ] as const;

  let screen: React.ReactNode;
  // invite-link landing: #/join/<code> — join the group, then jump into it
  if (route.name === 'join' && route.param) {
    return <JoinGroup code={route.param} me={me} socket={socket} onDone={(id: string) => { window.location.hash = `#/messages/${id}`; setRoute({ name: 'messages', param: id }); }} />;
  }
  switch (route.name) {
    case 'home': screen = <>
      <StoriesBar me={me} groups={groups} onAdd={() => setStoryUpload(true)} onOpen={(i) => setStoryOpen(i)} />
      <Feed me={me} posts={posts} setPosts={setPosts} onOpenComments={setCommentsPost} onProfile={onProfile} onShare={(p) => setSharedPost(p)} toast={toast} socket={socket} />
    </>; break;
    case 'explore': screen = <Explore me={me} onProfile={onProfile} onOpenReel={() => go('reels')} onHashtag={(tag: string) => go('hashtag', tag)} />; break;
    case 'reels': screen = <ReelsFeed me={me} onOpenComments={setCommentsPost} onProfile={onProfile} toast={toast} socket={socket} onShare={(p) => setSharedPost(p)} />; break;
    case 'messages': screen = <Messages me={me} socket={socket} onProfile={onProfile} toast={toast} onCall={startCall} />; break;
    case 'notifications': screen = <Notifications me={me} onProfile={onProfile} onOpenPost={async (id: string) => { try { const d = await api.get(`/posts/${id}`); setCommentsPost(d.post); } catch {} }} />; break;
    case 'profile': screen = <Profile username={route.param || me.username} me={me} onProfile={onProfile} onEditProfile={() => setEditOpen(true)} onOpenComments={setCommentsPost} onShare={(p) => setSharedPost(p)} toast={toast} socket={socket} onCall={startCall} />; break;
    case 'hashtag': screen = <HashtagPage tag={route.param || ''} onBack={() => go('explore')} />; break;
    case 'search': screen = <SearchPage me={me} onProfile={onProfile} onHashtag={(tag: string) => go('hashtag', tag)} />; break;
    case 'live': screen = route.param ? <LivePage streamId={route.param} me={me} socket={socket} onBack={() => go('live')} toast={toast} /> : <LiveList onOpen={(id) => go('live', id)} />; break;
    case 'settings': screen = <Settings me={me} onUser={setMe} onLogout={logout} toast={toast} />; break;
    case 'admin': screen = <Admin me={me} toast={toast} />; break;
    default: screen = null;
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-white" dir={navigator.language.startsWith('ar') ? 'rtl' : 'ltr'}>
      {/* mobile quick bar: live + admin */}
      <div className="sm:hidden flex items-center gap-2 px-4 pt-3">
        <PixoraLogo onClick={() => go('home')} />
        <button onClick={() => go('profile', me.username)} className="p-2 text-neutral-300"><Avatar src={me.avatarUrl} size={22} /></button>
        <button onClick={() => go('live')} className="p-2 text-neutral-300"><Radio size={20} /></button>
        {me.isAdmin && <>
          <button onClick={() => go('admin')} className="p-2 text-amber-400"><Shield size={20} /></button>
          <button onClick={() => window.open('/console', '_blank')} className="p-2 text-violet-400"><LayoutDashboard size={20} /></button>
        </>}
      </div>
      <header className="hidden sm:flex fixed top-0 left-0 right-0 h-14 items-center px-6 border-b border-neutral-900 bg-neutral-950/90 backdrop-blur z-30">
        <PixoraLogo onClick={() => go('home')} />
        <button className="ml-6 text-neutral-400 hover:text-white" onClick={() => setSearchOpen(true)}>Search</button>
        <div className="ml-auto flex items-center gap-4 text-sm">
          <button className="text-neutral-300 hover:text-white flex items-center gap-1.5" onClick={() => go('live')}><Radio size={16} /> Live</button>
          <button className="text-neutral-300 hover:text-white flex items-center gap-1.5" onClick={() => go('explore')}><Compass size={16} /> Explore</button>
          {me.isAdmin && <button className="text-neutral-300 hover:text-white flex items-center gap-1.5" onClick={() => go('admin')}><Cog size={16} /> Admin</button>}
          <button className="text-neutral-300 hover:text-white" onClick={() => go('settings')}>Settings</button>
        </div>
      </header>
      {/* desktop left nav */}
      <nav className="hidden sm:flex fixed left-0 top-14 bottom-0 w-56 border-r border-neutral-900 flex-col p-4 gap-1 z-20 overflow-y-auto">
        {nav.map(([n, Icon]) => (
          <button key={n} onClick={() => go(n)} className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition ${route.name === n ? 'bg-neutral-900 text-white' : 'text-neutral-400 hover:text-white'}`}>
            <span className="relative"><Icon size={20} />
              {n === 'notifications' && unreadNotifs > 0 && <span className="absolute -top-1 -right-1 bg-red-500 text-[9px] rounded-full w-4 h-4 flex items-center justify-center badge-pulse">{unreadNotifs}</span>}
              {n === 'messages' && unreadDm > 0 && <span className="absolute -top-1 -right-1 bg-red-500 text-[9px] rounded-full w-4 h-4 flex items-center justify-center">{unreadDm}</span>}
            </span>
            {t(n)}
          </button>
        ))}
        <button onClick={() => setCallsOpen(true)} className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-neutral-400 hover:text-white"><Phone size={20} /> Calls</button>
        <button onClick={() => { setCreateKind('post'); setCreateOpen(true); }} className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium mt-2"><Plus size={20} /> {t('create')}</button>
      </nav>

      <main className="sm:ml-56 pt-0 sm:pt-14"><PageTransition pageKey={route.name + (route.param || "")}>{screen}</PageTransition></main>

      {/* create FAB (mobile) */}
      {!['messages', 'live'].includes(route.name) && !activeCall && !incomingCall && (
        <button onClick={() => setCreateOpen(true)} className="sm:hidden fixed bottom-[76px] right-3 z-30 w-11 h-11 rounded-full bg-violet-600 flex items-center justify-center shadow-lg shadow-violet-900/50 active:scale-95 transition"><Plus size={20} /></button>
      )}

      {/* mobile bottom nav */}
      <nav className="sm:hidden fixed bottom-0 left-0 right-0 h-[60px] border-t border-neutral-900 bg-neutral-950/95 backdrop-blur flex items-center justify-around z-30">
        {nav.map(([n, Icon]: any) => (
          <button key={n} onClick={() => go(n)} className="relative p-2 active:scale-90 transition">
            <Icon size={24} className={route.name === n ? 'text-white' : 'text-neutral-500'} />
            {n === 'notifications' && unreadNotifs > 0 && <span className="absolute top-1 right-1 bg-red-500 text-[8px] rounded-full w-3.5 h-3.5 flex items-center justify-center badge-pulse">{unreadNotifs}</span>}
            {n === 'messages' && unreadDm > 0 && <span className="absolute top-1 right-1 bg-red-500 text-[8px] rounded-full w-3.5 h-3.5 flex items-center justify-center">{unreadDm}</span>}
          </button>
        ))}
      </nav>

      {commentsPost && <CommentsPanel post={commentsPost} me={me} onClose={() => setCommentsPost(null)} onProfile={onProfile} />}
      {storyOpen !== null && groups[storyOpen] && <StoryViewer groups={groups} startIdx={storyOpen} me={me} onClose={() => setStoryOpen(null)} onProfile={onProfile} />}
      {storyUpload && <StoryUpload me={me} onClose={() => { setStoryUpload(false); api.get('/stories').then(d => setGroups(d.groups)); }} />}
      {editOpen && <EditProfile me={me} onClose={() => setEditOpen(false)} onSaved={setMe} />}
      {searchOpen && <SearchModal onClose={() => setSearchOpen(false)} onProfile={onProfile} onHashtag={(tag: string) => go('hashtag', tag)} />}

      {/* calls launcher + history */}
      <Modal open={callsOpen} onClose={() => setCallsOpen(false)} title="Calls">
        <CallsHome me={me} onProfile={onProfile} onCall={startCall} />
      </Modal>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title={createKind === 'reel' ? 'New reel' : t('newPost')}>
        <div className="flex gap-2 mb-3">
          <button onClick={() => setCreateKind('post')} className={`px-3 py-1.5 rounded-full text-xs ${createKind === 'post' ? 'bg-white text-black' : 'bg-neutral-800 text-neutral-400'}`}>Post</button>
          <button onClick={() => setCreateKind('reel')} className={`px-3 py-1.5 rounded-full text-xs ${createKind === 'reel' ? 'bg-white text-black' : 'bg-neutral-800 text-neutral-400'}`}>Reel</button>
        </div>
        <Composer me={me} kind={createKind} toast={toast} onCreated={(p) => { setCreateOpen(false); if (createKind === 'post') setPosts([p, ...posts]); else go('reels'); toast('posted'); }} />
      </Modal>

      {/* share modal */}
      <Modal open={!!sharedPost} onClose={() => setSharedPost(null)} title={t('share')}>
        <SharePanel post={sharedPost} me={me} onClose={() => setSharedPost(null)} toast={toast} />
      </Modal>

      {/* incoming call ring */}
      {incomingCall && !activeCall && (
        <IncomingCallModal
          incoming={incomingCall}
          me={me}
          onAccept={() => { setActiveCall({ id: incomingCall.callId, peer: incomingCall.peer, kind: incomingCall.kind, role: 'callee' }); setIncomingCall(null); }}
          onDecline={async () => {
            socket?.emit('call:answer', { callId: incomingCall.callId, accept: false });
            socket?.emit('call:end', { callId: incomingCall.callId });
            setIncomingCall(null);
          }}
        />
      )}
      {/* active call overlay */}
      {activeCall && (
        <CallOverlay
          call={activeCall}
          me={me}
          socket={socket}
          signalQueue={signalQueue}
          localPendingId={pendingIdRef.current}
          onClose={() => {
            setActiveCall(null);
            void callStartRef.current;
          }}
        />
      )}

      {offline && <div className="fixed top-0 left-0 right-0 bg-amber-600 text-white text-xs text-center py-1.5 z-[70]">You're offline — showing cached content. Messages sync when you reconnect.</div>}
      {toastMsg && <div className="fixed bottom-20 left-1/2 -translate-x-1/2 bg-white text-black text-sm font-medium px-4 py-2 rounded-full shadow-lg z-[90] animate-[fadein_.15s_ease-out]">{toastMsg.replace(/_/g, ' ')}</div>}
    </div>
  );
}

function Heart(p: any) { return <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20.8 4.6a5.5 5.5 0 00-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 00-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 000-7.8z" /></svg>; }

function IncomingCallModal({ incoming, onAccept, onDecline }: any) {
  return (
    <div className="fixed inset-0 z-[75] bg-black/80 backdrop-blur flex items-center justify-center p-6">
      <div className="bg-neutral-900 border border-neutral-800 rounded-3xl p-8 w-full max-w-xs text-center animate-[fadein_.2s_ease-out]">
        <div className="mx-auto w-24 h-24 rounded-full animate-pulse ring-4 ring-green-600/50 mb-4"><Avatar src={incoming.peer.avatarUrl} size={96} /></div>
        <div className="text-white text-lg font-semibold">{incoming.peer.displayName || incoming.peer.username}</div>
        <div className="text-neutral-400 text-sm mb-6">Incoming {incoming.kind} call…</div>
        <div className="flex justify-center gap-6">
          <button onClick={onDecline} className="w-16 h-16 rounded-full bg-red-600 flex items-center justify-center text-white active:scale-95 transition"><Phone size={24} className="rotate-[135deg]" /></button>
          <button onClick={onAccept} className="w-16 h-16 rounded-full bg-green-600 flex items-center justify-center text-white active:scale-95 transition animate-bounce"><Phone size={24} /></button>
        </div>
      </div>
    </div>
  );
}

function CallsHome({ me, onProfile, onCall }: any) {
  const [calls, setCalls] = useState<any[]>([]);
  const [q, setQ] = useState('');
  const [users, setUsers] = useState<any[]>([]);
  useEffect(() => { api.get('/calls/history').then(d => setCalls(d.calls)); }, []);
  useEffect(() => { if (q.length > 1) api.get(`/search?q=${encodeURIComponent(q)}`).then(d => setUsers(d.users)); else setUsers([]); }, [q]);
  const fmtDur = (s: number) => s ? `${Math.floor(s / 60)}m ${s % 60}s` : '';
  return (
    <div className="space-y-3">
      <Input placeholder="Call a user..." value={q} onChange={e => setQ(e.target.value)} />
      {users.map(u => (
        <button key={u.id} className="flex items-center gap-3 w-full p-2 hover:bg-neutral-800 rounded-lg" onClick={() => onCall(u.username, 'audio')}>
          <Avatar src={u.avatarUrl} size={32} />
          <span className="text-white text-sm flex-1 text-left">{u.username}</span>
          <Phone size={15} className="text-green-400" />
        </button>
      ))}
      <div className="max-h-60 overflow-y-auto">
        {calls.map(c => (
          <div key={c.id} className="flex items-center gap-3 py-2 border-b border-neutral-800 last:border-0">
            <Avatar src={c.peer.avatarUrl} size={30} />
            <div className="flex-1 text-left"><div className="text-white text-xs">@{c.peer.username}</div><div className="text-neutral-500 text-[11px]">{c.kind} · {c.status} · {fmtDur(c.durationSec)}</div></div>
            <button className="text-green-400" onClick={() => onCall(c.peer.username, c.kind)}><Phone size={15} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

function SearchModal({ onClose, onProfile, onHashtag }: any) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<any>(null);
  useEffect(() => {
    if (!q.trim()) { setRes(null); return; }
    const t2 = setTimeout(() => api.get(`/search?q=${encodeURIComponent(q)}`).then(setRes), 250);
    return () => clearTimeout(t2);
  }, [q]);
  return (
    <Modal open onClose={onClose} title={t('search')}>
      <Input autoFocus placeholder="Users, hashtags, posts..." value={q} onChange={e => setQ(e.target.value)} className="mb-3" />
      <div className="space-y-2 max-h-80 overflow-y-auto">
        {res?.users?.map((u: any) => <button key={u.id} className="flex items-center gap-3 w-full p-2 hover:bg-neutral-800 rounded-lg" onClick={() => onProfile(u.username)}>
          <Avatar src={u.avatarUrl} size={32} /><span className="text-white text-sm">{u.username}</span>
        </button>)}
        {res?.hashtags?.map((h: any) => <button key={h.tag} className="flex items-center gap-2 w-full p-2 hover:bg-neutral-800 rounded-lg" onClick={() => onHashtag(h.tag)}>
          <span className="text-white text-sm">#{h.tag}</span><span className="text-neutral-500 text-xs">{h.count}</span>
        </button>)}
      </div>
    </Modal>
  );
}

function SharePanel({ post, me, onClose, toast }: any) {
  const [convs, setConvs] = useState<any[]>([]);
  const [q, setQ] = useState('');
  useEffect(() => { api.get('/conversations').then(d => setConvs(d.conversations)); }, []);
  const list = convs.filter(c => !q || (c.members || []).some((m: any) => m.username?.includes(q)));
  const share = async (c: any) => {
    await api.post(`/conversations/${c.id}/messages`, { body: `Check this post: /p/${post.id}` });
    toast('shared'); onClose();
  };
  return <div className="space-y-2 max-h-80 overflow-y-auto">
    <Input placeholder="Search..." value={q} onChange={e => setQ(e.target.value)} className="mb-2" />
    {list.map(c => {
      const o = c.members?.find((m: any) => m.id !== me.id);
      return <button key={c.id} className="flex items-center gap-3 w-full p-2 hover:bg-neutral-800 rounded-lg" onClick={() => share(c)}>
        <Avatar src={o?.avatarUrl} size={32} /><span className="text-white text-sm">{c.is_group ? c.title : o?.username}</span>
      </button>;
    })}
    {!list.length && <p className="text-neutral-500 text-sm text-center py-4">No conversations yet</p>}
  </div>;
}

function JoinGroup({ code, me, socket, onDone }: any) {
  const [state, setState] = useState<'joining' | 'pending' | 'error'>('joining');
  const [msg, setMsg] = useState('');
  useEffect(() => {
    api.post(`/conversations/join/${code}`)
      .then(d => {
        if (d.pendingApproval) { setState('pending'); setMsg('Your request was sent to the group admins. You will see the group in your chats once they approve you.'); }
        else onDone(d.conversationId);
      })
      .catch((e: any) => { setState('error'); setMsg(e.code === 'invalid_link' ? 'This invite link is invalid or expired.' : e.code === 'banned_from_group' ? 'You were removed from this group and cannot rejoin.' : 'Could not join — try again.'); });
  }, [code]);
  return (
    <div className="min-h-screen bg-neutral-950 flex flex-col items-center justify-center p-6 text-center">
      <div className="w-16 h-16 rounded-full bg-violet-600 flex items-center justify-center mb-4"><Users size={28} className="text-white" /></div>
      {state === 'joining' && <><p className="text-white font-semibold">Joining group…</p><div className="mt-4"><Spinner /></div></>}
      {state === 'pending' && <p className="text-white max-w-sm">{msg}</p>}
      {state === 'error' && <p className="text-red-400 max-w-sm">{msg}</p>}
      {state !== 'joining' && <button onClick={() => { window.location.hash = '#/messages'; window.location.reload(); }} className="mt-6 text-violet-400 text-sm">Go to chats</button>}
    </div>
  );
}
