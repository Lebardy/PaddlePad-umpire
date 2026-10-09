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
  arrowUp: 'M12 19V5M6 11l6-6 6 6',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v6M12 7.5v.01',
  chevron: 'M9 6l6 6-6 6',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  bolt: 'M13 2L4 14h7l-1 8 9-12h-7z',

  // Marks that stand beside a label, so a line can say less.
  gauge: 'M4 18a9 9 0 1 1 16 0M12 14l4-6',
  check: 'M5 12l5 5 9-10',
  cross: 'M6 6l12 12M18 6L6 18',
  key: 'M8 19a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM11 12l9-9M16 7l3 3',
  lock: 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4',
  qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 18h2v2h-2zM18 14h2M14 19v1',
  userPlus: 'M15 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M8.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M19 8v6M16 11h6',
  pin: 'M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  court: 'M5 3h14v18H5zM5 12h14M12 3v5M12 16v5',
  clipboard: 'M9 3h6v4H9zM9 5H6v16h12V5h-3M9 12h6M9 16h4',
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
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...a11y}
    >
      <path d={PATHS[name]} />
    </svg>
  )
}

export default Icon
