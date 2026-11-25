// Офлайн-кэш установленного приложения: страница берётся из кэша и обновляется в фоне.
// Запросы к /api и чужим сайтам не трогаем: задачи кэширует само приложение.
const CACHE = 'muravey-v2';
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

self.addEventListener('push', (e) => {
    const data = e.data ? e.data.json() : {};
    e.waitUntil(
        self.registration.showNotification(data.title || 'Муравей', {
            body: data.body || 'Вам открыли доступ к документу.',
            icon: '/icon-192.png',
            badge: '/icon-192.png',
            tag: data.tag || 'muravey-share',
            data: {url: data.url || '/'},
        }),
    );
});

self.addEventListener('notificationclick', (e) => {
    e.notification.close();
    const target = new URL(e.notification.data?.url || '/', self.location.origin).href;
    e.waitUntil(
        clients.matchAll({type: 'window', includeUncontrolled: true}).then((list) => {
            const client = list.find((item) => item.url.startsWith(self.location.origin));
            if (client) {
                if ('navigate' in client) return client.navigate(target).then((opened) => opened?.focus());
                return client.focus();
            }
            return clients.openWindow(target);
        }),
    );
});

self.addEventListener('fetch', (e) => {
    const req = e.request;
    const url = new URL(req.url);
    if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api')) return;
    // все адреса приложения (#вкладки, ?roadmap=…) — это одна страница index.html
    const key = req.mode === 'navigate' ? '/' : url.pathname;
    // сначала из кэша — приложение открывается сразу, свежая версия скачивается в фоне
    // и показывается при следующем запуске; без кэша (первый запуск) — из сети
    const fresh = fetch(req);
    const saved = fresh.then(async (res) => {
        if (res.ok) await (await caches.open(CACHE)).put(key, res.clone());
    });
    e.waitUntil(saved.catch(() => {}));
    e.respondWith(caches.match(key).then((hit) => hit || fresh));
});
