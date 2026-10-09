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

  // How a rally ended, each named by its ending key (server/src/
  // rally-endings.js): lines are the court, the net or the ground, a
  // circle is the ball, the rounded block a paddle, the boot a foot.
  ace: 'M3 8h6M3 12h4M3 16h6M16 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z',
  putaway: 'M4 20h16M6 4l10 10M16 8v6h-6',
  passing: 'M7 20V5M3.5 8.5L7 5l3.5 3.5M14.5 8h4A1.5 1.5 0 0 1 20 9.5v5a1.5 1.5 0 0 1-1.5 1.5h-4a1.5 1.5 0 0 1-1.5-1.5v-5A1.5 1.5 0 0 1 14.5 8zM16.5 16v4',
  lob: 'M3 20h18M12 20v-6M4 17C6 4 18 4 20 17',
  drop_winner: 'M3 20h18M12 20v-6M3 7c6 0 11 3.5 12.5 9M16.6 15.3a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
  dink_winner: 'M3 20h18M12 20v-6M7.5 17.5q4.5-9 9 0M18.4 15.8a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6z',
  other_winner: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM8 12.5l3 3 5-6.5',
  out: 'M3 13h13V4M19.5 15.2a2.3 2.3 0 1 0 0 4.6 2.3 2.3 0 0 0 0-4.6z',
  net: 'M3 20h18M12 20V8M10.3 8h3.4M7.3 10.9a2.3 2.3 0 1 0 0 4.6 2.3 2.3 0 0 0 0-4.6zM2.5 8.5l2 1.4',
  dink_error: 'M3 20h18M12 20v-8M12 7.4a2.3 2.3 0 1 0 0 4.6 2.3 2.3 0 0 0 0-4.6zM4 17c1.2-4.5 3.2-6.6 5.6-7',
  kitchen: 'M3 4h18v16H3zM7 15.5h8.6a1.2 1.2 0 0 0 1.2-1.2c0-1-.8-1.6-1.9-1.8l-2.2-.4-1-2.1-1.9.8V9.5H7z',
  service: 'M5.5 9h4A1.5 1.5 0 0 1 11 10.5v5A1.5 1.5 0 0 1 9.5 17h-4A1.5 1.5 0 0 1 4 15.5v-5A1.5 1.5 0 0 1 5.5 9zM7.5 17v4M17.5 3.7a2.3 2.3 0 1 0 0 4.6 2.3 2.3 0 0 0 0-4.6z',
  foot_fault: 'M16 3v18M4 17h14.5a1.5 1.5 0 0 0 1.5-1.5c0-1.5-1.2-2.3-2.8-2.6l-3.2-.6L12.2 9 9.5 10.2V8H4z',
  two_bounce: 'M4 20h16M3.5 7.5c3 1.5 4.8 6 6 12.5 1.3-5 3.3-8.3 6-9.3M18 7.3a2.3 2.3 0 1 0 0 4.6 2.3 2.3 0 0 0 0-4.6z',
  net_touch: 'M3 20h18M14 20V4M7.1 5h4A1.5 1.5 0 0 1 12.6 6.5v6A1.5 1.5 0 0 1 11.1 14h-4A1.5 1.5 0 0 1 5.6 12.5v-6A1.5 1.5 0 0 1 7.1 5zM9.1 14v4',
  hit_by_ball: 'M10 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM3 21v-2a5 5 0 0 1 5-5h4a5 5 0 0 1 3 1M19 13.7a2.3 2.3 0 1 0 0 4.6 2.3 2.3 0 0 0 0-4.6z',
  wrong_position: 'M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7',
  other_fault: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9 9l6 6M15 9l-6 6',

  // The third shot, and a tick for one that landed.
  drive: 'M3 12h16M14 7l5 5-5 5',
  check: 'M5 12l5 5 9-10',
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
