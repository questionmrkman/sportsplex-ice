// Service worker: network first, cache as a fallback.
// The schedule changes every 30 minutes, so the network always wins when there is one; the cache only exists so the
// installed app still opens (with the last schedule it saw) when the phone is offline.
const CACHE = 'fennell-ice-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(async () => {
        // Filters and dates live in the query string, so a navigation falls back to the cached page ignoring it.
        return (await caches.match(req, { ignoreSearch: req.mode === 'navigate' }))
          || Response.error();
      }),
  );
});
