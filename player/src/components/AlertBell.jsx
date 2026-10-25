import { useEffect, useState } from 'react'
import { fetchPushKey, removePush, savePush } from '../lib/api'
import Icon from './Icon'

// The key arrives as base64url; the browser wants its bytes.
function keyBytes(base64url) {
  const base64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
}

const iPhone = /iPhone|iPad|iPod/.test(navigator.userAgent)
const standalone = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true

/**
 * "Tell me when they join open play". Asks the phone only when tapped.
 * Hidden where alerts are off on the server or the browser cannot push;
 * on an iPhone outside the Home Screen it says how to get there, since
 * Apple allows web push only from there.
 */
function AlertBell() {
  const [state, setState] = useState('loading') // loading | hidden | install | blocked | off | on | busy
  const [key, setKey] = useState(null)

  useEffect(() => {
    let live = true
    ;(async () => {
      const serverKey = await fetchPushKey().catch(() => null)
      if (!live) return
      if (!serverKey) return setState('hidden')
      if (iPhone && !standalone) return setState('install')
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) return setState('hidden')
      if (Notification.permission === 'denied') return setState('blocked')
      const registration = await navigator.serviceWorker.ready
      const existing = await registration.pushManager.getSubscription()
      if (!live) return
      setKey(serverKey)
      setState(existing ? 'on' : 'off')
    })()
    return () => { live = false }
  }, [])

  async function toggle() {
    if (state !== 'on' && state !== 'off') return
    const was = state
    let subscription = null
    setState('busy')
    try {
      // Asked before any await: iPhone only shows the prompt inside the tap.
      const asked = was === 'on' ? null : Notification.requestPermission()
      const registration = await navigator.serviceWorker.ready
      if (was === 'on') {
        const existing = await registration.pushManager.getSubscription()
        if (existing) {
          await removePush(existing.endpoint)
          await existing.unsubscribe()
        }
        return setState('off')
      }
      if ((await asked) !== 'granted') return setState(Notification.permission === 'denied' ? 'blocked' : 'off')
      subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) })
      await savePush(subscription.toJSON())
      setState('on')
    } catch {
      // Subscribed here but the server never heard: drop it, or the next load says "on" with no alerts coming.
      await subscription?.unsubscribe().catch(() => {})
      setState(was)
    }
  }

  if (state === 'loading' || state === 'hidden') return null
  if (state === 'install' || state === 'blocked') {
    return (
      <p className="alert-bell-note">
        <Icon name="bell" size={18} />
        {state === 'install' ? 'Add PaddlePad to your Home Screen first' : 'Notifications are blocked in your phone’s settings'}
      </p>
    )
  }
  const on = state === 'on'
  return (
    <button type="button" className={on ? 'alert-bell is-on' : 'alert-bell'} aria-pressed={on} aria-busy={state === 'busy'} onClick={toggle}>
      <Icon name="bell" size={20} />
      {on ? 'Alerts on' : 'Tell me when they join open play'}
    </button>
  )
}

export default AlertBell
