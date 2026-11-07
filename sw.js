importScripts('core.js');
const SHELL = 'bmh-shell-v1', IMG = 'bmh-img-v1';
const ASSETS = ['./', 'index.html', 'styles.css', 'app.js', 'core.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/badge-96.png'];

self.addEventListener('install', e => { e.waitUntil(caches.open(SHELL).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('bmh-') && ![SHELL, IMG, KV_CACHE].includes(k)).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (u.origin === location.origin) {
    // app shell: network first (fresh code), fall back to cache offline
    e.respondWith(fetch(e.request).then(r => { if (r.ok) { const cp = r.clone(); caches.open(SHELL).then(c => c.put(e.request, cp)); } return r; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
    return;
  }
  if (/espncdn\.com|fonts\.(googleapis|gstatic)\.com/.test(u.hostname)) {
    // logos & fonts: cache first
    e.respondWith(caches.open(IMG).then(c => c.match(e.request).then(hit => hit || fetch(e.request).then(r => { if (r.ok || r.type === 'opaque') c.put(e.request, r.clone()); return r; }))));
  }
  // ESPN API: handled by the page itself (core.js keeps an offline copy)
});

const show = (title, opt) => self.registration.showNotification(title, { icon: 'icons/icon-192.png', badge: 'icons/badge-96.png', vibrate: [120, 60, 120], ...opt });

self.addEventListener('periodicsync', e => { if (e.tag === 'bmh-check') e.waitUntil(checkAndNotify(show).catch(() => { })); });
self.addEventListener('sync', e => { if (e.tag === 'bmh-check') e.waitUntil(checkAndNotify(show).catch(() => { })); });
self.addEventListener('push', e => {
  // optional: a push server can send {title, body, url}; without payload we just run a check
  let d = null; try { d = e.data && e.data.json(); } catch (_) { }
  e.waitUntil(d && d.title ? show(d.title, { body: d.body, data: { url: d.url || './' } }) : checkAndNotify(show, { force: true }));
});
self.addEventListener('message', e => { if (e.data && e.data.type === 'check') e.waitUntil(checkAndNotify(show)); });

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) { if ('focus' in c) { c.postMessage({ type: 'nav', url }); return c.focus(); } }
    return self.clients.openWindow(url);
  }));
});
