// The page's icons, drawn on one 24px grid with the apps' stroke style, so
// they take their colour from the text around them. Paths come from the
// approved prototype; whistle, moon and mail are drawn to match.
const PATHS = {
  play: <polygon points="6 4 20 12 6 20 6 4" />,
  player: <><circle cx="12" cy="7" r="4" /><path d="M4 21v-1a7 7 0 0 1 16 0v1" /></>,
  whistle: <><circle cx="8" cy="14" r="5" /><path d="M12 10.5L21 8v4h-6.5M8 11.5v2.5h2.5" /></>,
  court: <><rect x="2" y="5" width="20" height="14" rx="1" /><path d="M12 5v14M2 12h7M15 12h7M9 5v14M15 5v14" /></>,
  trend: <><path d="M3 17l6-6 4 4 8-8" /><path d="M15 7h6v6" /></>,
  style: <><circle cx="6" cy="8" r="2" /><circle cx="17" cy="7" r="2" /><circle cx="9" cy="17" r="2" /><circle cx="18" cy="16" r="3" /></>,
  target: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></>,
  film: <><rect x="2" y="5" width="15" height="14" rx="2" /><path d="M17 10l5-3v10l-5-3z" /></>,
  tap: <><path d="M9 11V5a2 2 0 0 1 4 0v6" /><path d="M13 9a2 2 0 0 1 4 0v4a7 7 0 0 1-7 7 5 5 0 0 1-5-5v-2a2 2 0 0 1 4 0" /></>,
  offline: <path d="M3 9a14 14 0 0 1 18 0M6.5 12.5a9 9 0 0 1 11 0M10 16a4 4 0 0 1 4 0M12 20v.01M4 4l16 16" />,
  camera: <><path d="M23 7l-7 5 7 5V7z" /><rect x="1" y="5" width="15" height="14" rx="2" /></>,
  star: <path d="M12 2l3 7 7 .5-5.5 4.5 2 7L12 17l-6.5 4 2-7L2 9.5 9 9z" />,
  tablet: <><rect x="5" y="2" width="14" height="20" rx="2" /><path d="M9 7h6M9 12h6" /></>,
  people: <><circle cx="9" cy="8" r="3" /><circle cx="17" cy="9" r="2" /><path d="M3 20a6 6 0 0 1 12 0M14 20a4 4 0 0 1 7-2.6" /></>,
  trophy: <><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z" /><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3" /></>,
  moon: <path d="M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10z" />,
  pause: <><rect x="6" y="5" width="4" height="14" /><rect x="14" y="5" width="4" height="14" /></>,
  prev: <path d="M15 18l-6-6 6-6" />,
  next: <path d="M9 18l6-6-6-6" />,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></>,
}

export default function Icon({ name, size = 20 }) {
  const path = PATHS[name]
  if (!path) return null
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {path}
    </svg>
  )
}
