import { useEffect, useRef, useState } from 'react'
import { fetchPushKey, removePush, savePush, setOpenPlayAlerts, setRivalAlerts } from '../lib/api'
import Icon from './Icon'

// The key arrives as base64url; the browser wants its bytes.
function keyBytes(base64url) {
  const base64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
}

const iPhone = /iPhone|iPad|iPod/.test(navigator.userAgent)
const standalone = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true

/**
 * The Alerts section of You. Two switches are the player's own choices, saved on the server:
 * rival and partner alerts (off, their joins alert nobody) and open play alerts.
 * Under them, while either is on, this phone's own sign-up, which asks the phone only when tapped.
 * That row is hidden where alerts are off on the server or the browser cannot push; on an iPhone
 * outside the Home Screen it says how to get there, since Apple allows web push only from there.
 */
function AlertSwitch({ player, onPlayerChange }) {
  const [state, setState] = useState('loading') // loading | hidden | install | blocked | off | on
  const [key, setKey] = useState(null)
  const [busy, setBusy] = useState(false)
  const rivalsOn = player.rivalAlerts !== false
  const openPlayOn = player.openPlayAlerts !== false
  const [saving, setSaving] = useState(null) // null | 'rivals' | 'openPlay'
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

  async function flip(which) {
    if (saving) return
    setSaving(which)
    try {
      onPlayerChange(which === 'rivals' ? await setRivalAlerts(!rivalsOn) : await setOpenPlayAlerts(!openPlayOn))
    } catch {
      // Unchanged on failure: the switch keeps showing what is saved.
    } finally {
      setSaving(null)
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
      <button type="button" className="you-switch" role="switch" aria-checked={rivalsOn} aria-busy={saving === 'rivals'} onClick={() => flip('rivals')}>
        <span>Rival and partner alerts</span>
        <span className="you-switch-track" aria-hidden="true"><span /></span>
      </button>
      {!rivalsOn && <p className="detail-note">Your joins alert no one.</p>}
      <button type="button" className="you-switch" role="switch" aria-checked={openPlayOn} aria-busy={saving === 'openPlay'} onClick={() => flip('openPlay')}>
        <span>Open play alerts</span>
        <span className="you-switch-track" aria-hidden="true"><span /></span>
      </button>
      {(rivalsOn || openPlayOn) && (state === 'install' || state === 'blocked') && <p ref={note} tabIndex={-1}>{words}</p>}
      {(rivalsOn || openPlayOn) && (state === 'on' || state === 'off') && (
        <button type="button" className="you-switch" role="switch" aria-checked={state === 'on'} aria-busy={busy} onClick={toggle}>
          <span>Alerts on this phone</span>
          <span className="you-switch-track" aria-hidden="true"><span /></span>
        </button>
      )}
    </section>
  )
}

export default AlertSwitch
