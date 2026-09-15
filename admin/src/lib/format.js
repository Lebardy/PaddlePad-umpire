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
