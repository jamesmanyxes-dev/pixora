const CACHE = 'pixora-v15';
const SHELL = ['/', '/manifest.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api') || url.pathname.startsWith('/socket.io')) return;
  if (url.pathname.startsWith('/media/')) {
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => {
      const clone = r.clone(); caches.open(CACHE).then(c => c.put(e.request, clone)); return r;
    })));
    return;
  }
  e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE).then(cc => cc.put(e.request, c)); return r; })
    .catch(() => caches.match(e.request).then(hit => hit || caches.match('/'))));
});

// ---- Real push notifications with REPLY FROM NOTIFICATION ----
self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch {}
  e.waitUntil(self.registration.showNotification(data.title || 'Pixora', {
    body: data.body || 'You have a new message',
    icon: '/icon.svg',
    badge: '/icon.svg',
    tag: data.conversationId || undefined, // collapse per-conversation
    data: { conversationId: data.conversationId, senderId: data.senderId },
    // quick-reply + open actions right on the notification
    actions: data.conversationId ? [
      { action: 'reply', title: 'Reply', placeholder: 'Type a reply…' }, // supported on Android Chrome
      { action: 'open', title: 'Open chat' },
    ] : undefined,
  }));
});

self.addEventListener('notificationclick', (e) => {
  const n = e.notification;
  const convId = n.data?.conversationId;
  n.close();

  if (e.action === 'reply' && convId) {
    // Android Chrome shows an inline text input; iOS/Windows open the app with a reply box
    e.waitUntil((async () => {
      // try inline reply if the browser provides e.reply
      const replyText = e.reply || null;
      if (replyText) {
        const ok = await replyToConversation(convId, replyText);
        if (ok) {
          await self.registration.showNotification('Pixora', { body: '✓ Sent: ' + replyText, icon: '/icon.svg' });
          return;
        }
        // no auth in SW → open app with draft
      }
      await openWithDraft(convId, replyText);
    })());
    return;
  }
  e.waitUntil((async () => {
    const all = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    const target = convId ? `${self.registration.scope}#/messages/${convId}` : self.registration.scope;
    for (const c of all) { try { await c.focus(); await c.navigate(target); return; } catch {} }
    await clients.openWindow(target);
  })());
});

// send a reply directly from the SW using the stored refresh token (renewed silently)
async function replyToConversation(convId, text) {
  try {
    const token = await getAccessToken();
    if (!token) return false;
    const r = await fetch(`/api/conversations/${convId}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ body: text }),
    });
    return r.ok;
  } catch { return false; }
}

// keep an access token in IndexedDB; refresh it via the refresh token in localStorage
async function getAccessToken() {
  try {
    const db = await openDb();
    const cached = await db.get('kv', 'access_token');
    const issued = (await db.get('kv', 'access_issued')) || 0;
    if (cached && Date.now() - issued < 13 * 60 * 1000) return cached; // fresh enough
    const client = await clients.matchAll({ type: 'window', includeUncontrolled: true })[0];
    if (client) {
      // ask an open app window for a fresh token
      const token = await new Promise((resolve) => {
        const ch = new MessageChannel();
        ch.port1.onmessage = (ev) => resolve(ev.data);
        client.postMessage({ type: 'need-access-token' }, [ch.port2]);
        setTimeout(() => resolve(null), 3000);
      });
      if (token) { await db.put('kv', 'access_token', token); await db.put('kv', 'access_issued', Date.now()); return token; }
    }
    return cached || null;
  } catch { return null; }
}

async function openWithDraft(convId, draft) {
  const all = await clients.matchAll({ type: 'window', includeUncontrolled: true });
  const target = convId ? `${self.registration.scope}#/messages/${convId}?draft=${encodeURIComponent(draft || '')}` : self.registration.scope;
  for (const c of all) { try { await c.focus(); await c.navigate(target); return; } catch {} }
  await clients.openWindow(target);
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('pixora-sw', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    req.onsuccess = () => resolve({
      get: (store, key) => new Promise((res) => { const r = req.result.transaction(store).objectStore(store).get(key); r.onsuccess = () => res(r.result); }),
      put: (store, key, val) => new Promise((res) => { const r = req.result.transaction(store, 'readwrite').objectStore(store).put(val, key); r.onsuccess = () => res(true); }),
    });
    req.onerror = () => reject(req.error);
  });
}
