// ============================================================
// Light, dark, or whatever the phone is set to.
//
// The app followed prefers-color-scheme and nothing else, so someone
// whose phone is dark could not have a light app, or the reverse. This
// is the override.
//
// The important design choice: this ALWAYS writes a resolved value to
// data-theme, never "system". CSS therefore needs only one copy of the
// dark palette, under :root[data-theme='dark'], instead of one copy in a
// media query and a second under an attribute selector. Fifteen colour
// values written twice is fifteen values that will drift.
//
// A matching inline script runs in index.html before the app loads, so
// the first paint is already the right colour. Without it a dark-mode
// player gets a white flash on every launch, which is the most visible
// possible bug in a feature about what colour the app is.
// ============================================================

const THEME_KEY = 'paddlepad.player.theme'

export const THEMES = [
  { key: 'system', label: 'System' },
  { key: 'light', label: 'Light' },
  { key: 'dark', label: 'Dark' },
]

// Kept in step with --board and the dark --bg in index.css, which is what the
// browser chrome is meant to match.
const CHROME = { light: '#12161c', dark: '#0a0c0f' }

const DARK_QUERY = '(prefers-color-scheme: dark)'

function prefersDark() {
  return window.matchMedia?.(DARK_QUERY).matches ?? false
}

/** The stored choice, or 'system' when there isn't one. */
export function getThemeChoice() {
  try {
    const stored = localStorage.getItem(THEME_KEY)
    return THEMES.some((t) => t.key === stored) ? stored : 'system'
  } catch {
    // Private mode. 'system' is the right thing to fall back to anyway.
    return 'system'
  }
}

/** 'system' turned into the colour it actually means right now. */
export function resolveTheme(choice) {
  if (choice === 'light' || choice === 'dark') return choice
  return prefersDark() ? 'dark' : 'light'
}

/**
 * Writes the theme to the document.
 *
 * colorScheme is set alongside data-theme so the browser's own widgets
 * -- scrollbars, date pickers, form controls -- follow the app instead
 * of staying light on a dark page.
 */
export function applyTheme(choice) {
  const resolved = resolveTheme(choice)
  const root = document.documentElement

  root.dataset.theme = resolved
  root.style.colorScheme = resolved

  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', CHROME[resolved])

  return resolved
}

export function setThemeChoice(choice) {
  try {
    localStorage.setItem(THEME_KEY, choice)
  } catch {
    // Private mode. The choice holds for this tab and is forgotten on
    // reload, which is better than refusing to change colour at all.
  }
  return applyTheme(choice)
}

/**
 * Follows the operating system while the choice is 'system'.
 *
 * Without this, picking System and then switching the phone to dark
 * would leave the app light until it was reloaded -- which reads as the
 * setting not working.
 */
export function watchSystemTheme(onChange) {
  const query = window.matchMedia?.(DARK_QUERY)
  if (!query) return () => {}

  const handler = () => onChange()
  query.addEventListener('change', handler)
  return () => query.removeEventListener('change', handler)
}
