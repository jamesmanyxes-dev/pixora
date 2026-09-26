import React from 'react';
import { getLang, rtl } from './i18n';

export const Avatar = ({ src, size = 36, ring }: { src?: string | null; size?: number; ring?: boolean }) => (
  <div
    className={`shrink-0 rounded-full overflow-hidden bg-neutral-800 ${ring ? 'ring-2 ring-pink-500 ring-offset-2 ring-offset-neutral-950' : ''}`}
    style={{ width: size, height: size }}
  >
    {src ? <img src={src} className="w-full h-full object-cover" alt="" /> : <div className="w-full h-full flex items-center justify-center text-neutral-500 text-xs">@</div>}
  </div>
);

export const Spinner = ({ className = '' }: { className?: string }) => (
  <div className={`animate-spin rounded-full border-2 border-neutral-700 border-t-white ${className}`} style={{ width: 20, height: 20 }} />
);

export const Modal = ({ open, onClose, children, title }: { open: boolean; onClose: () => void; children: React.ReactNode; title?: string }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose} dir={rtl() ? 'rtl' : 'ltr'}>
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-md p-5 animate-[fadein_.15s_ease-out]" onClick={(e) => e.stopPropagation()}>
        {title && <h3 className="text-white font-semibold mb-4">{title}</h3>}
        {children}
      </div>
    </div>
  );
};

export const Btn = ({ children, onClick, variant = 'primary', disabled, className = '', type, title }: {
  children: React.ReactNode; onClick?: () => void; variant?: 'primary' | 'ghost' | 'danger' | 'outline'; disabled?: boolean; className?: string; type?: 'submit'; title?: string;
}) => {
  const styles = {
    primary: 'bg-violet-600 hover:bg-violet-500 text-white',
    ghost: 'bg-neutral-800 hover:bg-neutral-700 text-white',
    danger: 'bg-red-600 hover:bg-red-500 text-white',
    outline: 'border border-neutral-700 hover:bg-neutral-800 text-white',
  }[variant];
  return (
    <button type={type} disabled={disabled} onClick={onClick} title={title}
      className={`px-4 py-2 rounded-xl text-sm font-medium transition disabled:opacity-40 disabled:cursor-not-allowed ${styles} ${className}`}>
      {children}
    </button>
  );
};

export const Input = (p: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input {...p} className={`w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2.5 text-sm text-white placeholder-neutral-500 outline-none focus:border-violet-500 ${p.className || ''}`} />
);

export const timeAgo = (iso: string) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 604800) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString(getLang());
};

export const fmt = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n);
