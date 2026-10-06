import React, { useEffect, useRef, useState } from 'react';
import { Send, Paperclip, Mic, Square, ArrowLeft, Phone, Video, Users, Plus, X, Check, CheckCheck, Pencil, Trash2, Flag, Sticker, Shield, UserMinus, Ban, MicOff } from 'lucide-react';
import { TypingDots } from '../components/anim';
import { api } from '../api';
import { Avatar, Btn, Input, Modal, Spinner, timeAgo } from '../ui';
import { t } from '../i18n';
import type { User } from '../types';

export function Messages({ me, socket, onProfile, toast, onCall, deepParam }: { me: User; socket: any; onProfile: (u: string) => void; toast: (s: string) => void; onCall?: (u: string, kind: 'audio'|'video') => void; deepParam?: string }) {
  const [convs, setConvs] = useState<any[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const activeRef = useRef<string | null>(null);
  activeRef.current = active;
  const [showNew, setShowNew] = useState(false);
  const [loadingConvs, setLoadingConvs] = useState(true);
  const loadConvs = () => {
    setLoadingConvs(true);
    api.get('/conversations')
      .then(d => setConvs(d.conversations || []))
      .catch(() => {})
      .finally(() => setLoadingConvs(false));
  };
  useEffect(() => { loadConvs(); }, []);
  // if the list is empty, retry once shortly after — covers a boot-time 401/refresh race
  useEffect(() => {
    if (!loadingConvs && convs.length === 0) {
      const t = setTimeout(loadConvs, 1500);
      return () => clearTimeout(t);
    }
  }, [loadingConvs, convs.length]);
  // live refresh when a message arrives and the list is empty (first conversation case)
  useEffect(() => {
    const h = () => { if (!convs.length) loadConvs(); };
    socket?.on('message:new', h);
    return () => socket?.off('message:new', h);
  }, [socket, convs.length]);
  useEffect(() => {
    // deep link from a notification tap: #/messages/<convId>?draft=...
    if (deepParam) {
      const [convId, qs] = deepParam.split('?');
      if (convId) setActive(convId);
      if (qs?.includes('draft=')) {
        const draft = decodeURIComponent(qs.split('draft=')[1]);
        if (draft) (window as any).__pixoraDraft = draft;
      }
    }
  }, [deepParam]);
  useEffect(() => {
    const h = (m: any) => setConvs(cs => {
      const idx = cs.findIndex(c => c.id === m.conversationId);
      if (idx === -1) { api.get('/conversations').then(d => setConvs(d.conversations)); return cs; }
      const c = { ...cs[idx], last_message: { id: m.id, body: m.body, kind: m.kind, createdAt: m.createdAt, senderId: m.senderId } };
      // live unread badge: bump only for chats that aren't open right now
      if (m.senderId !== me.id && activeRef.current !== m.conversationId) c.unread = (c.unread || 0) + 1;
      const rest = cs.filter((_, i) => i !== idx);
      return [c, ...rest];
    });
    socket?.on('message:new', h);
    return () => socket?.off('message:new', h);
  }, [socket, me.id]);
  // came back online / socket reconnect: pull anything missed while disconnected
  useEffect(() => {
    if (!socket) return;
    const rc = () => loadConvs();
    socket.on('connect', rc);
    socket.on('conversation:new', rc);
    socket.on('conversation:updated', rc);
    socket.on('conversation:join_request', rc);
    return () => { socket.off('connect', rc); socket.off('conversation:new', rc); socket.off('conversation:updated', rc); socket.off('conversation:join_request', rc); };
  }, [socket]);
  const other = (c: any) => c.members?.find((m: any) => m.id !== me.id);
  if (active) return <ChatView convId={active} me={me} socket={socket} onBack={() => setActive(null)} onProfile={onProfile} toast={toast} onCall={onCall} />;
  return (
    <div className="pb-24">
      <div className="flex items-center justify-between p-4">
        <h1 className="text-white font-bold text-xl">{me.username}</h1>
        <Btn onClick={() => setShowNew(true)} className="!px-3 !py-1.5"><Plus size={16} /></Btn>
      </div>
      <div className="divide-y divide-neutral-900">
        {convs.map(c => {
          const o = other(c);
          return (
            <button key={c.id} className="flex items-center gap-3 w-full px-4 py-3 hover:bg-neutral-900/60 text-left" onClick={() => setActive(c.id)}>
              {c.is_group
                ? (c.avatarUrl ? <Avatar src={c.avatarUrl} size={48} /> : <div className="w-12 h-12 rounded-full bg-neutral-800 flex items-center justify-center"><Users size={20} className="text-neutral-400" /></div>)
                : <Avatar src={o?.avatarUrl} size={48} />}
              <div className="flex-1 min-w-0">
                <div className="text-white text-sm font-semibold truncate">{c.is_group ? c.title || 'Group' : o?.username}</div>
                <div className={`text-sm truncate ${c.unread > 0 ? 'text-white font-medium' : 'text-neutral-500'}`}>
                  {c.last_message ? (c.last_message.kind !== 'text' ? (c.last_message.kind === 'sticker' ? 'Sticker' : c.last_message.kind === 'voice' ? 'Voice note' : `[${c.last_message.kind}]`) : c.last_message.body) : 'Say hi'}
                </div>
              </div>
              <div className="text-right">
                <div className="text-[11px] text-neutral-600">{c.last_message ? timeAgo(c.last_message.createdAt) : ''}</div>
                {c.unread > 0 && <span className="inline-block bg-violet-600 text-white text-[10px] rounded-full px-1.5 mt-1">{c.unread}</span>}
              </div>
            </button>
          );
        })}
        {!convs.length && !loadingConvs && <p className="text-center text-neutral-500 text-sm py-16">No conversations yet</p>}
        {loadingConvs && <div className="py-16 flex justify-center"><Spinner /></div>}
      </div>
      <NewChat open={showNew} onClose={() => setShowNew(false)} onCreated={(id: string) => { setShowNew(false); setActive(id); }} />
    </div>
  );
}

function NewChat({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [users, setUsers] = useState<any[]>([]);
  const [sel, setSel] = useState<any[]>([]);
  const [title, setTitle] = useState('');
  useEffect(() => { if (q.length > 1) api.get(`/search?q=${encodeURIComponent(q)}`).then(d => setUsers(d.users)); else setUsers([]); }, [q]);
  return (
    <Modal open={open} onClose={onClose} title="New message">
      <Input placeholder="Search users..." value={q} onChange={e => setQ(e.target.value)} className="mb-3" />
      {sel.length > 0 && <div className="flex gap-1 flex-wrap mb-2">{sel.map(u => <span key={u.id} className="bg-violet-600 text-white text-xs rounded-full px-2 py-1">@{u.username}<button onClick={() => setSel(sel.filter(s => s.id !== u.id))}><X size={10} className="inline ml-1" /></button></span>)}</div>}
      {sel.length > 1 && <Input placeholder="Group name" value={title} onChange={e => setTitle(e.target.value)} className="mb-2" />}
      <div className="space-y-2 max-h-60 overflow-y-auto">
        {users.map(u => (
          <button key={u.id} className="flex items-center gap-3 w-full p-2 hover:bg-neutral-800 rounded-lg" onClick={() => setSel(s => s.some(x => x.id === u.id) ? s : [...s, u])}>
            <Avatar src={u.avatarUrl} size={32} />
            <span className="text-white text-sm">{u.username}</span>
          </button>
        ))}
      </div>
      <Btn className="w-full mt-3" disabled={!sel.length} onClick={async () => {
        const d = await api.post('/conversations', { usernames: sel.map(s => s.username), title: sel.length > 1 ? title || 'Group' : undefined });
        onCreated(d.conversationId);
      }}>{t('send')}</Btn>
    </Modal>
  );
}

function ChatView({ convId, me, socket, onBack, onProfile, toast, onCall }: any) {
  const [messages, setMessages] = useState<any[]>([]);
  const [text, setText] = useState('');
  const [typing, setTyping] = useState<string | null>(null);
  const [readAt, setReadAt] = useState<string | null>(null);
  const [conv, setConv] = useState<any>(null);
  const [recording, setRecording] = useState<MediaRecorder | null>(null);
  const [viewer, setViewer] = useState<null | { url: string; kind: 'image' | 'video' }>(null);
  const [actionMsg, setActionMsg] = useState<any>(null);
  const [replyTo, setReplyTo] = useState<any>(null);
  const [fwdOpen, setFwdOpen] = useState<null | any>(null);
  const [attachKey, setAttachKey] = useState(0);
  const [showStickers, setShowStickers] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const typingTimer = useRef<any>(null);

  const load = async () => {
    const [d, c] = await Promise.all([api.get(`/conversations/${convId}/messages`), api.get('/conversations').then(all => all.conversations.find((x: any) => x.id === convId))]);
    setMessages(d.messages);
    setConv(c);
    // seed read receipts: how far the others have read before any live event arrives
    const lastRead = (c?.members || []).filter((m: any) => m.id !== me.id).map((m: any) => m.lastReadAt).filter(Boolean).sort().pop();
    if (lastRead) setReadAt(lastRead);
    await api.post(`/conversations/${convId}/read`);
  };
  const [showInfo, setShowInfo] = useState(false);
  useEffect(() => { load(); socket?.emit('conversation:join', convId); }, [convId]);
  useEffect(() => {
    const h = (m: any) => { if (m.conversationId === convId) { setMessages(ms => ms.some(x => x.id === m.id) ? ms : [...ms, m]); api.post(`/conversations/${convId}/read`); } };
    const tr = ({ userId, username, conversationId }: any) => { if (conversationId === convId && userId !== me.id) { setTyping(username); setTimeout(() => setTyping(null), 2500); } };
    const ts = ({ userId, conversationId }: any) => { if (conversationId === convId) setTyping(null); };
    // only OTHER people's reads move my checkmarks — my own read used to flip them wrongly
    const rd = ({ conversationId, userId, at }: any) => { if (conversationId === convId && userId !== me.id) setReadAt(r => (!r || new Date(at) > new Date(r)) ? at : r); };
    const ed = ({ id, body, conversationId }: any) => { if (conversationId === convId) setMessages(ms => ms.map(m => m.id === id ? { ...m, body, edited: true } : m)); };
    const dl = ({ id, conversationId }: any) => { if (conversationId === convId) setMessages(ms => ms.map(m => m.id === id ? { ...m, deleted: true, body: null, mediaUrl: null } : m)); };
    // after a reconnect (network blip, server spin-up) pull anything missed instead of waiting for a refresh
    const rc = () => {
      socket?.emit('conversation:join', convId);
      api.get(`/conversations/${convId}/messages`).then(d => setMessages(ms => {
        const seen = new Map(ms.map(x => [x.id, x]));
        for (const m of d.messages) seen.set(m.id, m);
        return [...seen.values()].sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      })).catch(() => {});
    };
    socket?.on('message:new', h); socket?.on('typing', tr); socket?.on('typing:stop', ts); socket?.on('message:read', rd);
    socket?.on('message:edited', ed); socket?.on('message:deleted', dl); socket?.on('connect', rc);
    return () => { socket?.off('message:new', h); socket?.off('typing', tr); socket?.off('typing:stop', ts); socket?.off('message:read', rd); socket?.off('message:edited', ed); socket?.off('message:deleted', dl); socket?.off('connect', rc); socket?.emit('conversation:leave', convId); };
  }, [convId, socket, me.id]);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages.length, typing]);
  const other = conv?.members?.find((m: any) => m.id !== me.id);

  const send = async () => {
    if (!text.trim()) return;
    const body = text; setText(''); setMentionQuery(null); setShowStickers(false);
    socket?.emit('typing:stop', { conversationId: convId });
    const d = await api.post(`/conversations/${convId}/messages`, { body, replyToId: replyTo?.id });
    setMessages(ms => ms.some(x => x.id === d.message.id) ? ms : [...ms, d.message]);
    setReplyTo(null);
  };
  const sendSticker = async (ref: string) => {
    setShowStickers(false);
    socket?.emit('typing:stop', { conversationId: convId });
    try {
      const isMedia = ref.startsWith('/media/');
      const d = await api.post(`/conversations/${convId}/messages`, isMedia ? { mediaUrl: ref, kind: 'sticker' } : { body: ref, kind: 'sticker' });
      setMessages(ms => ms.some(x => x.id === d.message.id) ? ms : [...ms, d.message]);
    } catch (e: any) { toast(e.code === 'sticker_too_long' ? 'video stickers are 10 seconds max' : (e.message || 'send failed — try again')); }
  };
  const onType = () => {
    if (!typingTimer.current || Date.now() - typingTimer.current > 1500) socket?.emit('typing', { conversationId: convId });
    typingTimer.current = Date.now();
  };
  const onTextInput = (e: any) => {
    setText(e.target.value); onType();
    // WhatsApp-style @mention autocomplete. Android keyboards often auto-insert a
    // space right after @, so also treat "@ " (empty query) as an open picker.
    const caret = e.target.selectionStart ?? e.target.value.length;
    const before = e.target.value.slice(0, caret);
    const m = /@([a-zA-Z0-9_]*)$/.exec(before);
    setMentionQuery(m ? m[1] : (/@\s$/.test(before) ? '' : null));
  };
  const mentionCandidates = mentionQuery === null ? [] : [
    // WhatsApp shows the full member list the moment you type @ — @all/everyone pinned on top in groups
    ...(conv?.is_group ? [{ id: 'everyone', username: 'all', displayName: 'everyone', __everyone: true }] : []),
    ...(conv?.members || []).filter((u: any) => u.id !== me.id && (!mentionQuery || u.username?.toLowerCase().includes(String(mentionQuery).toLowerCase()))).slice(0, 8),
  ];
  const pickMention = (u: any) => {
    setText(t => t.replace(/@[a-zA-Z0-9_]*\s?$/, u.__everyone ? '@all ' : `@${u.username} `));
    setMentionQuery(null);
  };
  const [uploading, setUploading] = useState<string | null>(null); // label of what's uploading
  const sendMedia = async (file: File) => {
    // some Android pickers give an empty MIME — fall back to the extension
    const isVideo = file.type.startsWith('video') || /\.(mp4|mov|webm|mkv|avi|3gp|m4v)$/i.test(file.name);
    const kind = isVideo ? 'video' : 'image';
    setUploading(kind === 'video' ? 'Sending video…' : 'Sending photo…');
    setAttachKey(k => k + 1);
    try {
      const fd = new FormData(); fd.append('file', file);
      const up = await api.upload('/media/upload', fd);
      if (!up.ids?.length) throw new Error('upload_failed');
      const d = await api.post(`/conversations/${convId}/messages`, { mediaUrl: up.ids[0], kind });
      setMessages(ms => ms.some(x => x.id === d.message.id) ? ms : [...ms, d.message]);
    } catch (e: any) {
      toast(e.code === 'rate_limited' ? 'too many files — wait a minute' : e.code === 'file_too_large' ? 'file too large' : (e.message || 'send failed — try again'));
    } finally { setUploading(null); }
  };
  const sendVoice = async (blob: Blob, durationMs: number) => {
    setUploading('Sending voice note…');
    try {
      const fd = new FormData(); fd.append('file', new File([blob], 'voice.webm', { type: 'audio/webm' }));
      const up = await api.upload('/media/upload', fd);
      if (!up.ids?.length) throw new Error('upload_failed');
      const d = await api.post(`/conversations/${convId}/messages`, { mediaUrl: up.ids[0], kind: 'voice', durationMs });
      setMessages(ms => ms.some(x => x.id === d.message.id) ? ms : [...ms, d.message]);
    } catch (e: any) {
      toast(e.code === 'rate_limited' ? 'too many files — wait a minute' : (e.message || 'send failed — try again'));
    } finally { setUploading(null); }
  };
  const startRec = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream); const chunks: Blob[] = [];
      rec.ondataavailable = e => chunks.push(e.data);
      rec.onstop = () => { sendVoice(new Blob(chunks, { type: 'audio/webm' }), Date.now() - startedAt); stream.getTracks().forEach(tk => tk.stop()); };
      const startedAt = Date.now();
      rec.start(); setRecording(rec);
    } catch { toast('microphone_unavailable'); }
  };
  return (
    <div className="flex flex-col h-[calc(100vh-60px)] pb-[60px] sm:pb-0">
      <div className="flex items-center gap-3 p-3 border-b border-neutral-900 cursor-pointer" onClick={() => conv?.is_group && setShowInfo(true)}>
        <button onClick={(e) => { e.stopPropagation(); onBack(); }} className="text-white sm:hidden"><ArrowLeft size={20} /></button>
        {conv?.is_group
          ? (conv?.avatarUrl ? <Avatar src={conv.avatarUrl} size={36} /> : <div className="w-9 h-9 rounded-full bg-neutral-800 flex items-center justify-center"><Users size={16} className="text-neutral-400" /></div>)
          : <Avatar src={other?.avatarUrl} size={36} />}
        <div className="flex-1 min-w-0">
          <div className="text-white text-sm font-semibold truncate">{conv?.is_group ? conv?.title || 'Group' : other?.username}</div>
          {typing ? <div className="text-violet-400 text-xs">{typing} {t('typing')}</div> : <div className="text-neutral-500 text-xs truncate">{conv?.is_group ? `${conv?.members?.length} members · tap for group info` : (conv?.description || '')}</div>}
        </div>
        {!conv?.is_group && other && <div className="ml-auto flex gap-1">
          <button className="text-neutral-400 hover:text-white p-2" title="Voice call" onClick={() => onCall?.(other.username, 'audio')}><Phone size={18} /></button>
          <button className="text-neutral-400 hover:text-white p-2" title="Video call" onClick={() => onCall?.(other.username, 'video')}><Video size={18} /></button>
        </div>}
      </div>
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 space-y-2">
        {messages.map(m => {
          const mineMsg = m.senderId === me.id;
          const isSticker = m.kind === 'sticker';
          return (
            <div key={m.id} className={`group flex ${mineMsg ? 'justify-end msg-in-right' : 'justify-start msg-in-left'} relative`}>
              <div
                onClick={() => setActionMsg(m)}
                className={`max-w-[75%] rounded-2xl px-3 py-2 cursor-pointer select-none ${isSticker ? '' : mineMsg ? 'bg-violet-600 text-white rounded-br-sm' : 'bg-neutral-800 text-white rounded-bl-sm'}`}>
                {conv?.is_group && !mineMsg && <div className="text-[11px] text-violet-200 mb-0.5">@{m.sender?.username}</div>}
                {m.forwarded && <div className="text-[10px] opacity-70 mb-0.5">↪ Forwarded</div>}
                {m.pinned && <div className="text-[10px] opacity-70 mb-0.5">📌 Pinned</div>}
                {m.deleted ? <span className="italic opacity-70 text-sm">deleted</span>
                  : isSticker ? <StickerBody ref={m.body || m.mediaUrl} mediaMime={m.mediaMime} />
                  : m.kind === 'voice' ? <VoiceNote src={m.mediaUrl!} mineMsg={mineMsg} />
                    : m.kind !== 'text' ? (m.kind === 'video'
                        ? <video src={m.mediaUrl} controls onClick={() => setViewer({ url: m.mediaUrl!, kind: 'video' })} className="rounded-xl max-h-64 max-w-full cursor-pointer" />
                        : <img src={m.mediaUrl} onClick={() => setViewer({ url: m.mediaUrl!, kind: 'image' })} className="rounded-xl max-h-64 max-w-full cursor-pointer" alt="attachment" />)
                      : <span className="text-sm whitespace-pre-wrap break-words break-all"><RenderBody body={m.body} members={conv?.members} mineMsg={mineMsg} onMention={(u: string) => onProfile?.(u)} />{m.edited && <span className="text-[10px] opacity-60 ml-1">(edited)</span>}</span>}
                <div className={`text-[10px] mt-1 flex items-center gap-1 justify-end ${mineMsg ? 'text-violet-200' : 'text-neutral-500'}`}>
                  {m.starred && <span>★</span>}
                  {timeAgo(m.createdAt)}
                  {mineMsg && (readAt && new Date(readAt) >= new Date(m.createdAt) ? <CheckCheck size={12} /> : <Check size={12} />)}
                </div>
                {(m.reactions || []).length > 0 && (
                  <div className="flex gap-0.5 mt-1 -mb-1 flex-wrap">
                    {m.reactions.map((r: any) => (
                      <span key={r.emoji} className="text-[11px] bg-black/30 rounded-full px-1.5" title={(r.users || []).map((u: any) => '@' + u.username).join(', ')}>{r.emoji}{(r.users || []).length > 1 ? (r.users || []).length : ''}</span>
                    ))}
                  </div>
                )}
              </div>
              {!m.deleted && (
                <div className={`absolute -top-9 ${mineMsg ? 'right-0' : 'left-0'} hidden group-hover:flex items-center gap-0.5 bg-neutral-900 border border-neutral-800 rounded-lg px-1 py-0.5 shadow-lg`}>
                  {mineMsg ? <>
                    <button title="Edit" className="p-1 text-neutral-400 hover:text-white" onClick={() => {
                      const nv = prompt('Edit message', m.body);
                      if (nv && nv.trim()) { api.patch(`/messages/${m.id}`, { body: nv }); setMessages(ms => ms.map(x => x.id === m.id ? { ...x, body: nv, edited: true } : x)); }
                    }}><Pencil size={12} /></button>
                    <button title="Delete" className="p-1 text-neutral-400 hover:text-red-400" onClick={async () => { await api.del(`/messages/${m.id}`); setMessages(ms => ms.map(x => x.id === m.id ? { ...x, deleted: true, body: null, mediaUrl: null } : x)); }}><Trash2 size={12} /></button>
                  </> : <>
                    <button title="Report" className="p-1 text-neutral-400 hover:text-red-400" onClick={async () => {
                      const reason = prompt('Why are you reporting this message?', 'inappropriate');
                      if (reason) { await api.post(`/messages/${m.id}/report`, { reason }); toast('reported to admins'); }
                    }}><Flag size={12} /></button>
                  </>}
                </div>
              )}
            </div>
          );
        })}
        {typing && <TypingDots name={typing} />}
        <div ref={bottom} />
      </div>
      {replyTo && (
        <div className="px-3 pt-2">
          <div className="bg-neutral-900 border-l-2 border-violet-500 rounded-lg px-3 py-2 flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <div className="text-violet-300 text-xs font-medium">@{replyTo.sender?.username}</div>
              <div className="text-neutral-300 text-xs truncate">{replyTo.body || '[' + replyTo.kind + ']'}</div>
            </div>
            <button onClick={() => setReplyTo(null)} className="text-neutral-500"><X size={14} /></button>
          </div>
        </div>
      )}
      <div className="px-3 border-t border-neutral-900 relative">
        {mentionCandidates.length > 0 && (
          <div className="absolute bottom-full left-3 right-3 mb-1 bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden shadow-xl z-10">
            {mentionCandidates.map((u: any) => (
              <button key={u.id} className="flex items-center gap-2 w-full px-3 py-2 hover:bg-neutral-800 text-left" onClick={() => pickMention(u)}>
                <Avatar src={u.avatarUrl} size={24} />
                <span className="text-white text-sm">@{u.username}</span>
                {u.displayName && <span className="text-neutral-500 text-xs">{u.displayName}</span>}
              </button>
            ))}
          </div>
        )}
        {showStickers && <StickerPanel onPick={sendSticker} onClose={() => setShowStickers(false)} toast={toast} onFavorite={async (ref: string) => { await api.post('/stickers/mine', { mediaUrl: ref }); toast('added to favorites'); }} />}
        {uploading && <span className="absolute -top-7 left-4 text-xs text-violet-300 bg-neutral-900 rounded-full px-3 py-1">{uploading}</span>}
        <div className="flex items-center gap-2 py-3">
          <label className="text-neutral-400 cursor-pointer"><Paperclip size={20} /><input type="file" hidden accept="image/*,video/*,video/mp4,video/webm,video/quicktime,.mp4,.mov,.webm,.mkv,.avi,.3gp" key={attachKey} onChange={e => { if (e.target.files![0]) sendMedia(e.target.files![0]); e.target.value = ''; }} /></label>
          {recording
            ? <button onClick={() => { recording.stop(); setRecording(null); }} className="text-red-400 animate-pulse"><Square size={20} /></button>
            : <button onClick={startRec} className="text-neutral-400 hover:text-white"><Mic size={20} /></button>}
          <button onClick={() => { setShowStickers(s => !s); setMentionQuery(null); }} className={showStickers ? 'text-violet-400' : 'text-neutral-400 hover:text-white'} title="Stickers"><Sticker size={20} /></button>
          <Input placeholder={t('typeMessage')} value={text} onChange={onTextInput} onKeyDown={e => e.key === 'Enter' && send()} className="flex-1" />
          <Btn onClick={send} disabled={!text.trim()} className="!px-3"><Send size={16} /></Btn>
        </div>
      </div>
      {actionMsg && (
        <MessageActionSheet
          m={actionMsg}
          mineMsg={actionMsg.senderId === me.id}
          conv={conv}
          onClose={() => setActionMsg(null)}
          onReact={async (emoji: string) => {
            const d = await api.post(`/messages/${actionMsg.id}/react`, { emoji });
            setMessages(ms => ms.map(x => x.id === actionMsg.id ? { ...x, reactions: d.reactions.map((r: any) => ({ emoji: r.emoji, users: r.users })) } : x));
            setActionMsg(null);
          }}
          onReply={() => { setReplyTo(actionMsg); setActionMsg(null); }}
          onFavorite={async () => { const ref = actionMsg.body || actionMsg.mediaUrl; if (ref) { await api.post('/stickers/mine', { mediaUrl: ref }); toast('added to favorites'); } setActionMsg(null); }}
          onForward={() => { setFwdOpen(actionMsg); setActionMsg(null); }}
          onStar={async () => { const d = await api.post(`/messages/${actionMsg.id}/star`); setMessages(ms => ms.map(x => x.id === actionMsg.id ? { ...x, starred: d.starred } : x)); setActionMsg(null); }}
          onPin={async () => { const d = await api.post(`/messages/${actionMsg.id}/pin`); setMessages(ms => ms.map(x => x.id === actionMsg.id ? { ...x, pinned: d.pinned } : x)); setActionMsg(null); }}
          onEdit={() => {
            const nv = prompt('Edit message', actionMsg.body);
            if (nv && nv.trim()) { api.patch(`/messages/${actionMsg.id}`, { body: nv }); setMessages(ms => ms.map(x => x.id === actionMsg.id ? { ...x, body: nv, edited: true } : x)); }
            setActionMsg(null);
          }}
          onDeleteMe={async () => { await api.post(`/messages/${actionMsg.id}/delete`, { forEveryone: false }); setMessages(ms => ms.filter(x => x.id !== actionMsg.id)); setActionMsg(null); }}
          onDeleteAll={async () => { await api.post(`/messages/${actionMsg.id}/delete`, { forEveryone: true }); setMessages(ms => ms.map(x => x.id === actionMsg.id ? { ...x, deleted: true, body: null, mediaUrl: null } : x)); setActionMsg(null); }}
          onReport={async () => {
            const reason = prompt('Why are you reporting this message?', 'inappropriate');
            if (reason) { await api.post(`/messages/${actionMsg.id}/report`, { reason }); toast('reported to admins'); }
            setActionMsg(null);
          }}
        />
      )}
      {fwdOpen && <ForwardPicker msgId={fwdOpen.id} excludeConvId={convId} onClose={() => setFwdOpen(null)} toast={toast} />}
      {showInfo && conv?.is_group && <GroupInfo convId={convId} me={me} socket={socket} toast={toast} onClose={() => setShowInfo(false)} onRefresh={load} onProfile={onProfile} onLeft={() => { setShowInfo(false); onBack(); }} />}
      {viewer && (
        <div className="fixed inset-0 z-[90] bg-black/95 flex flex-col items-center justify-center" onClick={() => setViewer(null)}>
          <div className="absolute top-4 right-4 flex gap-2" onClick={e => e.stopPropagation()}>
            <a href={viewer.url} download target="_blank" rel="noopener noreferrer" className="bg-white/10 text-white rounded-full p-2.5" title="Save">⬇</a>
            <button onClick={() => setViewer(null)} className="bg-white/10 text-white rounded-full p-2.5"><X size={18} /></button>
          </div>
          {viewer.kind === 'video'
            ? <video src={viewer.url} controls autoPlay className="max-w-full max-h-[85vh]" />
            : <img src={viewer.url} className="max-w-full max-h-[85vh] object-contain" alt="attachment" />}
        </div>
      )}
    </div>
  );
}

