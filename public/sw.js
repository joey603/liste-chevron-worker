/* Minimal service worker — allows Edge/Chrome to install the site as an app.
   Navigation always bypasses HTTP cache so GitHub Pages updates show up. */
self.addEventListener('install', (event) => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.map((key) => caches.delete(key)))
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  const isHtml =
    req.mode === 'navigate' ||
    (req.headers.get('accept') || '').includes('text/html')
  event.respondWith(fetch(req, isHtml ? { cache: 'reload' } : undefined))
})
