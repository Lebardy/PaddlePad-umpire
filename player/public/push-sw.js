// Loaded by the generated service worker (vite.config.js importScripts).
// Shows an open play alert, and opens its place when tapped. The server
// re-sends with the same tag to update it; `update` keeps that quiet.
self.addEventListener('push', (event) => {
  const alert = event.data ? event.data.json() : null
  if (!alert) return
  event.waitUntil(self.registration.showNotification(alert.title, {
    body: alert.body,
    tag: alert.tag,
    renotify: false,
    silent: alert.update === true,
    icon: '/pwa-192x192.png',
    data: { url: alert.url },
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = new URL(event.notification.data?.url ?? '/', self.location.origin).href
  event.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const tab = open.find((client) => client.url.startsWith(self.location.origin))
    if (tab) {
      await tab.navigate(url)
      return tab.focus()
    }
    return self.clients.openWindow(url)
  })())
})
