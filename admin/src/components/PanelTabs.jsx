/**
 * Tabs inside a page: the same look as the page tabs (UmpireTabs), but they
 * switch what the page shows rather than its address. A tab with a `count`
 * shows it beside the label, dimmed when it's 0.
 */
export default function PanelTabs({ label, tabs, current, onChange }) {
  return (
    <div className="subtabs" role="tablist" aria-label={label}>
      {tabs.map((tab) => (
        <button key={tab.id} type="button" role="tab" aria-selected={tab.id === current} onClick={() => onChange(tab.id)}>
          {tab.label}
          {tab.count != null && <span className={`tab-count${tab.count === 0 ? ' is-zero' : ''}`}>{tab.count}</span>}
        </button>
      ))}
    </div>
  )
}
