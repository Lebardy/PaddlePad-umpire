// ============================================================
// Initials in a circle.
//
// No uploads and no stored image: this needs to work the moment someone
// claims a code, and an empty grey circle waiting for a photo nobody
// will add is worse than initials that are always right.
//
// Deliberately ONE colour rather than a hue hashed from the name. The
// usual trick would drop unvalidated colours next to the validated
// palette in index.css, and the accent is doing identity work here, not
// categorical work -- two people's initials do not need telling apart by
// hue when their names are written beside them.
// ============================================================

function initialsOf(name) {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function Avatar({ name, size = 'md' }) {
  return (
    // aria-hidden because the name is always rendered next to it; a
    // screen reader announcing "JL" before "Jan Librando" is noise.
    <span className={`avatar avatar-${size}`} aria-hidden="true">
      {initialsOf(name)}
    </span>
  )
}

export default Avatar
