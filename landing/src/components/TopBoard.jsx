import { useEffect, useRef, useState } from 'react'
import { TABS, tabFromHash, tabAfterKey } from '../lib/tabs.js'
import { AUDIENCES } from '../lib/content.js'
import Icon from './Icon.jsx'
import LampHeadline from './LampHeadline.jsx'
import AudiencePanel from './AudiencePanel.jsx'
import './TopBoard.css'

// The top bar with its four tabs, the lamp headline, and one panel per
// tab. The hash is the tab, so a footer link or a shared address opens
// the right one.
export default function TopBoard({ seeIt }) {
  const [tab, setTab] = useState(() => tabFromHash(location.hash))
  const tabs = useRef({})

  useEffect(() => {
    const onHash = () => setTab(tabFromHash(location.hash))
    addEventListener('hashchange', onHash)
    return () => removeEventListener('hashchange', onHash)
  }, [])

  function select(id) {
    setTab(id)
    history.replaceState(null, '', '#' + id)
  }

  function onKeyDown(e) {
    const next = tabAfterKey(tab, e.key)
    if (next === tab) return
    e.preventDefault()
    select(next)
    tabs.current[next]?.focus()
  }

  return (
    <>
      <header className="topbar">
        <div className="wrap bar">
          <span className="brand">PaddlePad</span>
          <div role="tablist" aria-label="PaddlePad for" onKeyDown={onKeyDown}>
            {TABS.map((t) => (
              <button
                key={t.id}
                ref={(el) => { tabs.current[t.id] = el }}
                role="tab"
                id={`tab-${t.id}`}
                aria-controls={t.id}
                aria-selected={tab === t.id}
                aria-label={t.label}
                tabIndex={tab === t.id ? 0 : -1}
                data-audience={t.id}
                onClick={() => select(t.id)}
              >
                <Icon name={t.icon} size={22} />
                <span>{t.label}</span>
              </button>
            ))}
          </div>
        </div>
      </header>
      <main className="wrap">
        <LampHeadline />
        {TABS.map((t) => (
          <section className="panel" role="tabpanel" id={t.id} aria-labelledby={`tab-${t.id}`} data-audience={t.id} hidden={tab !== t.id} key={t.id}>
            {t.id === 'see-it' ? seeIt : <AudiencePanel audience={AUDIENCES[t.id]} />}
          </section>
        ))}
      </main>
    </>
  )
}
