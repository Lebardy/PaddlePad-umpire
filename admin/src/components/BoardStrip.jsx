import { StripSkeleton } from './Skeleton'

/** The page's numbers in one row on the dark header, so they stay in view whatever tab is open. */
export default function BoardStrip({ cells, loading, cellCount }) {
  return (
    <div className="board-strip" aria-busy={loading || undefined}>
      {loading ? <StripSkeleton cells={cellCount} /> : cells.map((cell) => (
        <div className={`strip-cell${cell.lit ? ' is-lit' : ''}`} key={cell.key}>
          <span className="strip-label">{cell.label}</span>
          <span className="strip-figure">{cell.figure}</span>
          {cell.sub && <span className="strip-sub">{cell.sub}</span>}
        </div>
      ))}
    </div>
  )
}
