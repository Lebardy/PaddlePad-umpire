// ============================================================
// The four tab icons, as inline paths.
//
// No icon package: four 24x24 outlines are cheaper written out than
// depended upon, and this app's whole character is that it carries no
// runtime dependencies beyond React.
//
// Every icon here sits beside a visible text label, so they are
// decorative and marked aria-hidden. An icon that carried meaning on its
// own would need a label instead.
// ============================================================

const PATHS = {
  overview: 'M3 13h4v8H3zM10 3h4v18h-4zM17 9h4v12h-4z',
  matches: 'M4 6h16M4 12h16M4 18h16',
  people: 'M16 19v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 9a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 19v-2a4 4 0 0 0-3-3.87M16 1.13a4 4 0 0 1 0 7.75',
  you: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8',
}

function Icon({ name, className }) {
  return (
    <svg
      className={className}
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
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