function VoiceNote({ src, mineMsg }: { src: string; mineMsg: boolean; durationMs?: number | null }) {
  return (
    <div className="flex items-center gap-2 py-0.5" style={{ minWidth: 210 }}>
      <audio src={src} controls preload="metadata" className="h-9 max-w-full" style={{
        width: 200,
        filter: mineMsg ? 'invert(0.9) hue-rotate(180deg) saturate(0.7)' : 'invert(0.92) hue-rotate(180deg)',
        borderRadius: 8,
      }} />
    </div>
  );
}

const QUICK_EMOJI = ['❤️', '😂', '😮', '😢', '🔥', '👍'];

// big emoji stickers — always available, zero assets
export const STICKER_EMOJI = ['😀','😂','🥹','😍','😎','🤩','🥳','😭','😡','🤯','🥶','😱','😴','🤡','👻','💀','🤖','👽','🎃','🔥','✨','🎉','💥','❤️','🧡','💛','💚','💙','💜','🖤','👍','👎','👏','🙏','💪','🫶','🤢','🐶','🐱','🐼','🦁','🐷','🐸','🐵','🍕','🍔','🍟','🌮','🍩','🎂','☕','🍺','⚽','🏀','🎮','🚀','🌟','💯','🤙','🤞'];
// generated die-cut sticker packs served from /public/stickers
export const STICKER_PACK = ['smiley','love','cool','cry','angry','party','thumbsup','fire','skull','heart','rocket','poop'];

