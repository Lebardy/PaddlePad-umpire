import { logoSrc } from '../lib/api'

function initialsOf(name) {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/**
 * A facility's logo on a white tile -- white in both themes, because
 * many logos are dark lettering on a see-through background -- or its
 * initials when it has none. Hidden from screen readers: the name is
 * always written beside it.
 */
export default function FacilityLogo({ name, logoUrl, size = 'lg' }) {
  const src = logoSrc(logoUrl, { small: size === 'sm' })
  return (
    <span className={`fac-logo fac-logo-${size}${src ? '' : ' is-initials'}`} aria-hidden="true">
      {src ? <img src={src} alt="" /> : initialsOf(name)}
    </span>
  )
}
