// Real device notifications: permission prompt + service-worker push subscription + in-app sound
export async function initPush() {
  // Native (Android/iOS from the Capacitor shell): real FCM/APNs notifications
  const isNative = !!(window as any).Capacitor?.isNativePlatform?.();
  if (isNative) {
    try {
      const { PushNotifications } = await import('@capacitor/push-notifications');
      await PushNotifications.requestPermissions();
      PushNotifications.addListener('registration', (token: any) => {
        fetch('/api/push/subscribe', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${localStorage.getItem('pixora_token')}` },
          body: JSON.stringify({ endpoint: 'fcm://' + token.value, keys: { fcm: token.value } }),
        }).catch(() => {});
      });
      PushNotifications.addListener('pushNotificationReceived', (n: any) => {
        try { new Notification(n.title || 'Pixora', { body: n.body, icon: '/icon.svg' }); } catch {}
      });
      PushNotifications.register();
      return true;
    } catch { /* fall through to web push */ }
  }
  try {
    const cfg = await fetch('/api/config').then(r => r.json()).catch(() => null);
    if (!cfg?.vapidPublicKey || !('serviceWorker' in navigator) || !('PushManager' in window)) return false;
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return false;
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(cfg.vapidPublicKey),
      });
    }
    const j = sub.toJSON();
    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${localStorage.getItem('pixora_token')}` },
      body: JSON.stringify({ endpoint: j.endpoint, keys: j.keys }),
    });
    return true;
  } catch { return false; }
}
function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}
// In-app notification sound (works even without OS push — plays when a message/mention arrives)
export function playNotifySound() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const seq = [[880, 0], [1174.7, 0.12]];
    for (const [f, t] of seq) {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.frequency.value = f; g.gain.value = 0.08;
      o.connect(g); g.connect(ctx.destination);
      o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.18);
    }
    setTimeout(() => ctx.close().catch(() => {}), 800);
  } catch {}
}