function StickerBody({ ref: sref, mediaMime }: { ref: string; mediaMime?: string | null }) {
  if (!sref) return null;
  if (sref.startsWith('/media/')) {
    if (mediaMime?.startsWith('video/')) return <video src={sref} autoPlay loop muted playsInline className="w-32 h-32 object-cover rounded-xl max-w-full" />;
    return <img src={sref} className="w-28 h-28 object-contain max-w-full" alt="sticker" />;
  }
  if (sref.startsWith('/stickers/')) return <img src={sref} className="w-28 h-28 object-contain max-w-full" alt="sticker" />;
  // emoji sticker — only for genuinely short refs; anything else renders as safe wrapped text
  if (sref.length <= 8) return <span className="text-6xl leading-none block">{sref}</span>;
  return <span className="text-sm break-all whitespace-pre-wrap">{sref}</span>;
}

function RenderBody({ body, members, mineMsg, onMention }: { body: string; members?: any[]; mineMsg: boolean; onMention?: (username: string) => void }) {
  if (!body) return null;
  const names = new Set((members || []).map((u: any) => String(u.username || '').toLowerCase()).filter(Boolean));
  const parts = body.split(/(@[a-zA-Z0-9._]{3,30})/g);
  const cls = `font-semibold rounded px-0.5 ${mineMsg ? 'bg-violet-500/50 text-white' : 'bg-violet-600/50 text-violet-100'}`;
  return <>{parts.map((p, i) => (p.toLowerCase() === '@all' || p.toLowerCase() === '@everyone')
    ? <span key={i} className={cls}>{p}</span>
    : p.startsWith('@') && names.has(p.slice(1).toLowerCase())
    ? <span key={i} className={cls} onClick={(e) => { e.stopPropagation(); onMention?.(p.slice(1)); }}>{p}</span>
    : <span key={i}>{p}</span>)}</>;
}

