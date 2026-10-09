// Icons, as inline paths: a couple of dozen 24x24 outlines cost less
// than a dependency. Each sits beside a visible label, so it is hidden
// from screen readers.

const PATHS = {
  alert: 'M12 3l10 18H2zM12 10v5M12 18v.01',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  check: 'M5 12l5 5 9-10',
  clipboard: 'M9 3h6v4H9zM9 5H6v16h12V5h-3M9 12h6M9 16h4',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  list: 'M9 6h11M9 12h11M9 18h11M4 6v.01M4 12v.01M4 18v.01',
  live: 'M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM7.8 16.2a6 6 0 0 1 0-8.4M16.2 7.8a6 6 0 0 1 0 8.4M5 19a10 10 0 0 1 0-14M19 5a10 10 0 0 1 0 14',
  logout: 'M9 4H5v16h4M14 8l4 4-4 4M18 12H9',
  overview: 'M3 13h4v8H3zM10 3h4v18h-4zM17 9h4v12h-4z',
  people: 'M16 19v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 9a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 19v-2a4 4 0 0 0-3-3.87M16 1.13a4 4 0 0 1 0 7.75',
  pin: 'M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  plus: 'M12 5v14M5 12h14',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  sum: 'M5 21V10M10 21V4M15 21v-8M20 21v-5',
  upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
  x: 'M6 6l12 12M18 6L6 18',
}

function Icon({ name, size = 18, className = '' }) {
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
