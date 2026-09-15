// ============================================================
// Light, dark, or whatever the computer is set to. Always writes a
// resolved 'light' or 'dark' to data-theme, so the CSS needs only one
// dark palette. index.html runs the same logic before the first paint.
// ============================================================

const THEME_KEY = 'paddlepad.admin.theme'
const DARK_QUERY = '(prefers-color-scheme: dark)'

export const THEMES = [
  { key: 'system', label: 'Same as this computer' },
  { key: 'light', label: 'Light' },
  { key: 'dark', label: 'Dark' },
]

export function getThemeChoice() {
  try {
    const stored = localStorage.getItem(THEME_KEY)
    return THEMES.some((t) => t.key === stored) ? stored : 'system'
  } catch {
    return 'system'
  }
}

export function applyTheme(choice) {
  const dark = choice === 'dark' || (choice !== 'light' && (window.matchMedia?.(DARK_QUERY).matches ?? false))
  const resolved = dark ? 'dark' : 'light'
  document.documentElement.dataset.theme = resolved
  document.documentElement.style.colorScheme = resolved
  return resolved
}

export function setThemeChoice(choice) {
  try { localStorage.setItem(THEME_KEY, choice) } catch { /* private mode */ }
  return applyTheme(choice)
}

/** Follows the computer's setting while the choice is 'system'. */
export function watchSystemTheme(onChange) {
  const query = window.matchMedia?.(DARK_QUERY)
  if (!query) return () => {}
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}