function StickerPanel({ onPick, onClose, toast, onFavorite }: { onPick: (ref: string) => void; onClose: () => void; toast: (s: string) => void; onFavorite: (ref: string) => void }) {
  const [tab, setTab] = useState<'mine' | 'pack' | 'emoji'>('pack');
  const [mine, setMine] = useState<{ url: string; mime: string | null }[]>([]);
  const [creating, setCreating] = useState(false);
  useEffect(() => { api.get('/stickers/mine').then(d => setMine((d.stickers || []).map((s: any) => typeof s === 'string' ? { url: s, mime: null } : s))).catch(() => {}); }, []);
  return (
    <>
      <div className="absolute bottom-full left-0 right-0 mb-1 bg-neutral-900 border border-neutral-800 rounded-2xl p-3 shadow-xl z-10">
        <div className="flex items-center justify-between mb-2">
          <div className="flex gap-1">
            <button onClick={() => setTab('mine')} className={`text-xs rounded-full px-3 py-1 ${tab === 'mine' ? 'bg-violet-600 text-white' : 'bg-neutral-800 text-neutral-400'}`}>Mine</button>
            <button onClick={() => setTab('pack')} className={`text-xs rounded-full px-3 py-1 ${tab === 'pack' ? 'bg-violet-600 text-white' : 'bg-neutral-800 text-neutral-400'}`}>Stickers</button>
            <button onClick={() => setTab('emoji')} className={`text-xs rounded-full px-3 py-1 ${tab === 'emoji' ? 'bg-violet-600 text-white' : 'bg-neutral-800 text-neutral-400'}`}>Emoji</button>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setCreating(true)} className="bg-violet-600 hover:bg-violet-500 text-white text-xs rounded-full px-3 py-1 font-medium" title="Create a sticker from a photo">+ Create</button>
            <button onClick={onClose} className="text-neutral-500 hover:text-white"><X size={16} /></button>
          </div>
        </div>
        <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 max-h-56 overflow-y-auto">
          {tab === 'mine' && (mine.length
            ? mine.map(s => (
              <button key={s.url} onClick={() => onPick(s.url)}
                onContextMenu={e => e.preventDefault()}
                onPointerDown={e => { const t = e.currentTarget as HTMLElement; const to = setTimeout(async () => { if (confirm('Remove this sticker?')) { const d = await api.post('/stickers/mine/delete', { mediaUrl: s.url }); setMine(m => m.filter(x => x.url !== s.url)); } }, 600); const clear = () => { clearTimeout(to); t.removeEventListener('pointerup', clear); t.removeEventListener('pointerleave', clear); }; t.addEventListener('pointerup', clear); t.addEventListener('pointerleave', clear); }}
                className="hover:bg-neutral-800 rounded-xl p-1 active:scale-95 transition" title="Tap to send · hold to remove">
                {s.mime?.startsWith('video/')
                  ? <video src={s.url} muted loop autoPlay playsInline className="w-full aspect-square object-cover rounded-lg" />
                  : <img src={s.url} className="w-full aspect-square object-contain" alt="sticker" loading="lazy" />}
              </button>
            ))
            : <p className="col-span-full text-center text-neutral-500 text-xs py-8">No personal stickers yet — tap + Create to make one from any photo or video</p>)}
          {tab === 'pack' && STICKER_PACK.map(s => (
            <button key={s} onClick={() => onPick(`/stickers/${s}.webp`)}
              onContextMenu={e => { e.preventDefault(); onFavorite(`/stickers/${s}.webp`); }}
              onPointerDown={e => { const t = e.currentTarget as HTMLElement; const to = setTimeout(() => onFavorite(`/stickers/${s}.webp`), 600); const clear = () => { clearTimeout(to); t.removeEventListener('pointerup', clear); t.removeEventListener('pointerleave', clear); }; t.addEventListener('pointerup', clear); t.addEventListener('pointerleave', clear); }}
              className="hover:bg-neutral-800 rounded-xl p-1 active:scale-95 transition" title="Tap to send · hold to favorite">
              <img src={`/stickers/${s}.webp`} className="w-full aspect-square object-contain" alt={s} loading="lazy" />
            </button>
          ))}
          {tab === 'emoji' && STICKER_EMOJI.map(e => (
            <button key={e} onClick={() => onPick(e)} className="text-4xl hover:bg-neutral-800 rounded-xl p-1 active:scale-95 transition">{e}</button>
          ))}
        </div>
      </div>
      {creating && <StickerCreator onClose={() => setCreating(false)} onCreated={(url: string) => { setMine(m => [{ url, mime: null }, ...m].slice(0, 30)); setCreating(false); setTab('mine'); }} toast={toast} />}
    </>
  );
}

