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
 * "Alert me when a rival or partner joins open play", a section of You. Asks the phone only when tapped.
 * Hidden, heading and all, where alerts are off on the server or the browser cannot push;
 * on an iPhone outside the Home Screen it says how to get there, since
 * Apple allows web push only from there.
 */
function AlertSwitch() {
  const [state, setState] = useState('loading') // loading | hidden | install | blocked | off | on
  const [key, setKey] = useState(null)
  const [busy, setBusy] = useState(false)

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
    if (busy || (state !== 'on' && state !== 'off')) return
    const was = state
    let subscription = null
    setBusy(true)
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
    } finally {
      setBusy(false)
    }
  }

  if (state === 'loading' || state === 'hidden') return null
  const note = state === 'install' ? 'Add PaddlePad to your Home Screen first' : 'Notifications are blocked in your phone’s settings'
  return (
    <section className="you-section" aria-label="Alerts">
      <h2 className="you-head">
        <Icon name="bell" size={16} />
        Alerts
      </h2>
      {state === 'install' || state === 'blocked' ? (
        <p className="alert-bell-note">{note}</p>
      ) : (
        <button type="button" className="you-switch" role="switch" aria-checked={state === 'on'} aria-busy={busy} onClick={toggle}>
          <span>Alert me when a rival or partner joins open play</span>
          <span className="you-switch-track" aria-hidden="true"><span /></span>
        </button>
      )}
    </section>
  )
}

export default AlertSwitch
