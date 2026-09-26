import React, { useEffect, useRef, useState } from 'react';
import { Search, Heart, MessageCircle, Bookmark, Play, TrendingUp, Users, Hash, Grid3X3, X, BadgeCheck, Repeat2, Volume2, VolumeX, Share2 } from 'lucide-react';
import { api } from '../api';
import { Avatar, Btn, Input, Spinner, fmt, timeAgo } from '../ui';
import { t } from '../i18n';
import type { User, Post } from '../types';

export function Explore({ me, onProfile, onOpenReel, onHashtag, onFollowChange }: {
  me: User | null; onProfile: (u: string) => void; onOpenReel: () => void; onHashtag: (tag: string) => void; onFollowChange?: () => void;
}) {
  const [data, setData] = useState<any>(null);
  useEffect(() => { api.get('/explore').then(setData); }, []);
  if (!data) return <div className="py-16 flex justify-center"><Spinner /></div>;
  return (
    <div className="p-4 space-y-8 pb-24">
      {data.suggested.length > 0 && (
        <section>
          <h2 className="text-white font-semibold mb-3 flex items-center gap-2"><Users size={16} /> {t('suggested')}</h2>
          <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1">
            {data.suggested.map((u: any) => (
              <div key={u.id} className="shrink-0 w-36 bg-neutral-900 rounded-2xl p-4 text-center">
                <button onClick={() => onProfile(u.username)}><Avatar src={u.avatarUrl} size={64} /></button>
                <div className="text-white text-sm font-medium mt-2 truncate">{u.username} {u.verified && <BadgeCheck size={12} className="inline text-sky-400" />}</div>
                <div className="text-neutral-500 text-xs">{fmt(u.followerCount || 0)} {t('followers')}</div>
                <FollowBtn username={u.username} onDone={onFollowChange} />
              </div>
            ))}
          </div>
        </section>
      )}
      {data.hashtags.length > 0 && (
        <section>
          <h2 className="text-white font-semibold mb-3 flex items-center gap-2"><TrendingUp size={16} /> {t('trending')}</h2>
          <div className="flex gap-2 flex-wrap">
            {data.hashtags.map((h: any) => (
              <button key={h.tag} onClick={() => onHashtag(h.tag)} className="bg-neutral-900 hover:bg-neutral-800 rounded-full px-3 py-1.5 text-sm text-white">
                #{h.tag} <span className="text-neutral-500 text-xs">{fmt(h.count)}</span>
              </button>
            ))}
          </div>
        </section>
      )}
      <section>
        <h2 className="text-white font-semibold mb-3 flex items-center gap-2"><Play size={16} /> Popular reels</h2>
        <ReelGrid posts={data.reels} onProfile={onProfile} />
      </section>
      <section>
        <h2 className="text-white font-semibold mb-3">Trending posts</h2>
        <div className="grid grid-cols-3 gap-1 sm:gap-2">
          {data.trending.map((p: Post) => (
            <button key={p.id} className="relative aspect-square bg-neutral-900 overflow-hidden rounded-lg group" onClick={() => p.kind === 'reel' ? onOpenReel() : onProfile(p.author.username)}>
              {p.media[0] ? (p.media[0].mime.startsWith('video') ? <video src={p.media[0].url} className="w-full h-full object-cover" muted /> : <img src={p.media[0].url} className="w-full h-full object-cover" loading="lazy" alt="" />) : <span className="text-neutral-600 text-xs p-1 line-clamp-3">{p.caption}</span>}
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center gap-4 text-white text-xs font-semibold">
                <span className="flex items-center gap-1"><Heart size={14} />{fmt(p.likeCount)}</span>
                <span className="flex items-center gap-1"><MessageCircle size={14} />{fmt(p.commentCount)}</span>
              </div>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

export function FollowBtn({ username, onDone, className = '' }: { username: string; onDone?: () => void; className?: string }) {
  const [state, setState] = useState<'follow' | 'following' | 'load'>('follow');
  return (
    <Btn variant={state === 'follow' ? 'primary' : 'ghost'} className={`mt-2 w-full text-xs follow-morph ${state !== 'follow' ? 'success-pulse' : ''} ${className}`}
      onClick={async () => {
        setState('load');
        const d = await api.post(`/users/${username}/follow`);
        setState(d.following || d.requested ? 'following' : 'follow');
        onDone?.();
      }}>
      {state === 'load' ? '...' : state === 'follow' ? t('follow') : t('following')}
    </Btn>
  );
}

export function ReelGrid({ posts, onProfile }: { posts: Post[]; onProfile: (u: string) => void }) {
  return <div className="grid grid-cols-3 gap-1 sm:gap-2">
    {posts.map(p => (
      <button key={p.id} className="relative aspect-[9/14] bg-neutral-900 overflow-hidden rounded-lg">
        {p.media[0] ? (p.media[0].mime.startsWith('video') ? <video src={p.media[0].url} className="w-full h-full object-cover" muted /> : <img src={p.media[0].url} className="w-full h-full object-cover" loading="lazy" alt="" />) : null}
        <div className="absolute bottom-1 left-1 text-white text-[11px] font-semibold flex items-center gap-1"><Play size={10} />{fmt(p.viewCount)}</div>
      </button>
    ))}
  </div>;
}

export function SearchPage({ onProfile, onHashtag, onOpenComments, onShare, toast, me }: any) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<any>(null);
  useEffect(() => {
    if (!q.trim()) { setRes(null); return; }
    const t2 = setTimeout(() => api.get(`/search?q=${encodeURIComponent(q)}`).then(setRes), 250);
    return () => clearTimeout(t2);
  }, [q]);
  return (
    <div className="p-4 pb-24">
      <div className="relative mb-4">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
        <Input autoFocus placeholder={t('search')} value={q} onChange={e => setQ(e.target.value)} className="pl-9" />
      </div>
      {!res && <RecentSearches />}
      {res && (
        <div className="space-y-6">
          {res.hashtags.length > 0 && <div className="flex flex-wrap gap-2">{res.hashtags.map((h: any) => <button key={h.tag} onClick={() => onHashtag(h.tag)} className="bg-neutral-900 rounded-full px-3 py-1.5 text-sm text-white">#{h.tag}<span className="text-neutral-500 ml-1 text-xs">{fmt(h.count)}</span></button>)}</div>}
          {res.users.length > 0 && <div className="space-y-3">{res.users.map((u: any) => (
            <button key={u.id} className="flex items-center gap-3 w-full" onClick={() => onProfile(u.username)}>
              <Avatar src={u.avatarUrl} size={44} />
              <div className="text-left flex-1"><div className="text-white text-sm font-semibold">{u.username}</div><div className="text-neutral-500 text-xs">{u.displayName} · {fmt(u.followerCount || 0)} followers</div></div>
            </button>))}</div>}
          {res.posts.length > 0 && <div className="grid grid-cols-3 gap-1">{res.posts.map((p: Post) => <MiniPost key={p.id} p={p} onClick={() => onProfile(p.author.username)} />)}</div>}
        </div>
      )}
    </div>
  );
}

function RecentSearches() {
  const [exp, setExp] = useState<any>(null);
  useEffect(() => { api.get('/explore').then(setExp); }, []);
  if (!exp) return null;
  return <div className="grid grid-cols-3 gap-1">{exp.trending.slice(0, 9).map((p: Post) => <MiniPost key={p.id} p={p} onClick={() => {}} />)}</div>;
}

function MiniPost({ p, onClick }: { p: Post; onClick: () => void }) {
  return <button onClick={onClick} className="aspect-square bg-neutral-900 overflow-hidden">
    {p.media[0] ? (p.media[0].mime.startsWith('video') ? <video src={p.media[0].url} className="w-full h-full object-cover" muted /> : <img src={p.media[0].url} className="w-full h-full object-cover" loading="lazy" alt="" />) : <span className="text-neutral-600 text-xs p-1 line-clamp-4">{p.caption}</span>}
  </button>;
}

export function HashtagPage({ tag, onBack }: { tag: string; onBack: () => void }) {
  const [posts, setPosts] = useState<Post[]>([]);
  useEffect(() => { api.get(`/hashtags/${encodeURIComponent(tag)}`).then(d => setPosts(d.posts)); }, [tag]);
  return (
    <div className="pb-24">
      <div className="flex items-center gap-3 p-4">
        <button onClick={onBack} className="text-white"><X size={20} /></button>
        <h1 className="text-white font-semibold flex items-center gap-1"><Hash size={18} />{tag}</h1>
      </div>
      <div className="grid grid-cols-3 gap-1">{posts.map(p => <MiniPost key={p.id} p={p} onClick={() => {}} />)}</div>
    </div>
  );
}

export function ReelsFeed({ me, onOpenComments, onProfile, toast, socket, onShare }: {
  me: User; onOpenComments: (p: Post) => void; onProfile: (u: string) => void; toast: (s: string) => void; socket: any; onShare?: (p: Post) => void;
}) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [globalMuted, setGlobalMuted] = useState(true); // sound state follows you across reels
  const container = useRef<HTMLDivElement>(null);
  const load = async (cur?: string | null) => {
    const d = await api.get(`/feed?reels=1&scope=explore&limit=5${cur ? `&cursor=${encodeURIComponent(cur)}` : ''}`);
    setPosts(p => cur ? [...p, ...d.posts] : d.posts);
    setCursor(d.nextCursor);
  };
  useEffect(() => { load(); }, []);
  const onScroll = () => {
    const el = container.current!;
    if (el.scrollTop + el.clientHeight > el.scrollHeight - 600 && cursor) load(cursor);
    // DETERMINISTIC: exactly one active reel — the child most visible in the viewport
    const kids = Array.from(el.children) as HTMLElement[];
    let best: string | null = null; let bestArea = 0;
    for (const k of kids) {
      const r = k.getBoundingClientRect();
      const visible = Math.max(0, Math.min(r.bottom, el.clientHeight + r.top >= 0 ? window.innerHeight : 0) - Math.max(r.top, 0));
      const area = Math.min(r.height, visible);
      if (visible > r.height * 0.35 && area > bestArea) { bestArea = area; best = k.querySelector('[data-post]')?.getAttribute('data-post') || null; }
    }
    if (best && best !== activeId) setActiveId(best);
    else if (!best && activeId) setActiveId(null); // mid-transition: pause everything
  };
  const viewed = useRef(new Set<string>());
  const markView = (p: Post) => {
    if (viewed.current.has(p.id)) return;
    viewed.current.add(p.id);
    api.post(`/posts/${p.id}/view`);
    setPosts(ps => ps.map(x => x.id === p.id ? { ...x, viewCount: x.viewCount + 1 } : x));
  };
  // hard guarantee: on scroll end, pause every video that isn't the active reel
  useEffect(() => {
    document.querySelectorAll('video').forEach(v => {
      const post = v.closest('[data-post]');
      if (!post || post.getAttribute('data-post') !== activeId) { if (!v.paused) v.pause(); }
    });
  }, [activeId]);
  return (
    <div ref={container} onScroll={onScroll} className="h-[calc(100vh-110px)] overflow-y-scroll snap-y snap-mandatory no-scrollbar">
      {posts.map(p => (
        <div key={p.id} className="h-full snap-start relative flex items-center justify-center">
          <div className="relative h-full w-full max-w-[420px]" data-post={p.id}>
            <ReelItem post={p} me={me} activeId={activeId} globalMuted={globalMuted} setGlobalMuted={setGlobalMuted}
              onVisible={() => markView(p)} onOpenComments={onOpenComments} onProfile={onProfile} toast={toast}
              onShare={onShare} setPost={(np: Post) => setPosts(ps => ps.map(x => x.id === np.id ? np : x))} />
          </div>
        </div>
      ))}
      {!posts.length && <div className="flex justify-center items-center h-full"><Spinner /></div>}
    </div>
  );
}

function ReelItem({ post, me, activeId, globalMuted, setGlobalMuted, onVisible, onOpenComments, onProfile, toast, onShare, setPost }: any) {
  const ref = useRef<HTMLDivElement>(null);
  const vid = useRef<HTMLVideoElement>(null);
  const isThisActive = activeId === post.id;
  // unmute carries across reels: sound follows the user
  useEffect(() => {
    const v = vid.current;
    if (!v) return;
    if (isThisActive) {
      v.muted = globalMuted;
      v.play().then(() => onVisible()).catch(() => {});
    } else {
      v.pause();
    }
  }, [isThisActive, globalMuted, post.id]);
  const act = async (fn: () => Promise<any>) => { try { setPost({ ...post, ...await fn() }); } catch (e: any) { toast(e.code); } };
  return (
    <div ref={ref} className="relative h-full bg-black flex items-center justify-center">
      {post.media[0]?.mime.startsWith('video')
        ? <video ref={vid} src={post.media[0].url} preload="metadata" className="h-full w-full object-cover" loop playsInline
            onClick={() => { if (vid.current!.paused) vid.current!.play(); else vid.current!.pause(); }} />
        : post.media[0] ? <img src={post.media[0].url} className="h-full w-full object-cover" alt="" /> : null}
      <button className="absolute top-4 right-4 text-white/90 bg-black/40 rounded-full p-2 z-10"
        onClick={() => setGlobalMuted(!globalMuted)}>{globalMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}</button>
      <div className="absolute bottom-6 left-4 right-16">
        <button className="flex items-center gap-2 text-white font-semibold text-sm" onClick={() => onProfile(post.author.username)}>
          <Avatar src={post.author.avatarUrl} size={30} />{post.author.username}
        </button>
        {post.caption && <p className="text-white text-sm mt-2 line-clamp-2">{post.caption}</p>}
      </div>
      <div className="absolute bottom-6 right-3 flex flex-col gap-5 items-center">
        <button onClick={() => act(async () => { const d = await api.post(`/posts/${post.id}/like`); return { liked: d.liked, likeCount: d.likeCount }; })}>
          <Heart size={28} className={post.liked ? 'fill-red-500 text-red-500' : 'text-white'} /><span className="text-white text-xs">{fmt(post.likeCount)}</span>
        </button>
        <button onClick={() => onOpenComments(post)}><MessageCircle size={26} className="text-white" /><span className="text-white text-xs">{fmt(post.commentCount)}</span></button>
        <button onClick={() => act(async () => { const d = await api.post(`/posts/${post.id}/repost`); return { reposted: d.reposted, repostCount: d.repostCount }; })}>
          <Repeat2 size={26} className={post.reposted ? 'text-green-500' : 'text-white'} />
        </button>
        <button onClick={() => onShare?.(post)}><Share2 size={24} className="text-white" /></button>
        <button onClick={async () => { const d = await api.post(`/posts/${post.id}/save`); setPost({ ...post, saved: d.saved }); }}>
          <Bookmark size={26} className={post.saved ? 'fill-white text-white' : 'text-white'} />
        </button>
      </div>
    </div>
  );
}