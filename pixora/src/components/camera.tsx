import React, { useEffect, useRef, useState } from 'react';
import { X, SwitchCamera, Circle, RefreshCw } from 'lucide-react';
import { Btn } from '../ui';

// In-app camera with front/back switching — produces a File like a gallery pick
export function CameraCapture({ onCaptured, onClose, kind = 'photo' }: {
  onCaptured: (file: File) => void; onClose: () => void; kind?: 'photo' | 'video';
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facing, setFacing] = useState<'user' | 'environment'>('environment');
  const [error, setError] = useState('');
  const [recording, setRecording] = useState<MediaRecorder | null>(null);
  const [shot, setShot] = useState<string | null>(null);
  const shotBlob = useRef<Blob | null>(null);
  const startedAt = useRef(0);

  useEffect(() => { start(facing); return stop; }, [facing]);
  async function start(mode: 'user' | 'environment') {
    stop();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: mode }, width: { ideal: 1080 } },
        audio: kind === 'video',
      });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play().catch(() => {}); }
    } catch { setError('Camera unavailable — check permissions'); }
  }
  function stop() { streamRef.current?.getTracks().forEach(t => t.stop()); streamRef.current = null; }

  const capture = async () => {
    if (kind === 'video') {
      if (recording) { recording.stop(); setRecording(null); return; }
      const rec = new MediaRecorder(streamRef.current!);
      const chunks: Blob[] = [];
      rec.ondataavailable = e => chunks.push(e.data);
      rec.onstop = () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        shotBlob.current = blob;
        setShot(URL.createObjectURL(blob));
        stop();
      };
      rec.start(); setRecording(rec); startedAt.current = Date.now();
      return;
    }
    // photo: grab frame
    const v = videoRef.current!;
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth; canvas.height = v.videoHeight;
    canvas.getContext('2d')!.drawImage(v, 0, 0);
    canvas.toBlob(b => {
      if (!b) return;
      shotBlob.current = b;
      setShot(URL.createObjectURL(b));
      stop();
    }, 'image/jpeg', 0.92);
  };

  const confirm = () => {
    if (!shotBlob.current) return;
    const ext = shotBlob.current.type.startsWith('video') ? 'webm' : 'jpg';
    onCaptured(new File([shotBlob.current], `capture.${ext}`, { type: shotBlob.current.type }));
    onClose();
  };
  const flip = () => setFacing(f => f === 'user' ? 'environment' : 'user');

  return (
    <div className="fixed inset-0 z-[100] bg-black flex flex-col">
      <div className="flex items-center justify-between p-4">
        <button onClick={onClose} className="text-white"><X size={24} /></button>
        <span className="text-white text-sm">{kind === 'video' ? 'Video' : 'Photo'}</span>
        <button onClick={flip} className="text-white"><SwitchCamera size={24} /></button>
      </div>
      <div className="flex-1 relative flex items-center justify-center">
        {shot ? (
          shotBlob.current?.type.startsWith('video')
            ? <video src={shot} className="max-h-full max-w-full object-contain" autoPlay loop controls />
            : <img src={shot} className="max-h-full max-w-full object-contain" alt="capture" />
        ) : (
          <>
            <video ref={videoRef} autoPlay playsInline muted className="max-h-full max-w-full object-cover" style={{ transform: facing === 'user' ? 'scaleX(-1)' : 'none' }} />
            {error && <p className="text-neutral-400 text-sm">{error}</p>}
          </>
        )}
      </div>
      <div className="p-6 flex items-center justify-center gap-8">
        {shot ? (
          <>
            <button onClick={() => { setShot(null); start(facing); }} className="text-neutral-400 text-sm flex flex-col items-center"><RefreshCw size={20} />Retake</button>
            <button onClick={confirm} className="w-16 h-16 rounded-full bg-green-600 flex items-center justify-center text-white text-xl">✓</button>
          </>
        ) : (
          <button onClick={capture} className="w-20 h-20 rounded-full border-4 border-white flex items-center justify-center active:scale-95 transition">
            <span className={`w-16 h-16 rounded-full ${recording ? 'bg-red-500 animate-pulse' : 'bg-white'}`} />
          </button>
        )}
      </div>
    </div>
  );
  function setShotBlobCurrent() { void 0; }
}
