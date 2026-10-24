// The video's picture: a drawn court seen from behind one baseline, two
// players, a ball. Stylised on purpose; the page never carries footage.
// `clip` picks which starred rally the ball flies (see Court in
// SeeIt.css); `playing` false parks the ball mid-flight.
export default function Court({ clip, playing }) {
  return (
    <svg className="court" viewBox="0 0 320 180" role="presentation" aria-hidden="true">
      <rect width="320" height="180" fill="#16302a" />
      <rect y="108" width="320" height="72" fill="#1c3b33" />
      <g fill="none" stroke="rgba(255,255,255,.82)" strokeWidth="2" strokeLinejoin="round">
        <path d="M35 165H285L225 50H95Z" />
        <path d="M75 88H245M53 128H267M160 50V88M160 128V165" />
      </g>
      <path d="M65 98H255V106H65Z" fill="rgba(255,255,255,.34)" stroke="rgba(255,255,255,.9)" strokeWidth="2" />
      {/* Dani far side (orange), Rio near side (blue): the app's two series colours. */}
      <g fill="#eb6834"><circle cx="130" cy="62" r="5" /><rect x="125" y="68" width="10" height="16" rx="4" /></g>
      <g fill="#5b93ea"><circle cx="196" cy="140" r="7" /><rect x="188" y="148" width="16" height="22" rx="6" /></g>
      <g className={`ball c${clip}${playing ? '' : ' parked'}`} key={clip}>
        <ellipse className="ball-shadow" rx="6" ry="2.2" fill="rgba(0,0,0,.4)" />
        <circle className="ball-dot" r="5" fill="#e8ff5a" />
      </g>
    </svg>
  )
}
