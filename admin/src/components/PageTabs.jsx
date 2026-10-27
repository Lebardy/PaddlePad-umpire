import Icon from './Icon'
import { Ghost } from './Skeleton'

/**
 * The page's own sections, one shown at a time. Arrow keys move between
 * them as a tablist should; a count is dimmed at 0 and a ghost while the
 * page is still loading.
 */
export default function PageTabs({ label, tabs, current, onChange, idPrefix }) {
  function onKeyDown(event) {
    const at = tabs.findIndex((tab) => tab.id === current)
    const next = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: tabs.length - 1 }[event.key]
    if (next === undefined) return
    event.preventDefault()
    const tab = tabs[(next + tabs.length) % tabs.length]
    onChange(tab.id)
    document.getElementById(`${idPrefix}-tab-${tab.id}`)?.focus()
  }
  return (
    <div className="page-tabs" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          id={`${idPrefix}-tab-${tab.id}`}
          type="button"
          role="tab"
          aria-selected={tab.id === current}
          aria-controls={`${idPrefix}-panel`}
          tabIndex={tab.id === current ? 0 : -1}
          onClick={() => onChange(tab.id)}
        >
          <Icon name={tab.icon} />
          {tab.label}
          {tab.count === null && <Ghost variant="count" />}
          {tab.count != null && <span className={`tab-count${tab.count === 0 ? ' is-zero' : ''}`}>{tab.count}</span>}
        </button>
      ))}
    </div>
  )
}
