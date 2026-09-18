// Минимальный service worker — просто пропускает все запросы напрямую.
// Его наличие — формальное требование Chrome/Android для "устанавливаемости"
// PWA, без чего сайт не появится в системном меню "Поделиться".
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