// WhatsApp-style sticker maker: pick a photo OR a video (max 10s — longer is trimmed),
// pan/zoom inside a square (images), save as a personal sticker
declare global { interface Window { __stickerFile?: File } }
function StickerCreator({ onClose, onCreated, toast }: { onClose: () => void; onCreated: (url: string) => void; toast: (s: string) => void }) {
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [isVideo, setIsVideo] = useState(false);
  const [saving, setSaving] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const viewRef = useRef({ scale: 1, x: 0, y: 0, drag: false, px: 0, py: 0 });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [, force] = useState(0);
  // redraw once the canvas is actually mounted (and whenever the image changes)
  useEffect(() => { draw(); }, [imgSrc]);
  const pick = (f: File) => {
    if (f.type.startsWith('video/') || /\.(mp4|mov|webm|mkv|avi|3gp|m4v)$/i.test(f.name)) {
      setIsVideo(true);
      setImgSrc(null);
      setVideoSrc(URL.createObjectURL(f));
      window.__stickerFile = f;
      return;
    }
    setIsVideo(false);
    setVideoSrc(null);
    const url = URL.createObjectURL(f);
    const im = new Image();
    im.onload = () => { imgRef.current = im; viewRef.current = { scale: 1, x: 0, y: 0, drag: false, px: 0, py: 0 }; setImgSrc(url); force(n => n + 1); draw(); };
    im.src = url;
    window.__stickerFile = f;
  };
  const draw = () => {
    const cv = canvasRef.current, im = imgRef.current;
    if (!cv || !im) return;
    const ctx = cv.getContext('2d')!;
    const v = viewRef.current;
    ctx.clearRect(0, 0, cv.width, cv.height);
    // base cover-fit into the square, then apply user zoom + pan
    const base = Math.max(cv.width / im.width, cv.height / im.height);
    const s = base * v.scale;
    const w = im.width * s, h = im.height * s;
    const cx = cv.width / 2 + v.x, cy = cv.height / 2 + v.y;
    ctx.drawImage(im, cx - w / 2, cy - h / 2, w, h);
  };
  const save = async () => {
    setSaving(true);
    try {
      let blob: Blob;
      if (isVideo) {
        blob = window.__stickerFile!;
      } else {
        draw();
        const b: Blob | null = await new Promise(r => canvasRef.current!.toBlob(r, 'image/webp', 0.85));
        if (!b) throw new Error('render_failed');
        blob = b;
      }
      const fd = new FormData(); fd.append('file', new File([blob], isVideo ? 'sticker.mp4' : 'sticker.webp', { type: isVideo ? 'video/mp4' : 'image/webp' }));
      const up = await api.upload('/stickers/create', fd);
      if (!up.url) throw new Error(up.error || 'upload_failed');
      onCreated(up.url); toast('sticker saved');
    } catch (e: any) { toast(e.code === 'sticker_too_long' ? 'video stickers are 10 seconds max' : (e.message || 'could not save sticker')); }
    finally { setSaving(false); }
  };
  return (
    <div className="fixed inset-0 z-[96] bg-black/85 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-neutral-900 border border-neutral-800 rounded-3xl w-full max-w-sm p-4" onClick={e => e.stopPropagation()}>
        <h3 className="text-white font-semibold mb-3">Create sticker</h3>
        {!imgSrc && !videoSrc ? (
          <>
            <p className="text-neutral-400 text-xs mb-3">Pick a photo or a video (videos are trimmed to 10 seconds max). Photos can be positioned and zoomed into a square.</p>
            <label className="block text-center bg-violet-600 hover:bg-violet-500 text-white rounded-xl py-2.5 cursor-pointer font-medium">
              Choose photo or video<input type="file" hidden accept="image/*,video/*,.mp4,.mov,.webm,.mkv,.avi,.3gp" onChange={e => { if (e.target.files![0]) pick(e.target.files![0]); e.target.value = ''; }} />
            </label>
          </>
        ) : isVideo ? (
          <>
            <video src={videoSrc!} controls muted loop autoPlay playsInline className="w-full aspect-square rounded-xl bg-neutral-800 object-cover" />
            <p className="text-neutral-500 text-xs mt-2 text-center">Videos are cropped square and trimmed to 10 seconds max.</p>
            <div className="flex gap-2 mt-3">
              <Btn className="flex-1" onClick={() => { setVideoSrc(null); setIsVideo(false); }} disabled={saving}>Change</Btn>
              <Btn className="flex-1" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Make sticker'}</Btn>
            </div>
          </>
        ) : (
          <>
            <canvas ref={canvasRef} width={512} height={512}
              className="w-full aspect-square rounded-xl bg-neutral-800 touch-none cursor-move"
              onPointerDown={e => { const v = viewRef.current; v.drag = true; v.px = e.clientX; v.py = e.clientY; (e.target as HTMLElement).setPointerCapture(e.pointerId); }}
              onPointerMove={e => { const v = viewRef.current; if (!v.drag) return; v.x += e.clientX - v.px; v.y += e.clientY - v.py; v.px = e.clientX; v.py = e.clientY; draw(); }}
              onPointerUp={() => { viewRef.current.drag = false; }}
            />
            <input type="range" min={1} max={4} step={0.05} defaultValue={1} className="w-full mt-3 accent-violet-500"
              onInput={e => { viewRef.current.scale = parseFloat((e.target as HTMLInputElement).value); draw(); }} />
            <div className="flex gap-2 mt-3">
              <Btn className="flex-1" onClick={() => { setImgSrc(null); }} disabled={saving}>Change photo</Btn>
              <Btn className="flex-1" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Make sticker'}</Btn>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function MessageActionSheet({ m, mineMsg, conv, onClose, onReact, onReply, onFavorite, onForward, onStar, onPin, onEdit, onDeleteMe, onDeleteAll, onReport }: any) {
  return (
    <div className="fixed inset-0 z-[95] bg-black/70 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="bg-neutral-900 border border-neutral-800 rounded-t-3xl sm:rounded-3xl w-full sm:max-w-sm p-4 animate-[fadein_.18s_ease-out]" onClick={e => e.stopPropagation()}>
        <div className="flex justify-center gap-4 mb-4">
          {QUICK_EMOJI.map(e => (
            <button key={e} onClick={() => onReact(e)} className="text-2xl active:scale-125 transition">{e}</button>
          ))}
        </div>
        <div className="space-y-0.5 text-sm">
          <SheetBtn icon="↩" label="Reply" onClick={onReply} />
          {m.kind === 'sticker' && <SheetBtn icon="⭐" label="Add to favorites" onClick={onFavorite} />}
          <SheetBtn icon="↪" label="Forward" onClick={onForward} />
          <SheetBtn icon="★" label={m.starred ? 'Unstar' : 'Star'} onClick={onStar} />
          <SheetBtn icon="📌" label={m.pinned ? 'Unpin' : 'Pin'} onClick={onPin} />
          {mineMsg && <SheetBtn icon="✎" label="Edit" onClick={onEdit} />}
          {mineMsg && <SheetBtn icon="🗑" label="Delete for everyone" danger onClick={onDeleteAll} />}
          <SheetBtn icon="👁‍🗨" label="Delete for me" danger onClick={onDeleteMe} />
          {!mineMsg && <SheetBtn icon="🚩" label="Report" danger onClick={onReport} />}
        </div>
      </div>
    </div>
  );
}
function SheetBtn({ icon, label, onClick, danger }: any) {
  return (
    <button onClick={onClick} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-neutral-800 text-left ${danger ? 'text-red-400' : 'text-white'}`}>
      <span className="w-5 text-center">{icon}</span>{label}
    </button>
  );
}

// WhatsApp-style group info & settings screen
function GroupInfo({ convId, me, socket, toast, onClose, onRefresh, onProfile, onLeft }: any) {
  const [info, setInfo] = useState<any>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [saving, setSaving] = useState(false);
  const load = () => api.get(`/conversations/${convId}/info`).then(d => { setInfo(d); setTitle(d.conversation.title || ''); setDesc(d.conversation.description || ''); }).catch(() => {});
  useEffect(() => { load(); }, [convId]);
  useEffect(() => {
    const h = () => load();
    socket?.on('conversation:updated', h);
    return () => socket?.off('conversation:updated', h);
  }, [convId, socket]);
  if (!info) return <div className="fixed inset-0 z-[92] bg-neutral-950 flex items-center justify-center" onClick={onClose}><Spinner /></div>;
  const c = info.conversation;
  const myRole = info.myRole;
  const isAdmin = info.isAdmin;
  const isOwner = myRole === 'owner';
  const save = async () => {
    setSaving(true);
    try { await api.post(`/conversations/${convId}/settings`, { title, description: desc }); await load(); setEditing(false); onRefresh?.(); toast('group updated'); }
    catch (e: any) { toast(e.message || 'failed'); }
    finally { setSaving(false); }
  };
  const pickAvatar = async (f: File) => {
    try {
      const fd = new FormData(); fd.append('file', f);
      const up = await api.upload('/media/upload', fd);
      if (!up.ids?.length) throw new Error('upload_failed');
      await api.post(`/conversations/${convId}/settings`, { avatarUrl: up.ids[0] });
      await load(); onRefresh?.(); toast('photo updated');
    } catch (e: any) { toast(e.message || 'failed'); }
  };
  const memberAction = async (u: any, action: string) => {
    try {
      if (action === 'role') await api.post(`/conversations/${convId}/members/${u.id}/role`, { role: u.role === 'member' ? 'admin' : 'member' });
      if (action === 'kick') await api.post(`/conversations/${convId}/members/${u.id}/kick`);
      if (action === 'ban') await api.post(`/conversations/${convId}/members/${u.id}/ban`);
      if (action === 'mute') await api.post(`/conversations/${convId}/members/${u.id}/mute`);
      await load(); onRefresh?.();
    } catch (e: any) { toast(e.message || 'failed'); }
  };
  const toggle = async (key: string, val: boolean) => {
    setInfo((s: any) => ({ ...s, conversation: { ...s.conversation, settings: { ...s.conversation.settings, [key]: val } } }));
    try { await api.post(`/conversations/${convId}/settings`, { [key]: val }); } catch { toast('failed'); load(); }
  };
  const leave = async () => {
    if (!confirm('Leave this group?')) return;
    await api.post(`/conversations/${convId}/leave`);
    onLeft();
  };
  const inviteUrl = c.invite_code ? `${location.origin}/#/join/${c.invite_code}` : null;
  return (
    <div className="fixed inset-0 z-[92] bg-neutral-950 overflow-y-auto" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="min-h-full">
        <div className="sticky top-0 bg-neutral-950/95 backdrop-blur p-3 flex items-center gap-3 border-b border-neutral-900 z-10">
          <button onClick={onClose} className="text-white"><X size={20} /></button>
          <span className="text-white font-semibold">Group info</span>
        </div>
        <div className="p-4 flex flex-col items-center text-center">
          <div className="relative">
            {c.avatarUrl ? <Avatar src={c.avatarUrl} size={96} /> : <div className="w-24 h-24 rounded-full bg-neutral-800 flex items-center justify-center"><Users size={36} className="text-neutral-400" /></div>}
            {isAdmin && <label className="absolute bottom-0 right-0 bg-violet-600 text-white rounded-full p-1.5 cursor-pointer"><Pencil size={12} /><input type="file" hidden accept="image/*" onChange={e => { if (e.target.files![0]) pickAvatar(e.target.files![0]); e.target.value = ''; }} /></label>}
          </div>
          {editing ? (
            <div className="w-full mt-3 space-y-2">
              <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Group name" maxLength={80} />
              <Input value={desc} onChange={e => setDesc(e.target.value)} placeholder="Group description" maxLength={500} />
              <div className="flex gap-2">
                <Btn className="flex-1" onClick={() => { setEditing(false); setTitle(c.title || ''); setDesc(c.description || ''); }} disabled={saving}>Cancel</Btn>
                <Btn className="flex-1" onClick={save} disabled={saving || !title.trim()}>{saving ? 'Saving…' : 'Save'}</Btn>
              </div>
            </div>
          ) : (
            <>
              <h2 className="text-white text-xl font-bold mt-3">{c.title || 'Group'}</h2>
              <p className="text-neutral-400 text-sm mt-1">{c.description || 'No description'}</p>
              <p className="text-neutral-600 text-xs mt-1">Created {timeAgo(c.createdAt)} ago · {c.members?.length || 0} members</p>
              {isAdmin && <button onClick={() => setEditing(true)} className="text-violet-400 text-sm mt-2"><Pencil size={14} className="inline mr-1" />Edit name & description</button>}
            </>
          )}
        </div>
        {isAdmin && info.requests?.length > 0 && (
          <div className="px-4 py-3 border-t border-neutral-900">
            <h3 className="text-white text-sm font-semibold mb-2">Join requests ({info.requests.length})</h3>
            <div className="space-y-1">
              {info.requests.map((u: any) => (
                <div key={u.id} className="flex items-center gap-3 p-2 rounded-xl hover:bg-neutral-900">
                  <Avatar src={u.avatar_url} size={36} />
                  <div className="flex-1 min-w-0"><div className="text-white text-sm truncate">@{u.username}</div></div>
                  <Btn className="!px-3 !py-1 !text-xs" onClick={async () => { await api.post(`/conversations/${convId}/requests/${u.id}`, { approve: true }); await load(); onRefresh?.(); toast('approved'); }}>Approve</Btn>
                  <button className="text-red-400 text-xs px-2" onClick={async () => { await api.post(`/conversations/${convId}/requests/${u.id}`, { approve: false }); await load(); }}>Deny</button>
                </div>
              ))}
            </div>
          </div>
        )}
        {isAdmin && (
          <div className="px-4 py-3 border-t border-neutral-900 space-y-2">
            <ToggleRow label="Approve new members" desc="New join links need admin approval" on={!!c.settings?.adminApproval} onToggle={(v: boolean) => toggle('adminApproval', v)} />
            <ToggleRow label="Only admins can send messages" desc="Members can read but not write" on={!!c.settings?.onlyAdminsPost} onToggle={(v: boolean) => toggle('onlyAdminsPost', v)} />
          </div>
        )}
        {isAdmin && inviteUrl && (
          <div className="px-4 py-3 border-t border-neutral-900">
            <h3 className="text-white text-sm font-semibold mb-2">Invite link</h3>
            <div className="flex items-center gap-2">
              <div className="flex-1 bg-neutral-900 rounded-xl px-3 py-2 text-xs text-neutral-300 truncate">{inviteUrl}</div>
              <Btn className="!px-3 !py-1.5" onClick={() => { navigator.clipboard?.writeText(inviteUrl); toast('link copied'); }}>Copy</Btn>
              <button className="text-red-400 text-xs px-2" onClick={async () => { await api.post(`/conversations/${convId}/invite-link`); await load(); toast('link reset — old link no longer works'); }}>Reset</button>
            </div>
          </div>
        )}
        <div className="px-4 py-3 border-t border-neutral-900">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-white text-sm font-semibold">{c.members?.length || 0} members</h3>
            {isAdmin && <button onClick={() => setAddOpen(true)} className="text-violet-400 text-sm font-medium"><Plus size={14} className="inline mr-1" />Add member</button>}
          </div>
          <div className="space-y-1">
            {(c.members || []).map((u: any) => {
              const mineSelf = u.id === me.id;
              return (
                <div key={u.id} className="flex items-center gap-3 p-2 rounded-xl hover:bg-neutral-900" onClick={() => !mineSelf && onProfile?.(u.username)}>
                  <Avatar src={u.avatarUrl} size={40} />
                  <div className="flex-1 min-w-0">
                    <div className="text-white text-sm truncate">{u.displayName || u.username}{mineSelf && <span className="text-neutral-500"> (you)</span>}</div>
                    <div className="text-neutral-500 text-xs">@{u.username}</div>
                  </div>
                  {u.role !== 'member' && <span className="text-[10px] text-violet-300 bg-violet-900/40 rounded-full px-2 py-0.5">{u.role === 'owner' ? 'Group owner' : 'Admin'}</span>}
                  {isAdmin && !mineSelf && u.role !== 'owner' && (
                    <div className="flex gap-1">
                      <button title={u.role === 'member' ? 'Make admin' : 'Remove admin'} className="p-1.5 text-neutral-400 hover:text-white" onClick={(e) => { e.stopPropagation(); memberAction(u, 'role'); }}><Shield size={14} /></button>
                      <button title="Remove" className="p-1.5 text-neutral-400 hover:text-red-400" onClick={(e) => { e.stopPropagation(); memberAction(u, 'kick'); }}><UserMinus size={14} /></button>
                      <button title="Ban" className="p-1.5 text-neutral-400 hover:text-red-400" onClick={(e) => { e.stopPropagation(); memberAction(u, 'ban'); }}><Ban size={14} /></button>
                      <button title="Mute" className="p-1.5 text-neutral-400 hover:text-red-400" onClick={(e) => { e.stopPropagation(); memberAction(u, 'mute'); }}><MicOff size={14} /></button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <Btn className="w-full mt-4 !bg-red-900/60 !text-red-300 hover:!bg-red-900" onClick={leave}>Leave group</Btn>
        </div>
      </div>
      {addOpen && <AddMembers convId={convId} onClose={() => setAddOpen(false)} onAdded={async () => { await load(); onRefresh?.(); }} toast={toast} />}
    </div>
  );
}

function ToggleRow({ label, desc, on, onToggle }: { label: string; desc: string; on: boolean; onToggle: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between py-1">
      <div className="flex-1 pr-3">
        <div className="text-white text-sm">{label}</div>
        <div className="text-neutral-500 text-xs">{desc}</div>
      </div>
      <button onClick={() => onToggle(!on)} className={`w-11 h-6 rounded-full transition relative ${on ? 'bg-violet-600' : 'bg-neutral-700'}`}>
        <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
      </button>
    </div>
  );
}

function AddMembers({ convId, onClose, onAdded, toast }: any) {
  const [q, setQ] = useState('');
  const [users, setUsers] = useState<any[]>([]);
  const [sel, setSel] = useState<any[]>([]);
  useEffect(() => { if (q.length > 1) api.get(`/search?q=${encodeURIComponent(q)}`).then(d => setUsers(d.users || [])); else setUsers([]); }, [q]);
  return (
    <div className="fixed inset-0 z-[96] bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-neutral-900 border border-neutral-800 rounded-3xl w-full max-w-sm p-4" onClick={e => e.stopPropagation()}>
        <h3 className="text-white font-semibold mb-3">Add members</h3>
        <Input placeholder="Search users..." value={q} onChange={e => setQ(e.target.value)} className="mb-3" />
        <div className="space-y-1 max-h-60 overflow-y-auto">
          {users.map(u => (
            <button key={u.id} className="flex items-center gap-3 w-full p-2 hover:bg-neutral-800 rounded-lg text-left" onClick={() => setSel(s => s.some(x => x.id === u.id) ? s : [...s, u])}>
              <Avatar src={u.avatarUrl} size={32} />
              <span className="text-white text-sm">@{u.username}</span>
            </button>
          ))}
        </div>
        <Btn className="w-full mt-3" disabled={!sel.length} onClick={async () => {
          const d = await api.post(`/conversations/${convId}/members`, { usernames: sel.map(s => s.username) });
          toast(`${(d.added || sel).length} added`); onAdded(); onClose();
        }}>Add {sel.length ? `(${sel.length})` : ''}</Btn>
      </div>
    </div>
  );
}

function ForwardPicker({ msgId, excludeConvId, onClose, toast }: any) {
  const [convs, setConvs] = useState<any[]>([]);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  React.useEffect(() => { api.get('/conversations').then(d => setConvs(d.conversations)); }, []);
  const list = convs.filter(c => !q || (c.members || []).some((m: any) => m.username?.includes(q)));
  return (
    <div className="fixed inset-0 z-[95] bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-neutral-900 border border-neutral-800 rounded-3xl w-full max-w-sm p-4" onClick={e => e.stopPropagation()}>
        <h3 className="text-white font-semibold mb-3">Forward to…</h3>
        <Input placeholder="Search…" value={q} onChange={e => setQ(e.target.value)} className="mb-2" />
        <div className="max-h-64 overflow-y-auto space-y-1">
          {list.filter(c => c.id !== excludeConvId).map(c => {
            const other = c.members?.find((m: any) => m.id !== undefined);
            return (
              <button key={c.id} onClick={() => setSelected(s => s.includes(c.id) ? s.filter(x => x !== c.id) : [...s, c.id])}
                className={`w-full flex items-center gap-3 p-2 rounded-xl text-left ${selected.includes(c.id) ? 'bg-violet-900/50' : 'hover:bg-neutral-800'}`}>
                <Avatar src={other?.avatarUrl} size={32} />
                <span className="text-white text-sm flex-1">{c.is_group ? (c.title || 'Group') : (c.members || []).filter((m: any) => m.id).map((m: any) => '@' + m.username).join(', ')}</span>
                {selected.includes(c.id) && <Check size={16} className="text-violet-400" />}
              </button>
            );
          })}
        </div>
        <Btn className="w-full mt-3" disabled={!selected.length} onClick={async () => {
          await api.post(`/messages/${msgId}/forward`, { conversationIds: selected });
          toast('forwarded'); onClose();
        }}>Send to {selected.length}</Btn>
      </div>
    </div>
  );
}
