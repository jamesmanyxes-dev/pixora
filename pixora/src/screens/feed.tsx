import React, { useEffect, useRef, useState } from 'react';
import { Heart, MessageCircle, Send, Bookmark, Repeat2, MoreHorizontal, Plus, X, Play, Volume2, VolumeX, Eye, Trash2, Archive, MapPin, BadgeCheck } from 'lucide-react';
import { api } from '../api';
import { Avatar, Btn, Input, Modal, Spinner, timeAgo, fmt } from '../ui';
import { t } from '../i18n';
import { CameraCapture } from '../components/camera';
const CameraIcon = (p: any) => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>;
import type { User, Post, Comment } from '../types';

export function PostCard({ post, me, onOpenComments, onProfile, onChange, onShare, toast, activeVideoId, setActiveVideoId }: {
  post: Post; me: User | null; onOpenComments: (p: Post) => void; onProfile: (u: string) => void;
  onChange: (p: Post) => void; onShare: (p: Post) => void; toast: (s: string) => void;
  activeVideoId?: string | null; setActiveVideoId?: (id: string | null) => void;
}) {
  const [idx, setIdx] = useState(0);
  const [menu, setMenu] = useState(false);
  const [likesOpen, setLikesOpen] = useState(false);
  const media = post.media || [];
  const mine = me && post.author.id === me.id;

  const act = async (fn: () => Promise<any>) => { try { const d = await fn(); onChange({ ...post, ...d.postData }); } catch (e: any) { toast(e.code || e.message); } };

  return (
    <article className="bg-neutral-950 border-b border-neutral-900">
      <div className="flex items-center gap-3 px-4 py-3">
        <button onClick={() => onProfile(post.author.username)}><Avatar src={post.author.avatarUrl} size={36} ring={!post.followingAuthor && !mine} /></button>
        <div className="flex-1 min-w-0">
          <button onClick={() => onProfile(post.author.username)} className="flex items-center gap-1.5 text-sm text-white font-semibold hover:underline">
            {post.author.username} {post.author.verified && <BadgeCheck size={15} className="text-sky-400" />}
          </button>
          <div className="text-xs text-neutral-500 flex items-center gap-1">{timeAgo(post.createdAt)}{post.location && <> · <MapPin size={10} /> {post.location}</>}</div>
        </div>
        <button onClick={() => setMenu(!menu)} className="text-neutral-400 hover:text-white"><MoreHorizontal size={20} /></button>
      </div>
      {menu && (
        <div className="mx-4 mb-2 bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden text-sm">
          {mine ? (
            <>
              <button className="block w-full text-left px-4 py-2.5 text-white hover:bg-neutral-800" onClick={async () => { setMenu(false); const c = prompt('Edit caption', post.caption); if (c !== null) { await api.patch(`/posts/${post.id}`, { caption: c }); onChange({ ...post, caption: c }); } }}><Edit2 size={14} className="inline mr-2" />Edit</button>
              <button className="block w-full text-left px-4 py-2.5 text-white hover:bg-neutral-800" onClick={() => act(async () => { await api.post(`/posts/${post.id}/archive`); onChange({ ...post, status: 'archived' }); })}><Archive size={14} className="inline mr-2" />Archive</button>
              <button className="block w-full text-left px-4 py-2.5 text-red-400 hover:bg-neutral-800" onClick={() => act(async () => { await api.del(`/posts/${post.id}`); onChange({ ...post, status: 'deleted' }); })}><Trash2 size={14} className="inline mr-2" />Delete</button>
              <button className="block w-full text-left px-4 py-2.5 text-white hover:bg-neutral-800" onClick={() => setMenu(false)}>Cancel</button>
            </>
          ) : (
            <>
              <button className="block w-full text-left px-4 py-2.5 text-white hover:bg-neutral-800" onClick={() => { onShare(post); setMenu(false); }}><Send size={14} className="inline mr-2" />{t('share')}</button>
              <button className="block w-full text-left px-4 py-2.5 text-red-400 hover:bg-neutral-800" onClick={async () => { await api.post('/reports', { targetType: 'post', targetId: post.id, reason: 'inappropriate' }); toast('reported'); setMenu(false); }}>Report</button>
              <button className="block w-full text-left px-4 py-2.5 text-white hover:bg-neutral-800" onClick={() => setMenu(false)}>Cancel</button>
            </>
          )}
        </div>
      )}
      <div className="relative bg-neutral-900 select-none" onDoubleClick={() => !post.liked && act(async () => { const d = await api.post(`/posts/${post.id}/like`); onChange({ ...post, liked: d.liked, likeCount: d.likeCount }); })}>
        <ImgWithAlt m={media[idx] ?? null} alt={post.altText || ''} activeId={activeVideoId} myId={post.id} onVisible={() => setActiveVideoId?.(post.id)} />
        {media.length > 1 && <>
          <button className="absolute left-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-black/50 text-white" onClick={() => setIdx((idx - 1 + media.length) % media.length)}>‹</button>
          <button className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-black/50 text-white" onClick={() => setIdx((idx + 1) % media.length)}>›</button>
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">{media.map((_, i) => <span key={i} className={`w-1.5 h-1.5 rounded-full ${i === idx ? 'bg-white' : 'bg-white/40'}`} />)}</div>
        </>}
      </div>
      <div className="px-4 py-3">
        <div className="flex items-center gap-4 mb-2">
          <button onClick={() => act(async () => { const d = await api.post(`/posts/${post.id}/like`); onChange({ ...post, liked: d.liked, likeCount: d.likeCount }); })} className="transition active:scale-90">
            <Heart size={24} className={post.liked ? 'fill-red-500 text-red-500' : 'text-white'} />
          </button>
          <button onClick={() => onOpenComments(post)}><MessageCircle size={22} className="text-white" /></button>
          <button onClick={() => act(async () => { const d = await api.post(`/posts/${post.id}/repost`); onChange({ ...post, reposted: d.reposted, repostCount: d.repostCount }); })}>
            <Repeat2 size={24} className={post.reposted ? 'text-green-500' : 'text-white'} />
          </button>
          <button onClick={() => onShare(post)}><Send size={22} className="text-white" /></button>
          <button className="ml-auto" onClick={() => act(async () => { const d = await api.post(`/posts/${post.id}/save`); onChange({ ...post, saved: d.saved }); })}>
            <Bookmark size={22} className={post.saved ? 'fill-white text-white' : 'text-white'} />
          </button>
        </div>
        {!post.likesHidden && <button className="text-sm text-white font-semibold" onClick={() => setLikesOpen(true)}>{fmt(post.likeCount)} likes</button>}
        {post.caption && <p className="text-sm text-neutral-200 mt-1 whitespace-pre-wrap break-words"><Linkify text={post.caption} onProfile={onProfile} /></p>}
        <button className="text-sm text-neutral-500 mt-1" onClick={() => onOpenComments(post)}>{fmt(post.commentCount)} {t('comments')}</button>
      </div>
      <Modal open={likesOpen} onClose={() => setLikesOpen(false)} title="Likes">
        <LikesList id={post.id} onProfile={onProfile} />
      </Modal>
    </article>
  );
}

