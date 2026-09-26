import React, { useEffect, useRef, useState } from 'react';
import { Phone, PhoneOff, Video, VideoOff, Mic, MicOff, Volume2, VolumeX, PhoneIncoming, PhoneOutgoing, PhoneMissed } from 'lucide-react';
import { api } from '../api';
import { Avatar, Btn, Spinner } from '../ui';
import { t } from '../i18n';
import type { User } from '../types';

function iceConfig(): RTCConfiguration {
  const iceServers: RTCIceServer[] = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    // Public TURN relays so calls connect behind strict NAT / mobile data
    {
      urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turns:openrelay.metered.ca:443?transport=tcp', 'turn:openrelay.metered.ca:443?transport=tcp'],
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
  ];
  if (import.meta.env.VITE_TURN_URL) {
    iceServers.push({ urls: import.meta.env.VITE_TURN_URL, username: import.meta.env.VITE_TURN_USERNAME, credential: import.meta.env.VITE_TURN_CREDENTIAL });
  }
  return { iceServers, iceCandidatePoolSize: 4 };
}

// Full-screen WebRTC 1:1 call. Audio plays through the media element (reliable on
// phones); the speaker button boosts loudness via WebAudio on tap (user gesture).
export function CallOverlay({ call, me, socket, onClose, signalQueue, localPendingId }: {
  call: { id: string; peer: User; kind: 'audio' | 'video'; role: 'caller' | 'callee' };
  me: User; socket: any; onClose: () => void; signalQueue?: { current: any[] }; localPendingId?: string;
}) {
  const [status, setStatus] = useState<'ringing' | 'connecting' | 'active' | 'ended'>(call.role === 'caller' ? 'ringing' : 'ringing');
  const [muted, setMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const [volume, setVolume] = useState<1 | 2 | 0>(1); // normal → boosted → muted
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [mediaReady, setMediaReady] = useState(false);
  const localRef = useRef<HTMLVideoElement>(null);
  const remoteRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStream = useRef<MediaStream | null>(null);
  const remoteStream = useRef<MediaStream | null>(null);
  const pendingCandidates = useRef<RTCIceCandidateInit[]>([]);
  const retried = useRef(false);
  const lastRemoteOffer = useRef<any>(null);
  const boostCtx = useRef<AudioContext | null>(null);
  const ringingStop = useRef<null | (() => void)>(null);
  const statusRef = useRef(status);
  statusRef.current = status;
  const isVideo = call.kind === 'video';

  const activate = () => {
    if (statusRef.current !== 'active') {
      setStatus('active');
      setStartedAt(Date.now());
      ringingStop.current?.();
    }
  };

  // elapsed timer
  useEffect(() => {
    if (!startedAt) return;
    const iv = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(iv);
  }, [startedAt]);

  // ringing sound while waiting
  useEffect(() => {
    if (status !== 'ringing') return;
    let ctx: AudioContext | null = null;
    try {
      ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const gain = ctx.createGain();
      gain.gain.value = 0.05;
      gain.connect(ctx.destination);
      const iv = setInterval(() => {
        if (statusRef.current !== 'ringing') return;
        const osc = ctx!.createOscillator();
        osc.frequency.value = 440;
        osc.connect(gain);
        osc.start();
        setTimeout(() => { try { osc.stop(); } catch {} }, 500);
      }, 1200);
      ringingStop.current = () => clearInterval(iv);
      return () => { clearInterval(iv); ctx?.close().catch(() => {}); };
    } catch { return; }
  }, [status]);

  // peer connection + media
  useEffect(() => {
    let cancelled = false;
    const pc = new RTCPeerConnection(iceConfig());
    pcRef.current = pc;
    remoteStream.current = new MediaStream();

    const retryOrEnd = () => {
      if (!retried.current) {
        retried.current = true;
        if (statusRef.current === 'active') return; // was connected; don't tear down on one blip
        setStatus('connecting');
        pcRestart();
      } else if (statusRef.current !== 'active') {
        setStatus('ended');
        setTimeout(onClose, 1400);
      }
    };

    pc.ontrack = (e) => {
      e.streams[0]?.getTracks().forEach(tr => {
        if (!remoteStream.current!.getTracks().includes(tr)) remoteStream.current!.addTrack(tr);
      });
      setStatus(s => (s === 'ringing' || s === 'ended') ? 'connecting' : s);
    };
    pc.onicecandidate = (e) => {
      if (e.candidate) socket?.emit('call:signal', { callId: call.id, to: call.peer.id, data: { candidate: e.candidate.toJSON() } });
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') activate();
      else if (pc.connectionState === 'failed') retryOrEnd();
      else if (pc.connectionState === 'disconnected') {
        setTimeout(() => { if (pcRef.current?.connectionState === 'disconnected') retryOrEnd(); }, 4000);
      }
    };
    pc.oniceconnectionstatechange = () => {
      if (['connected', 'completed'].includes(pc.iceConnectionState)) activate();
      if (pc.iceConnectionState === 'failed') retryOrEnd();
    };

    function pcRestart() {
      (async () => {
        try {
          const pc2 = pcRef.current;
          if (!pc2) return;
          const offer = await pc2.createOffer({ iceRestart: true });
          await pc2.setLocalDescription(offer);
          if (call.role === 'caller')
            socket?.emit('call:signal', { callId: call.id, to: call.peer.id, data: { offer: { type: offer.type, sdp: offer.sdp }, iceRestart: true } });
        } catch {}
      })();
    }

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: call.kind === 'video' });
        if (cancelled) { stream.getTracks().forEach(tr => tr.stop()); return; }
        localStream.current = stream;
        setMediaReady(true);
        stream.getTracks().forEach(tr => pc.addTrack(tr, stream));

        if (call.role === 'caller') {
          if (localPendingId && call.id === localPendingId) return; // wait for real id → effect re-runs
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket?.emit('call:signal', { callId: call.id, to: call.peer.id, data: { offer: { type: offer.type, sdp: offer.sdp } } });
        }
      } catch {
        setStatus('ended');
        setTimeout(onClose, 1400);
      }
    })();

    // watchdog: restart ICE if never connected; give up after 30s
    const watchdog = setTimeout(() => {
      if (statusRef.current === 'connecting' || statusRef.current === 'ringing') {
        if (!retried.current) { retried.current = true; pcRestart(); }
      }
    }, 12000);
    const giveUp = setTimeout(() => {
      if (statusRef.current !== 'active') { setStatus('ended'); setTimeout(onClose, 1500); }
    }, 30000);

    return () => {
      cancelled = true;
      clearTimeout(watchdog); clearTimeout(giveUp);
      pc.close();
      localStream.current?.getTracks().forEach(tr => tr.stop());
      try { boostCtx.current?.close(); } catch {}
    };
  }, [call.id]);

  // attach local stream to the preview element whenever it exists (fixes black local preview)
  useEffect(() => {
    const el = localRef.current;
    if (el && localStream.current && el.srcObject !== localStream.current) {
      el.srcObject = localStream.current;
      el.muted = true;
      el.play?.().catch(() => {});
    }
  }, [mediaReady, camOff, status]);

  // attach remote stream whenever the remote element exists
  useEffect(() => {
    const el = remoteRef.current as any;
    if (el && remoteStream.current && el.srcObject !== remoteStream.current) {
      el.srcObject = remoteStream.current;
      el.play?.().catch(() => {});
    }
  });

  // element volume/mute follows the speaker control (element playback = reliable)
  useEffect(() => {
    const el = remoteRef.current as any;
    if (!el) return;
    el.muted = volume === 0 || (volume === 2 && !!boostCtx.current);
    el.volume = 1;
  }, [volume, status, isVideo]);

  // signaling
  useEffect(() => {
    if (!socket) return;
    const onSignal = async ({ callId, from, data }: any) => {
      if (callId !== call.id) return;
      const pc = pcRef.current;
      if (!pc) return;
      try {
        if (data.offer && call.role === 'callee') {
          if (pc.signalingState !== 'stable' && !data.iceRestart) return;
          lastRemoteOffer.current = data.offer;
          await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
          for (const c of pendingCandidates.current) await pc.addIceCandidate(c).catch(() => {});
          pendingCandidates.current = [];
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socket.emit('call:signal', { callId: call.id, data: { answer: { type: answer.type, sdp: answer.sdp } } });
        } else if (data.answer && call.role === 'caller') {
          if (pc.signalingState === 'have-local-offer') await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
          else if (data.iceRestart) await pc.setRemoteDescription(new RTCSessionDescription(data.answer)).catch(() => {});
        } else if (data.candidate) {
          if (pc.remoteDescription && pc.remoteDescription.type) await pc.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(() => {});
          else pendingCandidates.current.push(data.candidate);
        }
      } catch (e: any) { console.log('signal err', e.message); }
    };
    const onAnswered = ({ callId, accept }: any) => {
      if (callId !== call.id) return;
      if (!accept) { setStatus('ended'); setTimeout(onClose, 900); }
    };
    const onEnded = ({ callId }: any) => {
      if (callId !== call.id) return;
      setStatus('ended');
      setTimeout(onClose, 900);
    };
    socket.on('call:signal', onSignal);
    socket.on('call:answered', onAnswered);
    socket.on('call:ended', onEnded);
    if (signalQueue) {
      const queued = signalQueue.current.splice(0);
      queued.forEach(payload => { try { onSignal(payload); } catch {} });
    }
    return () => { socket.off('call:signal', onSignal); socket.off('call:answered', onAnswered); socket.off('call:ended', onEnded); };
  }, [socket, call.id]);

  const answer = () => {
    socket?.emit('call:answer', { callId: call.id, accept: true });
    setStatus('connecting');
  };
  const decline = () => {
    socket?.emit('call:answer', { callId: call.id, accept: false });
    socket?.emit('call:end', { callId: call.id });
    setStatus('ended'); onClose();
  };
  const hangUp = () => {
    socket?.emit('call:end', { callId: call.id });
    setStatus('ended');
    setTimeout(onClose, 700);
  };
  const toggleMute = () => {
    const tr = localStream.current?.getAudioTracks()[0];
    if (tr) { tr.enabled = muted; setMuted(!muted); }
  };
  const toggleCam = () => {
    const tr = localStream.current?.getVideoTracks()[0];
    if (tr) { tr.enabled = camOff; setCamOff(!camOff); }
  };
  // speaker: 1 → 2 (WebAudio boost, gesture-safe) → 0 (mute) → 1
  const cycleSpeaker = () => {
    const next = volume === 1 ? 2 : volume === 2 ? 0 : 1;
    if (next === 2 && !boostCtx.current) {
      try {
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        ctx.resume().then(() => {
          remoteStream.current?.getAudioTracks().forEach(tr => {
            const src = ctx.createMediaStreamSource(new MediaStream([tr]));
            const g = ctx.createGain();
            g.gain.value = 2.2;
            src.connect(g); g.connect(ctx.destination);
          });
        });
        boostCtx.current = ctx;
      } catch {}
    }
    if (boostCtx.current) boostCtx.current.resume().catch(() => {});
    setVolume(next);
  };

  const mmss = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`;
  const statusText = status === 'ringing' ? (call.role === 'caller' ? 'Ringing…' : `Incoming ${call.kind} call`)
    : status === 'connecting' ? 'Connecting…'
      : status === 'active' ? mmss : 'Call ended';

  return (
    <div className="fixed inset-0 z-[80] bg-neutral-950 flex flex-col">
      {/* main stage */}
      <div className="flex-1 relative flex items-center justify-center bg-black">
        {isVideo
          ? <video ref={remoteRef} autoPlay playsInline className="w-full h-full object-cover" />
          : <audio ref={remoteRef as any} autoPlay className="hidden" />}
        {/* overlay while not connected yet */}
        {(!isVideo || status !== 'active') && (
          <div className={`absolute inset-0 flex flex-col items-center justify-center gap-3 ${isVideo && status === 'active' ? 'hidden' : 'bg-black/60'}`}>
            <div className={`rounded-full ${status === 'ringing' ? 'animate-pulse ring-4 ring-violet-600/60' : 'ring-4 ring-green-600/30'}`}>
              <Avatar src={call.peer.avatarUrl} size={isVideo ? 96 : 140} />
            </div>
            <div className="text-white text-2xl font-semibold">{call.peer.displayName || call.peer.username}</div>
            <div className="text-neutral-300 text-sm flex items-center gap-2">
              {status === 'connecting' && <Spinner className="!w-4 !h-4" />}
              {statusText}
            </div>
          </div>
        )}
        {/* local preview */}
        {isVideo && mediaReady && (
          <div className="absolute bottom-24 right-4 w-28 h-40 rounded-2xl border border-white/20 shadow-lg overflow-hidden bg-neutral-900">
            <video ref={localRef} autoPlay playsInline muted className="w-full h-full object-cover" />
          </div>
        )}
      </div>

      {/* controls */}
      <div className="p-6 flex items-center justify-center gap-4 bg-neutral-950">
        {call.role === 'callee' && status === 'ringing' ? (
          <>
            <button onClick={decline} className="w-16 h-16 rounded-full bg-red-600 flex items-center justify-center text-white active:scale-95 transition"><PhoneOff size={26} /></button>
            <button onClick={answer} disabled={!mediaReady} className="w-16 h-16 rounded-full bg-green-600 flex items-center justify-center text-white active:scale-95 transition disabled:opacity-40">{isVideo ? <Video size={26} /> : <Phone size={26} />}</button>
          </>
        ) : (
          <>
            <button onClick={toggleMute} className={`w-14 h-14 rounded-full flex items-center justify-center transition ${muted ? 'bg-white text-black' : 'bg-neutral-800 text-white'}`} title="Mute">{muted ? <MicOff size={22} /> : <Mic size={22} />}</button>
            {isVideo && <button onClick={toggleCam} className={`w-14 h-14 rounded-full flex items-center justify-center transition ${camOff ? 'bg-white text-black' : 'bg-neutral-800 text-white'}`} title="Camera">{camOff ? <VideoOff size={22} /> : <Video size={22} />}</button>}
            <button onClick={cycleSpeaker} className={`relative w-14 h-14 rounded-full flex items-center justify-center transition ${volume === 0 ? 'bg-neutral-800 text-neutral-500' : volume === 2 ? 'bg-violet-600 text-white' : 'bg-neutral-800 text-white'}`} title="Speaker volume">
              {volume === 0 ? <VolumeX size={22} /> : <Volume2 size={22} />}
              {volume === 2 && <span className="absolute -top-1 -right-1 bg-violet-500 text-[9px] rounded-full px-1 font-bold text-white">2×</span>}
            </button>
            <button onClick={hangUp} className="w-16 h-16 rounded-full bg-red-600 flex items-center justify-center text-white active:scale-95 transition"><PhoneOff size={26} /></button>
          </>
        )}
      </div>
    </div>
  );
}

// Call history panel
export function CallHistory() {
  const [calls, setCalls] = useState<any[]>([]);
  useEffect(() => { api.get('/calls/history').then(d => setCalls(d.calls)); }, []);
  const fmtDur = (s: number) => s ? `${Math.floor(s / 60)}m ${s % 60}s` : '';
  return (
    <div className="bg-neutral-900 rounded-2xl p-4">
      <h3 className="text-white text-sm font-semibold mb-2">Call history</h3>
      {calls.length === 0 && <p className="text-neutral-500 text-xs">No calls yet — start one from a profile or chat.</p>}
      {calls.map(c => (
        <div key={c.id} className="flex items-center gap-3 py-2 border-b border-neutral-800 last:border-0">
          {c.outgoing ? <PhoneOutgoing size={16} className={c.status === 'missed' || c.status === 'declined' ? 'text-red-400' : 'text-green-400'} /> : <PhoneIncoming size={16} className={c.status === 'missed' || c.status === 'declined' ? 'text-red-400' : 'text-sky-400'} />}
          <Avatar src={c.peer.avatarUrl} size={32} />
          <div className="flex-1">
            <div className="text-white text-sm">@{c.peer.username}</div>
            <div className="text-neutral-500 text-xs">{c.kind} · {c.status} {fmtDur(c.durationSec) && `· ${fmtDur(c.durationSec)}`}</div>
          </div>
          <span className="text-neutral-600 text-[11px]">{new Date(c.startedAt).toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}
