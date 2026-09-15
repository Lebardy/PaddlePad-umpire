// The lamp P from the site icon: a 5 by 7 grid of board lamps, the ones
// that spell the letter lit amber and the rest left dark.
const ROWS = ['11110', '10001', '10001', '11110', '10000', '10000', '10000']

export default function LampMark({ className = 'lamp-mark' }) {
  return (
    <svg className={className} viewBox="0 0 50 70" aria-hidden="true" focusable="false">
      {ROWS.flatMap((row, y) => [...row].map((lit, x) => (
        <circle
          key={`${x}-${y}`}
          cx={5 + x * 10}
          cy={5 + y * 10}
          r="4.3"
          fill={lit === '1' ? 'var(--lamp)' : 'rgba(255, 255, 255, 0.09)'}
        />
      )))}
    </svg>
  )
}
