// ============================================================
// Icons, as inline paths.
//
// Written out rather than taken from a package: a couple of dozen
// 24x24 outlines cost less than a dependency. Every icon here sits
// beside a visible label and is hidden from screen readers; a button
// that shows an icon alone must carry its own aria-label.
// ============================================================

const PATHS = {
  alert: 'M12 3l10 18H2zM12 10v5M12 18v.01',
  book: 'M4 5a2 2 0 0 1 2-2h14v16H6a2 2 0 0 0-2 2zM4 21a2 2 0 0 0 2 2h14v-4',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  chevron: 'M9 6l6 6-6 6',
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
  key: 'M8 19a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM11 12l9-9M16 7l3 3',
  list: 'M9 6h11M9 12h11M9 18h11M4 6v.01M4 12v.01M4 18v.01',
  lock: 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4',
  logout: 'M9 4H5v16h4M14 8l4 4-4 4M18 12H9',
  mail: 'M3 6h18v12H3zM3 7l9 6 9-6',
  offline: 'M3 9a14 14 0 0 1 18 0M6.5 12.5a9 9 0 0 1 11 0M10 16a4 4 0 0 1 4 0M12 20v.01M4 4l16 16',
  people: 'M16 19v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 9a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 19v-2a4 4 0 0 0-3-3.87M16 1.13a4 4 0 0 1 0 7.75',
  pin: 'M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  play: 'M7 4l13 8-13 8z',
  plus: 'M12 5v14M5 12h14',
  qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 18h2v2h-2zM18 14h2M14 19v1',
  retry: 'M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5M20 12a8 8 0 0 1-14 5.3L4 15M4 20v-5h5',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  undo: 'M9 7L4 12l5 5M4 12h11a5 5 0 0 1 0 10h-2',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8',
  x: 'M6 6l12 12M18 6L6 18',
}

function Icon({ name, size = 20, className = '' }) {
  return (
    <svg
      className={`icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  )
}

export default Icon
