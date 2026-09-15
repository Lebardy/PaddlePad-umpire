/** The black board at the head of each page: its title, what it is for, and its numbers. */
export default function PageBoard({ title, intro, children }) {
  return (
    <header className="page-board board-texture">
      <div>
        <h1>{title}</h1>
        {intro && <p className="page-board-intro">{intro}</p>}
      </div>
      {children}
    </header>
  )
}

/** One lit number on a board. Given `onClick`, it is also a filter. */
export function TallyCell({ figure, label, pressed, onClick }) {
  const inner = (
    <>
      <span className="tally-figure">{figure}</span>
      <span className="tally-label">{label}</span>
    </>
  )
  if (!onClick) return <div className="tally-cell">{inner}</div>
  return <button type="button" className="tally-cell" aria-pressed={pressed} onClick={onClick}>{inner}</button>
}
