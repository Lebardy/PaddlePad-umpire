// ============================================================
// Words for what the admin pages show. Pure, so they can be checked
// without a browser (scripts/check-format.mjs).
// ============================================================

export const EXPIRY_CHOICES = [
  { value: '7', label: 'In 7 days' },
  { value: '14', label: 'In 14 days' },
  { value: '30', label: 'In 30 days' },
  { value: '90', label: 'In 90 days' },
  { value: '365', label: 'In a year' },
  { value: 'never', label: 'Never' },
]

export function inviteStatusText(invite, now = Date.now()) {
  if (invite.status === 'used') return invite.used_by_name ? `Used by ${invite.used_by_name}` : 'Used'
  if (invite.status === 'expired') return 'Expired'
  if (!invite.expires_at) return 'Open · never expires'
  const days = Math.max(1, Math.ceil((new Date(invite.expires_at).getTime() - now) / 86_400_000))
  return `Open · ${days} day${days === 1 ? '' : 's'} left`
}

export function madeByText(invite) {
  if (!invite.created_by_name) return '—'
  return invite.made_before_admin_site
    ? `${invite.created_by_name} (before the admin site)`
    : invite.created_by_name
}

export function signInMethods(admin) {
  const methods = []
  if (admin.hasPassword) methods.push('Password')
  if (admin.googleEmail) methods.push(`Google (${admin.googleEmail})`)
  return methods.length > 0 ? methods.join(' · ') : 'Not set up yet'
}

// Fixed to Manila so every admin reads the same time, wherever their
// laptop thinks it is.
const WHEN = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
})

export function formatWhen(iso) {
  if (!iso) return '—'
  // Some browsers put a narrow no-break space before AM/PM.
  return WHEN.format(new Date(iso)).replace(/\s+/g, ' ')
}

const DAY = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', weekday: 'long', month: 'short', day: 'numeric' })
const DAY_WITH_YEAR = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })
const YEAR = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', year: 'numeric' })
const TIME = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' })

/** "Friday, Sep 18", with the year added when it isn't this year in Manila. */
export function dayHeading(iso, now = Date.now()) {
  const date = new Date(iso)
  return YEAR.format(date) === YEAR.format(new Date(now)) ? DAY.format(date) : DAY_WITH_YEAR.format(date)
}

export function timeOfDay(iso) {
  // Some browsers put a narrow no-break space before AM/PM; see formatWhen.
  return TIME.format(new Date(iso)).replace(/\s+/g, ' ')
}

const ACTION_LABELS = {
  'owner.created': 'Owner created',
  'admin.added': 'Added an admin',
  'admin.setup_link_created': 'Made a setup link',
  'admin.setup_completed': 'Finished setting up',
  'admin.signed_in': 'Signed in',
  'admin.sign_in_failed': 'Failed sign-in',
  'admin.switched_off': 'Switched an admin off',
  'admin.switched_on': 'Switched an admin on',
  'admin.password_changed': 'Changed password',
  'admin.google_connected': 'Connected Google',
  'admin.google_disconnected': 'Disconnected Google',
  'invite.created': 'Made an invite code',
  'invite.cancelled': 'Cancelled an invite code',
}

export function actionLabel(action) {
  return ACTION_LABELS[action] ?? action
}

// People

export function lastSignedInText(iso) {
  return iso ? formatWhen(iso) : 'Not yet recorded'
}

const capitalize = (word) => word.charAt(0).toUpperCase() + word.slice(1)

export function signInMethodsText(methods) {
  return methods && methods.length > 0 ? methods.map(capitalize).join(', ') : 'No way in yet'
}

const STATUS_LABELS = { active: 'Active', paused: 'Paused', closed: 'Closed' }

export function statusLabel(status) {
  return STATUS_LABELS[status] ?? status
}

// Mirrors the server's own rule (people-rules.js confirmNameMatches):
// whoever is closing an account must type its name back, ignoring case
// and outer spaces, before the button will do anything.
export function confirmNameMatches(typed, name) {
  const clean = String(typed ?? '').trim().toLowerCase()
  return clean !== '' && clean === String(name ?? '').trim().toLowerCase()
}

export function ratingText(rating) {
  if (!rating) return 'Not rated yet'
  if (rating.state === 'rated') {
    return rating.playstyle ? `${rating.skillScore} · ${rating.playstyle}` : `${rating.skillScore}`
  }
  if (rating.state === 'not_enough_matches') return `Not rated yet: ${rating.have} of ${rating.need} matches`
  if (rating.state === 'not_enough_players') {
    return `Not rated yet: waiting for more players (${rating.have} of ${rating.need})`
  }
  if (rating.state === 'pending') return 'Rated at the next nightly run'
  return 'Not rated yet'
}
