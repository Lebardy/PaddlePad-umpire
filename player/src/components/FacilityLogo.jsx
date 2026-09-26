// A place's logo on a white tile -- white in both themes, because many
// logos are dark lettering on a see-through background -- or its
// initials, in the same lamp-lit square a player without a photo gets.
import { logoSrc } from '../lib/api'

function initialsOf(name) {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function FacilityLogo({ name, logoUrl, size = 'sm' }) {
  const src = logoSrc(logoUrl, { small: size === 'sm' })
  if (!src) {
    return <span className={`avatar avatar-${size === 'sm' ? 'md' : 'lg'} place-initials`} aria-hidden="true">{initialsOf(name)}</span>
  }
  return (
    <span className={`place-logo place-logo-${size}`} aria-hidden="true">
      <img src={src} alt="" loading="lazy" />
    </span>
  )
}

export default FacilityLogo
