// Офлайн-кэш установленного приложения: страница берётся из сети, а без сети — из кэша.
// Запросы к /api и чужим сайтам не трогаем: задачи кэширует само приложение.
const CACHE = 'muravey-v1';
const SHELL = ['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (e) => {
    e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches
            .keys()
            .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
            .then(() => self.clients.claim()),
    );
});

self.addEventListener('fetch', (e) => {
    const req = e.request;
    const url = new URL(req.url);
    if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api')) return;
    // все адреса приложения (#вкладки, ?roadmap=…) — это одна страница index.html
    const key = req.mode === 'navigate' ? '/' : url.pathname;
    e.respondWith(
        fetch(req)
            .then((res) => {
                if (res.ok) {
                    const copy = res.clone();
                    caches.open(CACHE).then((c) => c.put(key, copy));
                }
                return res;
            })
            .catch(() => caches.match(key).then((hit) => hit || Response.error())),
    );
});
