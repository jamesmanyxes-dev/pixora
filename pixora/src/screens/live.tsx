import React, { useEffect, useRef, useState } from 'react';
import { X, Send, Heart, Video, VideoOff, Mic, MicOff, PhoneOff, Flag, Trash2 } from 'lucide-react';
import { api } from '../api';
import { Avatar, Btn, Input, Spinner } from '../ui';
import type { User } from '../types';

export function LivePage({ streamId, me, socket, onBack, toast }: { streamId: string; me: User; socket: any; onBack: () => void; toast: (s: string) => void }) {
  const [isHost, setIsHost] = useState<boolean | null>(null);
  const [viewers, setViewers] = useState(0);
  const [comments, setComments] = useState<any[]>([]);
  const [text, setText] = useState('');
  const localVideo = useRef<HTMLVideoElement>(null);
  const peers = useRef(new Map<string, RTCPeerConnection>());
  const pc = useRef<RTCPeerConnection | null>(null);
  const stream = useRef<MediaStream | null>(null);

  useEffect(() => {
    api.get('/live').then(d => {
      const s = d.streams.find((x: any) => x.id === streamId);
      setIsHost(s?.host?.username === me.username);
    });
    socket?.emit('live:join', { streamId });
    return () => socket?.emit('live:leave', { streamId });
  }, [streamId]);

  useEffect(() => {
    if (!socket) return;
    const ch = (c: any) => setComments(cs => [...cs.slice(-80), c]);
    const cd = ({ id }: any) => setComments(cs => cs.filter(x => x.id !== id));
    const vw = ({ streamId: s, count }: any) => s === streamId && setViewers(count);
    const ended = ({ streamId: s }: any) => { if (s === streamId) { toast('stream_ended'); onBack(); } };
    socket.on('live:comment', ch); socket.on('live:comment:deleted', cd); socket.on('live:viewers', vw); socket.on('live:ended', ended);

    // WebRTC signaling: host broadcasts to viewers (star topology via relay answer pattern)
    socket.on('live:signal', async ({ from, data }: any) => {
      if (isHost) {
        // viewer requests offer -> host creates per-viewer peer
        if (data.type === 'request') {
          const ice: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
          if (import.meta.env.VITE_TURN_URL) ice.push({ urls: import.meta.env.VITE_TURN_URL, username: import.meta.env.VITE_TURN_USERNAME, credential: import.meta.env.VITE_TURN_CREDENTIAL });
          const p = new RTCPeerConnection({ iceServers: ice });
          peers.current.set(from, p);
          stream.current?.getTracks().forEach(tr => p.addTrack(tr, stream.current!));
          p.onicecandidate = e => e.candidate && socket.emit('live:signal', { streamId, data: { candidate: e.candidate } });
          const offer = await p.createOffer();
          await p.setLocalDescription(offer);
          socket.emit('live:signal', { streamId, data: { offer, to: from } });
        } else if (data.candidate && peers.current.get(from)) {
          peers.current.get(from)!.addIceCandidate(data.candidate).catch(() => {});
        }
      } else if (data.offer && !pc.current) {
        const ice: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
          if (import.meta.env.VITE_TURN_URL) ice.push({ urls: import.meta.env.VITE_TURN_URL, username: import.meta.env.VITE_TURN_USERNAME, credential: import.meta.env.VITE_TURN_CREDENTIAL });
          const p = new RTCPeerConnection({ iceServers: ice });
        pc.current = p;
        p.ontrack = e => { if (localVideo.current) { localVideo.current.srcObject = e.streams[0]; localVideo.current.muted = false; } };
        p.onicecandidate = e => e.candidate && socket.emit('live:signal', { streamId, data: { candidate: e.candidate } });
        await p.setRemoteDescription(data.offer);
        const answer = await p.createAnswer();
        await p.setLocalDescription(answer);
        socket.emit('live:signal', { streamId, data: { answer } });
      } else if (data.answer && pc.current) { await pc.current.setRemoteDescription(data.answer).catch(() => {}); }
      else if (data.candidate && pc.current) { pc.current.addIceCandidate(data.candidate).catch(() => {}); }
    });
    return () => { socket.off('live:comment', ch); socket.off('live:comment:deleted', cd); socket.off('live:viewers', vw); socket.off('live:ended', ended); socket.off('live:signal'); };
  }, [socket, isHost, streamId]);

  const startBroadcast = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      stream.current = s;
      if (localVideo.current) { localVideo.current.srcObject = s; localVideo.current.muted = true; }
    } catch { toast('camera_unavailable'); }
  };
  const send = async () => {
    if (!text.trim()) return;
    socket?.emit('live:comment', { streamId, body: text });
    setText('');
  };
  return (
    <div className="h-[calc(100vh-104px)] sm:h-[calc(100vh-56px)] flex flex-col bg-black">
      <div className="flex items-center gap-3 p-3">
        <button onClick={onBack} className="text-white"><X size={20} /></button>
        <span className="text-white text-sm font-semibold flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />LIVE</span>
        <span className="text-neutral-400 text-xs">{viewers} watching</span>
        {isHost && <Btn variant="danger" className="ml-auto text-xs" onClick={async () => { await api.post(`/live/${streamId}/end`); stream.current?.getTracks().forEach(t => t.stop()); onBack(); }}>End</Btn>}
      </div>
      <div className="flex-1 relative bg-neutral-950">
        <video ref={localVideo} autoPlay playsInline className="w-full h-full object-cover" muted={isHost === true} />
        {isHost && !stream.current && <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
          <p className="text-neutral-400 text-sm">Start your camera to broadcast</p>
          <Btn onClick={startBroadcast}><Video size={16} className="inline mr-1" /> Go live</Btn>
        </div>}
      </div>
      <div className="h-36 overflow-y-auto px-4 py-2 space-y-1.5">
        {comments.map(c => (
          <div key={c.id} className="group flex items-center gap-2 text-sm">
            <Avatar src={c.user?.avatarUrl} size={20} />
            <span className="text-violet-300 font-medium text-xs">{c.user?.username}</span>
            {c.reaction ? <span>{c.reaction === 'heart' ? '❤️' : '🔥'}</span> : <span className="text-neutral-200 flex-1">{c.body}</span>}
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 max-sm:opacity-60">
              {c.userId !== me.id && (
                <button title="Report" className="text-neutral-500 hover:text-red-400 p-0.5" onClick={async () => {
                  const reason = prompt('Report this comment?', 'inappropriate');
                  if (reason) { await api.post(`/live/comments/${c.id}/report`, { reason }); toast('reported to admins'); }
                }}><Flag size={11} /></button>
              )}
              {(c.userId === me.id || isHost) && (
                <button title="Delete" className="text-neutral-500 hover:text-red-400 p-0.5" onClick={async () => {
                  await api.del(`/live/comments/${c.id}`);
                  setComments(cs => cs.filter(x => x.id !== c.id));
                }}><Trash2 size={11} /></button>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="p-3 flex gap-2 border-t border-neutral-900">
        <Input placeholder="Say something..." value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()} />
        <Btn onClick={send}><Send size={16} /></Btn>
        <Btn variant="ghost" onClick={() => socket?.emit('live:comment', { streamId, reaction: 'heart' })}><Heart size={16} /></Btn>
      </div>
    </div>
  );
}

export function LiveList({ onOpen }: { onOpen: (id: string) => void }) {
  const [streams, setStreams] = useState<any[]>([]);
  useEffect(() => { api.get('/live').then(d => setStreams(d.streams)); }, []);
  if (!streams.length) return <p className="text-center text-neutral-500 text-sm py-16">No one is live right now</p>;
  return <div className="p-4 space-y-3 pb-24 max-w-xl mx-auto">
    <h1 className="text-white font-bold text-xl">Live now</h1>
    {streams.map(s => (
      <button key={s.id} className="w-full bg-neutral-900 rounded-2xl p-4 text-left flex items-center gap-3" onClick={() => onOpen(s.id)}>
        <Avatar src={s.host.avatarUrl} size={44} />
        <div className="flex-1"><div className="text-white text-sm font-semibold">{s.title || 'Live'}</div><div className="text-neutral-500 text-xs">@{s.host.username}</div></div>
        <span className="text-red-400 text-xs flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />{s.viewerCount}</span>
      </button>
    ))}
  </div>;
}
