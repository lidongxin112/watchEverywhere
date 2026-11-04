/* watchEverywhere 的离线外壳：只缓存静态资源，接口和媒体转发一律走网络 */
const CACHE = 'we-shell-v1';
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  // 接口、媒体转发、直播流不缓存
  if (url.pathname.startsWith('/api/')) return;

  // 静态资源：缓存优先，后台更新
  if (/\.(js|css|png|jpg|jpeg|webp|svg|woff2?|ttf)$/.test(url.pathname)) {
    e.respondWith(
      caches.match(req).then((hit) => {
        const fetching = fetch(req)
          .then((res) => {
            if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
            return res;
          })
          .catch(() => hit);
        return hit || fetching;
      })
    );
    return;
  }

  // 页面：网络优先，断了用缓存
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('/index.html')));
  }
});