const Edit2 = (p: any) => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>;

function Linkify({ text, onProfile }: { text: string; onProfile: (u: string) => void }) {
  return <>{text.split(/(\s+)/).map((w, i) =>
    w.startsWith('#') ? <span key={i} className="text-sky-400 cursor-pointer" onClick={() => onProfile('#' + w.slice(1))}>{w}</span>
      : w.startsWith('@') && w.length > 1 ? <span key={i} className="text-sky-400 cursor-pointer" onClick={() => onProfile(w.slice(1))}>{w}</span>
        : w)}</>;
}

export function ImgWithAlt({ m, alt, activeId, myId, onVisible }: { m?: { url: string; mime: string; duration_ms?: number } | null; alt: string; activeId?: string | null; myId?: string; onVisible?: () => void }) {
  if (!m) return <div className="aspect-square bg-neutral-900" />;
  if (m.mime.startsWith('video')) return <VideoPlayer src={m.url} activeId={activeId} myId={myId} onVisible={onVisible} />;
  return <img src={m.url} alt={alt} loading="lazy" className="w-full object-cover max-h-[70vh]" />;
}

export function VideoPlayer({ src, activeId, myId, onVisible }: { src: string; activeId?: string | null; myId?: string; onVisible?: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);
  // strict single-play across the whole app: when another video becomes active, pause this one
  useEffect(() => {
    if (activeId && myId && activeId !== myId) ref.current?.pause();
  }, [activeId, myId]);
  const [playing, setPlaying] = useState(true);
  return (
    <div className="relative bg-black">
      <video ref={ref} src={src} preload="metadata" muted={muted} loop playsInline
        className="w-full max-h-[80vh] object-cover"
        onPlay={() => { setPlaying(true); onVisible?.(); }}
        onClick={() => { const v = ref.current!; if (v.paused) { v.play(); setPlaying(true); } else { v.pause(); setPlaying(false); } }} />
      {!playing && <Play size={48} className="absolute inset-0 m-auto text-white/80" />}
      <button className="absolute bottom-3 right-3 text-white/90 bg-black/40 rounded-full p-2" onClick={() => { setMuted(!muted); if (ref.current) ref.current.muted = !muted; }}>
        {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
      </button>
    </div>
  );
}

function LikesList({ id, onProfile }: { id: string; onProfile: (u: string) => void }) {
  const [users, setUsers] = useState<any[]>([]);
  useEffect(() => { api.get(`/posts/${id}/likes`).then(d => setUsers(d.users)); }, [id]);
  return <div className="space-y-3 max-h-80 overflow-y-auto">
    {users.map(u => (
      <button key={u.id} className="flex items-center gap-3 w-full" onClick={() => onProfile(u.username)}>
        <Avatar src={u.avatarUrl} size={36} />
        <div className="text-left"><div className="text-white text-sm font-medium">{u.username}</div><div className="text-neutral-500 text-xs">{u.displayName}</div></div>
      </button>
    ))}
  </div>;
}

export function CommentsPanel({ post, me, onClose, onProfile }: { post: Post; me: User | null; onClose: () => void; onProfile: (u: string) => void }) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const load = () => api.get(`/posts/${post.id}/comments`).then(d => setComments(d.comments));
  useEffect(() => { load(); }, [post.id]);
  const send = async () => {
    if (!text.trim()) return;
    await api.post(`/posts/${post.id}/comments`, { body: text, parentId: replyTo?.id });
    setText(''); setReplyTo(null); load();
  };
  const roots = comments.filter(c => !c.parentId);
  const repliesOf = (id: string) => comments.filter(c => c.parentId === id);
  const Row = ({ c, depth = 0 }: { c: Comment; depth?: number }) => (
    <div className={`flex gap-2 ${depth ? 'ml-8' : ''}`}>
      <Avatar src={c.author.avatarUrl} size={28} />
      <div className="flex-1">
        <div className="text-sm bg-neutral-900 rounded-2xl px-3 py-2">
          <button className="text-white font-semibold text-xs" onClick={() => onProfile(c.author.username)}>{c.author.username}</button>
          {c.deleted ? <span className="text-neutral-500 text-xs italic"> deleted</span> : <span className="text-neutral-200"> {c.body}</span>}
        </div>
        <div className="flex gap-3 text-[11px] text-neutral-500 mt-1 px-1">
          <span>{timeAgo(c.createdAt)}</span>
          <button onClick={async () => { const d = await api.post(`/comments/${c.id}/like`); setComments(cs => cs.map(x => x.id === c.id ? { ...x, liked: d.liked, likeCount: d.likeCount } : x)); }}>{c.likeCount > 0 ? `${c.likeCount} ` : ''}like</button>
          {me && <button onClick={() => setReplyTo(c)}>reply</button>}
          {me && c.author.id === me.id && <button onClick={async () => { await api.del(`/comments/${c.id}`); load(); }}>delete</button>}
        </div>
        {repliesOf(c.id).map(r => <div key={r.id} className="mt-2"><Row c={r} depth={1} /></div>)}
      </div>
    </div>
  );
  return (
    <div className="fixed inset-0 z-40 bg-black/70 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="bg-neutral-950 border border-neutral-800 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md h-[70vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-neutral-800 flex justify-between items-center">
          <h3 className="text-white font-semibold">{t('comments')}</h3>
          <button onClick={onClose} className="text-neutral-400"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {roots.length === 0 && <p className="text-neutral-500 text-sm text-center mt-8">No comments yet</p>}
          {roots.map(c => <Row key={c.id} c={c} />)}
        </div>
        {me && (
          <div className="p-3 border-t border-neutral-800">
            {replyTo && <div className="text-xs text-neutral-500 mb-1">Replying to @{replyTo.author.username} <button onClick={() => setReplyTo(null)} className="text-white ml-1">✕</button></div>}
            <div className="flex gap-2">
              <Input placeholder={t('comment') + '...'} value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()} autoFocus />
              <Btn onClick={send} disabled={!text.trim()}>{t('send')}</Btn>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function Composer({ me, onCreated, kind = 'post', toast }: { me: User; onCreated: (p: Post) => void; kind?: 'post' | 'reel'; toast: (s: string) => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [caption, setCaption] = useState('');
  const [location, setLocation] = useState('');
  const [alt, setAlt] = useState('');
  const [busy, setBusy] = useState(false);
  const [scheduled, setScheduled] = useState('');
  const [exclusive, setExclusive] = useState(false);
  const [previews, setPreviews] = useState<string[]>([]);
  const [camera, setCamera] = useState<null | 'photo' | 'video'>(null);
  useEffect(() => { setPreviews(files.map(f => URL.createObjectURL(f))); }, [files]);
  const submit = async () => {
    if (!files.length && !caption.trim()) return toast('add media or caption');
    setBusy(true);
    try {
      const fd = new FormData();
      files.slice(0, 10).forEach(f => fd.append('file', f));
      fd.append('caption', caption);
      fd.append('kind', kind);
      if (location) fd.append('location', location);
      if (alt) fd.append('altText', alt);
      if (scheduled) fd.append('scheduledAt', new Date(scheduled).toISOString());
      if (exclusive) fd.append('exclusive', 'true');
      const d = await api.upload('/posts', fd);
      onCreated(d.post);
      setFiles([]); setCaption(''); setLocation(''); setAlt(''); setScheduled('');
    } catch (e: any) { toast(e.code || 'failed'); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <label className="border-2 border-dashed border-neutral-800 rounded-2xl p-6 text-center cursor-pointer hover:border-violet-500 transition">
          <input type="file" multiple accept="image/*,video/*" className="hidden" onChange={e => setFiles([...e.target.files!])} />
          <Plus size={24} className="mx-auto text-neutral-500" />
          <p className="text-neutral-400 text-xs mt-2">Gallery</p>
        </label>
        <button onClick={() => setCamera('photo')} className="border-2 border-dashed border-neutral-800 rounded-2xl p-6 hover:border-violet-500 transition">
          <CameraIcon size={24} className="mx-auto text-neutral-500" />
          <p className="text-neutral-400 text-xs mt-2">Camera</p>
        </button>
      </div>
      {files.length > 0 && (
        <div className="flex gap-2 overflow-x-auto">{previews.map((p, i) => (
          <div key={i} className="relative w-16 h-16 rounded-xl overflow-hidden bg-neutral-800">
            {files[i].type.startsWith('video') ? <video src={p} className="w-full h-full object-cover" /> : <img src={p} className="w-full h-full object-cover" />}
            <button className="absolute top-1 right-1 bg-black/60 rounded-full p-0.5" onClick={() => setFiles(files.filter((_, j) => j !== i))}><X size={12} className="text-white" /></button>
          </div>))}
        </div>
      )}
      {previews.length > 0 && (
        <div className="flex gap-2 overflow-x-auto">{previews.map((p, i) => (
          <div key={i} className="relative w-20 h-20 rounded-xl overflow-hidden bg-neutral-800">
            {files[i].type.startsWith('video') ? <video src={p} className="w-full h-full object-cover" /> : <img src={p} className="w-full h-full object-cover" />}
            <button className="absolute top-1 right-1 bg-black/60 rounded-full p-0.5" onClick={() => setFiles(files.filter((_, j) => j !== i))}><X size={12} className="text-white" /></button>
          </div>))}
        </div>
      )}
      <textarea value={caption} onChange={e => setCaption(e.target.value)} placeholder={t('caption')} rows={3}
        className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2.5 text-sm text-white placeholder-neutral-500 outline-none focus:border-violet-500 resize-none" />
      <div className="grid grid-cols-2 gap-2">
        <Input placeholder="Location" value={location} onChange={e => setLocation(e.target.value)} />
        <Input placeholder="Alt text (a11y)" value={alt} onChange={e => setAlt(e.target.value)} />
      </div>
      <div className="flex items-center gap-3 text-xs text-neutral-400">
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={exclusive} onChange={e => setExclusive(e.target.checked)} />Subscribers-only</label>
        <label className="flex items-center gap-1.5"><input type="datetime-local" value={scheduled} onChange={e => setScheduled(e.target.value)} className="bg-neutral-900 rounded-lg px-2 py-1" />Schedule</label>
      </div>
      {camera && <CameraCapture kind={camera} onClose={() => setCamera(null)} onCaptured={file => { setFiles(fs => [...fs, file]); setCamera(null); }} />}
      <Btn onClick={submit} disabled={busy} className="w-full">{busy ? <Spinner className="mx-auto" /> : `${t('post')} ${kind === 'reel' ? 'reel' : ''}`}</Btn>
    </div>
  );
}

// ---------- stories ----------
export function StoriesBar({ me, groups, onAdd, onOpen }: { me: User; groups: any[]; onAdd: () => void; onOpen: (gi: number) => void }) {
  return (
    <div className="flex gap-3 px-4 py-3 overflow-x-auto border-b border-neutral-900 no-scrollbar">
      <button className="flex flex-col items-center gap-1 w-16" onClick={onAdd}>
        <div className="relative"><Avatar src={me.avatarUrl} size={56} /><div className="absolute -bottom-0.5 -right-0.5 bg-violet-600 rounded-full p-0.5"><Plus size={12} className="text-white" /></div></div>
        <span className="text-[11px] text-neutral-400 truncate w-16 text-center">Your story</span>
      </button>
      {groups.map((g, i) => (
        <button key={g.user.id} className="flex flex-col items-center gap-1 w-16" onClick={() => onOpen(i)}>
          <Avatar src={g.user.avatarUrl} size={56} ring={!g.allViewed} />
          <span className={`text-[11px] truncate w-16 text-center ${g.allViewed ? 'text-neutral-500' : 'text-white'}`}>{g.user.username}</span>
        </button>
      ))}
    </div>
  );
}

export function StoryViewer({ groups, startIdx, me, onClose, onProfile }: { groups: any[]; startIdx: number; me: User; onClose: () => void; onProfile: (u: string) => void }) {
  const [gi, setGi] = useState(startIdx);
  const [si, setSi] = useState(0);
  const [reply, setReply] = useState('');
  const g = groups[gi];
  const item = g?.items[si];
  useEffect(() => { if (item) api.post(`/stories/${item.id}/view`); }, [item?.id]);
  useEffect(() => { const t2 = setTimeout(() => { if (si + 1 < g?.items.length) setSi(si + 1); else if (gi + 1 < groups.length) { setGi(gi + 1); setSi(0); } else onClose(); }, 5000); return () => clearTimeout(t2); }, [si, gi]);
  if (!item) return null;
  const isMine = g.user.id === me.id;
  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      <div className="flex gap-1 px-2 pt-3">{g.items.map((_: any, i: number) => <div key={i} className={`h-0.5 flex-1 rounded ${i <= si ? 'bg-white' : 'bg-white/30'}`} />)}</div>
      <div className="flex items-center gap-3 px-4 py-3">
        <Avatar src={g.user.avatarUrl} size={32} />
        <button className="text-white text-sm font-semibold" onClick={() => onProfile(g.user.username)}>{g.user.username}</button>
        <span className="text-neutral-400 text-xs">{timeAgo(item.createdAt)}</span>
        <button className="ml-auto text-white" onClick={onClose}><X size={22} /></button>
      </div>
      <div className="flex-1 flex items-center justify-center relative" onClick={(e) => {
        if (e.clientX > window.innerWidth / 2) { if (si + 1 < g.items.length) setSi(si + 1); else if (gi + 1 < groups.length) { setGi(gi + 1); setSi(0); } else onClose(); }
        else if (si > 0) setSi(si - 1); else if (gi > 0) { setGi(gi - 1); setSi(0); }
      }}>
        <ImgWithAlt m={{ url: item.mediaUrl, mime: 'image/jpeg' }} alt={item.caption || 'story'} />
        {item.caption && <p className="absolute bottom-24 text-white text-sm px-4 text-center">{item.caption}</p>}
        <div className="absolute bottom-0 left-0 right-0 p-4 flex gap-2" onClick={e => e.stopPropagation()}>
          {isMine ? <button className="flex-1 bg-black/60 rounded-full py-2 text-white text-sm flex items-center justify-center gap-2" onClick={async () => { const d = await api.get(`/stories/${item.id}/views`); alert(d.viewers.map((v: any) => v.username).join(', ') || 'No views yet'); }}><Eye size={14} />Viewers</button>
            : <>
              <Input placeholder={`Reply to ${g.user.username}...`} value={reply} onChange={e => setReply(e.target.value)} className="bg-black/60 border-white/20" />
              <Btn onClick={async () => { await api.post(`/stories/${item.id}/reply`, { body: reply }); setReply(''); onClose(); }}>Send</Btn>
            </>}
        </div>
      </div>
    </div>
  );
}

export function StoryUpload({ me, onClose }: { me: User; onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const [camera, setCamera] = useState(false);
  const [camKind, setCamKind] = useState<'photo' | 'video'>('photo');
  return (
    <Modal open onClose={onClose} title={t('story')}>
      <div className="grid grid-cols-2 gap-2 mb-3">
        <label className="border-2 border-dashed border-neutral-800 rounded-2xl p-5 text-center cursor-pointer hover:border-violet-500">
          <input type="file" accept="image/*,video/*" className="hidden" onChange={e => setFile(e.target.files![0])} />
          <Plus size={20} className="mx-auto text-neutral-500" /><p className="text-neutral-400 text-xs mt-1">Gallery</p>
        </label>
        <button onClick={() => { setCamKind('photo'); setCamera(true); }} className="border-2 border-dashed border-neutral-800 rounded-2xl p-5 hover:border-violet-500">
          <CameraIcon size={20} className="mx-auto text-neutral-500" /><p className="text-neutral-400 text-xs mt-1">Camera</p>
        </button>
      </div>
      {camera && <CameraCapture kind={camKind} onClose={() => setCamera(false)} onCaptured={f => { setFile(f); setCamera(false); }} />}
      {file && file.type.startsWith('video') ? <video src={URL.createObjectURL(file)} className="rounded-xl w-full mb-3" controls /> :
        file ? <img src={URL.createObjectURL(file)} className="rounded-xl w-full mb-3" /> : null}
      <Input placeholder="Caption" value={caption} onChange={e => setCaption(e.target.value)} className="mb-3" />
      <Btn className="w-full" disabled={!file || busy} onClick={async () => {
        setBusy(true);
        const fd = new FormData(); fd.append('file', file!); fd.append('caption', caption);
        try { await api.upload('/stories', fd); onClose(); } catch (e: any) { alert(e.code); } finally { setBusy(false); }
      }}>Share to story</Btn>
    </Modal>
  );
}

export function Feed({ me, posts, setPosts, onOpenComments, onProfile, onShare, toast, socket }: {
  me: User; posts: Post[]; setPosts: (p: Post[]) => void; onOpenComments: (p: Post) => void; onProfile: (u: string) => void; onShare: (p: Post) => void; toast: (s: string) => void; socket: any;
}) {
  const [scope, setScope] = useState<'following' | 'foryou'>('following');
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const sentinel = useRef<HTMLDivElement>(null);
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null);
  const load = async (reset = false) => {
    setLoading(true);
    try {
      const d = await api.get(`/feed?scope=${reset ? scope : scope}&limit=6${cursor && !reset ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      setPosts(reset ? d.posts : [...posts, ...d.posts.filter((np: Post) => !posts.some(p => p.id === np.id))]);
      setCursor(d.nextCursor);
    } finally { setLoading(false); }
  };
  useEffect(() => { setCursor(null); load(true); }, [scope]);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io2 = new IntersectionObserver(e => { if (e[0].isIntersecting && cursor && !loading) load(); }, { rootMargin: '400px' });
    io2.observe(el); return () => io2.disconnect();
  }, [cursor, loading]);
  useEffect(() => {
    const h = ({ post }: any) => { if (post.author.id !== me.id) setPosts([post, ...posts.filter(p => p.id !== post.id)]); };
    const hd = ({ id }: any) => setPosts(posts.filter(p => p.id !== id));
    socket?.on('post:new', h); socket?.on('post:deleted', hd);
    return () => { socket?.off('post:new', h); socket?.off('post:deleted', hd); };
  }, [posts, socket]);
  const update = (p: Post) => setPosts(p.status === 'deleted' ? posts.filter(x => x.id !== p.id) : posts.map(x => x.id === p.id ? p : x));
  return (
    <div className="pb-4">
      <div className="flex gap-2 px-4 py-3">
        {(['following', 'foryou'] as const).map(s => (
          <button key={s} onClick={() => setScope(s)} className={`px-4 py-1.5 rounded-full text-sm font-medium transition ${scope === s ? 'bg-white text-black' : 'bg-neutral-900 text-neutral-400'}`}>
            {s === 'following' ? t('following') : 'For you'}
          </button>
        ))}
      </div>
      {posts.map(p => p.status === 'published' && <PostCard key={p.id} post={p} me={me} onOpenComments={onOpenComments} onProfile={onProfile} onChange={update} onShare={onShare} toast={toast} activeVideoId={activeVideoId} setActiveVideoId={setActiveVideoId} />)}
      {loading && <div className="py-8 flex justify-center"><Spinner /></div>}
      {!loading && posts.length === 0 && <p className="text-center text-neutral-500 text-sm py-16">{t('emptyFeed')}</p>}
      <div ref={sentinel} />
    </div>
  );
}
