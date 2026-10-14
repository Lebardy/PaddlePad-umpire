// ============================================================
// The five level pictures: ball, upright paddle, ball over the net,
// crossed paddles, crossed paddles with a crown. Each has its own
// outline so they tell apart at 24 px, and they turn from outline to
// solid as the level rises. Decorative: the name always sits beside.
// ============================================================

const FACE = 'M24 5c6.1 0 10 4.2 10 10.2v4.6C34 25.8 30.1 30 24 30s-10-4.2-10-10.2v-4.6C14 9.2 17.9 5 24 5z'
const HANDLE = 'M21.5 30v8.5a2.5 2.5 0 0 0 5 0V30'
const CUT = { stroke: 'var(--emblem-cut)' }

/** Two solid paddles crossed; the front one keeps its full width and a cut ring parts it from the back one. */
function Crossed({ at, scale, stroke }) {
  const t = (angle) => `translate(${at}) rotate(${angle}) scale(${scale}) translate(-24 -24)`
  return (
    <>
      <g transform={t(-36)}>
        <path d={FACE} fill="currentColor" stroke="currentColor" strokeWidth={stroke} strokeLinejoin="round" />
        <path d={HANDLE} fill="currentColor" stroke="currentColor" strokeWidth={stroke} strokeLinejoin="round" />
      </g>
      <g transform={t(36)}>
        <path d={FACE} fill="none" style={CUT} strokeWidth={stroke * 2.7} strokeLinejoin="round" />
        <path d={HANDLE} fill="var(--emblem-cut)" style={CUT} strokeWidth={stroke * 2.3} strokeLinejoin="round" />
        <path d={FACE} fill="currentColor" stroke="currentColor" strokeWidth={stroke} strokeLinejoin="round" />
        <path d={HANDLE} fill="currentColor" stroke="currentColor" strokeWidth={stroke} strokeLinejoin="round" />
      </g>
    </>
  )
}

const DRAWINGS = {
  1: (
    <>
      <circle cx="24" cy="24" r="13" fill="none" stroke="currentColor" strokeWidth="2.8" />
      {[[19, 19.5], [28.5, 20], [22, 29], [30, 28.5]].map(([cx, cy]) => <circle key={cx} cx={cx} cy={cy} r="2" fill="currentColor" />)}
    </>
  ),
  2: (
    <>
      <path d={FACE} fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinejoin="round" />
      <path d={HANDLE} fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M19 14h10M19 19.5h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.55" />
    </>
  ),
  3: (
    <>
      <path d="M7 31Q22 2 40 25" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeDasharray="1 5.2" />
      <circle cx="40" cy="25" r="5" fill="currentColor" />
      <rect x="3" y="33" width="42" height="9" rx="1" fill="none" stroke="currentColor" strokeWidth="2.4" />
      <path d="M10 33v9M17 33v9M24 33v9M31 33v9M38 33v9M3 37.5h42" stroke="currentColor" strokeWidth="1.3" opacity="0.7" />
    </>
  ),
  4: <Crossed at="24 24" scale={0.86} stroke={2.6} />,
  5: (
    <>
      <Crossed at="24 31" scale={0.66} stroke={3} />
      <path d="M13 13l5.5 3.6L24 6.5l5.5 10.1 5.5-3.6-2.1 8H15.1z" fill="currentColor" style={CUT} strokeWidth="1.6" strokeLinejoin="round" />
    </>
  ),
}

function LevelEmblem({ rank, size = 24, className }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      {DRAWINGS[rank] ?? null}
    </svg>
  )
}

export default LevelEmblem
