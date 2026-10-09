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
  // The keys keep their old names so older entries still match; the
  // words are the ones the site uses now.
  'admin.switched_off': 'Paused an admin',
  'admin.switched_on': 'Resumed an admin',
  'admin.signed_out_others': 'Signed out other devices',
  'admin.backup_codes_created': 'Made backup codes',
  'admin.backup_code_used': 'Used a backup code',
  'admin.password_changed': 'Changed password',
  'admin.google_connected': 'Connected Google',
  'admin.google_disconnected': 'Disconnected Google',
  'invite.created': 'Made an invite code',
  'invite.cancelled': 'Cancelled an invite code',
  'admin.moved': 'Moved an admin',
  'umpire.moved': 'Moved an umpire',
  'umpire.paused': 'Paused an umpire',
  'umpire.unpaused': 'Resumed an umpire',
  'umpire.closed': 'Closed an umpire’s account',
  'player.paused': 'Paused a player',
  'player.unpaused': 'Resumed a player',
  'player.closed': 'Closed a player’s account',
  'player.claim_code_created': 'Made a claim code',
  'facility.created': 'Made a facility',
  'facility.updated': 'Updated a facility',
  'facility.logo_changed': 'Changed a facility logo',
  'facility.logo_removed': 'Removed a facility logo',
  'match.looks_fine': 'Marked a match as fine',
  'match.voided': 'Voided a match',
  'match.restored': 'Undid a void',
  'player.not_duplicate': 'Marked players as different people',
  'player.merged': 'Merged two players',
  'session.closed': 'Closed a session',
}

export function actionLabel(action) {
  return ACTION_LABELS[action] ?? action
}

// Overview

/** "just now", "14 min ago", "2 h ago", "yesterday", "4 days ago". */
export function agoText(iso, now = Date.now()) {
  const minutes = Math.floor((now - Date.parse(iso)) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.floor(hours / 24)
  return days === 1 ? 'yesterday' : `${days} days ago`
}

/** "7:42 PM", in the viewer's own time. */
export function clockText(iso) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

export function countWord(n, one, many) {
  return `${n} ${n === 1 ? one : many}`
}

// Facilities

/**
 * What the header shows under an admin's name: 'All facilities' for the
 * owner, or the name of the one facility a facility admin belongs to.
 * `facilities` is whatever GET /admin/facilities has returned so far --
 * for a facility admin that's a one-row list holding only their own, so
 * before it has loaded (or if it somehow comes back without a match)
 * this reads null rather than guessing at a name.
 */
export function facilityLabel(admin, facilities = []) {
  if (admin.role === 'owner') return 'All facilities'
  const facility = facilities.find((f) => f.id === admin.facilityId)
  return facility ? facility.name : null
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

/**
 * The rating an admin sees is the one the player sees: their PaddlePad
 * Rating (PPR), worked out rally by rally.
 */
export function pprText(ppr) {
  if (ppr?.state === 'rated') return `${ppr.points.toLocaleString('en-US')} PPR`
  if (ppr?.state === 'not_enough_matches') return `Not rated yet: ${ppr.have} of ${ppr.need} matches`
  return 'Not rated yet'
}

// The pipeline starts every style name with a word for the skill group
// it was found in ("Group A", "Advanced"); the player app drops it, so
// this does too (player/src/lib/styleName.js, the same rule).
const GROUP_WORDS = {
  'Developing / Lower-Performance': 'Developing',
  'Higher-Performance': 'Advanced',
}

function withoutGroupWord(name, group) {
  if (!name || !group) return name
  const prefix = `${GROUP_WORDS[group] ?? group.replace('-Performance', '').replace('Performance Group', 'Group')} `
  return name.startsWith(prefix) ? name.slice(prefix.length) : name
}

/** The playstyle from the nightly run, or why there isn't one yet. */
export function playstyleText(rating) {
  if (rating?.state === 'rated') return withoutGroupWord(rating.playstyle, rating.skillGroup) || 'Not worked out yet'
  if (rating?.state === 'not_enough_matches') return `Not yet: ${rating.have} of ${rating.need} matches`
  if (rating?.state === 'not_enough_players') return `Not yet: waiting for more players (${rating.have} of ${rating.need})`
  if (rating?.state === 'pending') return 'At the next nightly run'
  return 'Not worked out yet'
}
