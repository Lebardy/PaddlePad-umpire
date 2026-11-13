import { useEffect, useRef, useState } from 'react'
import { fetchPushKey, removePush, savePush, setRivalAlerts } from '../lib/api'
import Icon from './Icon'

// The key arrives as base64url; the browser wants its bytes.
function keyBytes(base64url) {
  const base64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
}

const iPhone = /iPhone|iPad|iPod/.test(navigator.userAgent)
const standalone = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true

/**
 * The Alerts section of You. The first switch is the player's own choice to take part at all,
 * saved on the server: off, their joins alert nobody and nothing is sent to them.
 * Under it, while that is on, "Alert me when a rival or partner joins open play" for this phone,
 * which asks the phone only when tapped. That row is hidden where alerts are off on the server
 * or the browser cannot push; on an iPhone outside the Home Screen it says how to get there,
 * since Apple allows web push only from there.
 */
function AlertSwitch({ player, onPlayerChange }) {
  const [state, setState] = useState('loading') // loading | hidden | install | blocked | off | on
  const [key, setKey] = useState(null)
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const takesPart = player.rivalAlerts !== false
  const note = useRef(null)
  const tapped = useRef(false)

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

  async function flip() {
    if (saving) return
    setSaving(true)
    try {
      onPlayerChange(await setRivalAlerts(!takesPart))
    } catch {
      // Unchanged on failure: the switch keeps showing what is saved.
    } finally {
      setSaving(false)
    }
  }

  async function toggle() {
    if (busy || (state !== 'on' && state !== 'off')) return
    const was = state
    let subscription = null
    setBusy(true)
    tapped.current = true
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

  // Refusing the permission swaps the switch for the note: keep the keyboard on the page.
  useEffect(() => {
    if (state === 'blocked' && tapped.current) note.current?.focus()
  }, [state])

  const words = state === 'install' ? 'Add PaddlePad to your Home Screen first' : 'Notifications are blocked in your phone’s settings'
  return (
    <section className="you-section" aria-label="Alerts">
      <h2 className="you-head">
        <Icon name="bell" size={16} />
        Alerts
      </h2>
      <button type="button" className="you-switch" role="switch" aria-checked={takesPart} aria-busy={saving} onClick={flip}>
        <span>Rival and partner alerts</span>
        <span className="you-switch-track" aria-hidden="true"><span /></span>
      </button>
      {!takesPart && <p className="detail-note">Your joins alert no one, and no alerts reach you.</p>}
      {takesPart && (state === 'install' || state === 'blocked') && <p ref={note} tabIndex={-1}>{words}</p>}
      {takesPart && (state === 'on' || state === 'off') && (
        <button type="button" className="you-switch" role="switch" aria-checked={state === 'on'} aria-busy={busy} onClick={toggle}>
          <span>Alert me when a rival or partner joins open play</span>
          <span className="you-switch-track" aria-hidden="true"><span /></span>
        </button>
      )}
    </section>
  )
}

export default AlertSwitch
