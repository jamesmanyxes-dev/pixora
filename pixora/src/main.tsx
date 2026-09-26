window.addEventListener('error', e => { ((window as any).__errs = (window as any).__errs || []).push(String(e.error?.stack || e.message)); });
window.addEventListener('unhandledrejection', e => { ((window as any).__errs = (window as any).__errs || []).push('rejection: ' + String(e.reason?.stack || e.reason)); });
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

const isNative = !!(window as any).Capacitor?.isNativePlatform?.();
if (!isNative && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
// deep-link push taps handled natively; keep root always '/' for the webview

createRoot(document.getElementById('root')!).render(<App />);
