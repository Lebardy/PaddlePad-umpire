// Loaded by the generated service worker (vite.config.js importScripts).
// Shows an open play alert, and opens its place when tapped. The server
// re-sends with the same tag to update it; `update` keeps that quiet.
self.addEventListener('push', (event) => {
  let alert = null
  try { alert = event.data ? event.data.json() : null } catch { /* a malformed payload shows nothing */ }
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
  // Only ever this app's own pages; anything else opens the home page.
  let target = new URL(event.notification.data?.url ?? '/', self.location.origin)
  if (target.origin !== self.location.origin) target = new URL('/', self.location.origin)
  const url = target.href
  event.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const tab = open.find((client) => client.url.startsWith(self.location.origin))
    if (tab) {
      // Focus first, then navigate: the navigated page is a new client, so the old handle can no longer be focused.
      const focused = await tab.focus().catch(() => tab)
      const opened = await focused.navigate(url).catch(() => null)
      if (opened) return
    }
    return self.clients.openWindow(url)
  })())
})
