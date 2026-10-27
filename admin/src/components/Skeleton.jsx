/** Loading placeholders: the shape of what is coming, never fake numbers. */
export function Ghost({ variant = 'line', style }) {
  return <span className={`ghost ghost-${variant}`} style={style} aria-hidden="true" />
}

export function StripSkeleton({ cells }) {
  return Array.from({ length: cells }, (_, i) => (
    <div className="strip-cell" key={i} aria-hidden="true"><Ghost variant="label" /><Ghost variant="figure" /><Ghost variant="label" /></div>
  ))
}

export function RowsSkeleton({ rows = 5 }) {
  return (
    <div className="rows-skeleton" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => <Ghost key={i} variant="row" />)}
    </div>
  )
}
