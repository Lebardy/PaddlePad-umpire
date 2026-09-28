// ============================================================
// Icons, as inline paths.
//
// No icon package: a couple of dozen 24x24 outlines are cheaper written
// out than depended upon, and this app's whole character is that it
// carries no runtime dependencies beyond React.
//
// Most icons here sit beside a visible text label, so they are
// decorative and marked aria-hidden. An icon that stands in for words
// on its own must be given a `label`, which turns it into an image a
// screen reader can name.
// ============================================================

const PATHS = {
  // The four tabs.
  overview: 'M3 13h4v8H3zM10 3h4v18h-4zM17 9h4v12h-4z',
  matches: 'M4 6h16M4 12h16M4 18h16',
  people: 'M16 19v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 9a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 19v-2a4 4 0 0 0-3-3.87M16 1.13a4 4 0 0 1 0 7.75',
  you: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8',

  // The board and the match of the month.
  trophy: 'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4',
  trendUp: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  swap: 'M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7',
  equals: 'M5 9h14M5 15h14',
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
  flame: 'M12 3s5 4.5 5 10a5 5 0 0 1-10 0c0-3.5 3-5 3-8 1 1 2 2.5 2 4 0-2.5 0-4.5 0-6z',
  sparkle: 'M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z',
  star: 'M12 3l2.7 5.6 6.3.9-4.5 4.4 1 6.1L12 17l-5.5 3 1-6.1L3 9.5l6.3-.9z',
  arrowDown: 'M12 5v14M6 13l6 6 6-6',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v6M12 7.5v.01',
  chevron: 'M9 6l6 6-6 6',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  bolt: 'M13 2L4 14h7l-1 8 9-12h-7z',
}

function Icon({ name, className, size = 22, label }) {
  // Labelled: it carries meaning on its own and must be announced.
  // Unlabelled: decoration beside words, hidden from screen readers.
  const a11y = label
    ? { role: 'img', 'aria-label': label }
    : { 'aria-hidden': 'true', focusable: 'false' }
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...a11y}
    >
      <path d={PATHS[name]} />
    </svg>
  )
}

export default Icon
