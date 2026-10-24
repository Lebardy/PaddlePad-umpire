// ============================================================
// Retires the player app's service worker.
//
// paddlepad.app used to be the player app, and phones that installed it
// still run its worker from this same /sw.js. The browser checks this
// file for updates, finds this one, and installs it. It then deletes
// every cache the old app saved, removes itself, and reloads each open
// window, which lands on index.html, whose forwarding script sends the
// visitor on to the player app's new address.
// ============================================================

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) await caches.delete(name)
      await self.registration.unregister()
      for (const client of await self.clients.matchAll({ type: 'window' })) client.navigate(client.url)
    })(),
  )
})
