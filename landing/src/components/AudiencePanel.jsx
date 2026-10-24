import Icon from './Icon.jsx'

// One audience's four facts and its way in. Facts hang in one after
// another each time the panel is shown (the CSS animation restarts when
// `hidden` lifts).
export default function AudiencePanel({ audience }) {
  return (
    <>
      <div className="facts">
        {audience.facts.map((f, i) => (
          <div className="fact" style={{ '--i': i }} key={f.title}>
            <span className="fact-icon"><Icon name={f.icon} size={28} /></span>
            <b>{f.title}</b>
            <p>{f.text}</p>
          </div>
        ))}
      </div>
      <div className="ctas">
        {audience.actions.map((a) => (
          <div className="cta" key={a.label}>
            <a className={`btn ${a.kind}`} href={a.href}>{a.label}</a>
            {a.note && <span className={a.href.startsWith('mailto:') ? 'note mail' : 'note'}>{a.note}</span>}
          </div>
        ))}
      </div>
    </>
  )
}
