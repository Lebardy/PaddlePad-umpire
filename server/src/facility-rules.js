// ============================================================
// Facilities: where umpires work and matches are scored for an hourly
// fee. Rules that need no database, checked offline by
// scripts/check-facility-rules.mjs.
// ============================================================

export const STARTING_FACILITY_NAME = 'Starting facility'
export const NO_FACILITY_MESSAGE = "Your account isn't linked to a facility yet. Ask your admin."

const PESOS = new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })

/** "₱150 per hour", "₱150.50 per hour", "Free" or "Fee not set". */
export function feeText(centavos) {
  if (centavos === null || centavos === undefined) return 'Fee not set'
  if (centavos === 0) return 'Free'
  const pesos = centavos / 100
  const text = Number.isInteger(pesos) ? PESOS.format(pesos) : pesos.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `₱${text} per hour`
}

/** A typed peso amount as centavos; null when left empty; undefined when it isn't an amount. */
export function pesosToCentavos(value) {
  if (value === null || value === undefined) return null
  const cleaned = String(value).replace(/[₱,\s]/g, '')
  if (cleaned === '') return null
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return undefined
  return Math.round(Number(cleaned) * 100)
}

const TEXT_FIELDS = [
  { key: 'area', column: 'area', max: 120, error: 'The area can be up to 120 characters' },
  { key: 'openingHours', column: 'opening_hours', max: 200, error: 'Opening hours can be up to 200 characters' },
  { key: 'details', column: 'details', max: 1000, error: 'Details can be up to 1000 characters' },
]

function optionalText(value) {
  const text = String(value ?? '').trim()
  return text === '' ? null : text
}

/**
 * Reads facility details from a request body into column values.
 * `partial` reads only the keys that were sent (for editing); otherwise
 * every field is read and the name is required (for creating).
 */
export function readFacility(body = {}, { partial = false } = {}) {
  const has = (key) => !partial || Object.prototype.hasOwnProperty.call(body, key)
  const values = {}

  if (has('name')) {
    const name = String(body.name ?? '').trim()
    if (!name || name.length > 80) return { error: 'A facility needs a name (up to 80 characters)' }
    values.name = name
  }
  for (const field of TEXT_FIELDS.slice(0, 1)) {
    if (has(field.key)) {
      const text = optionalText(body[field.key])
      if (text && text.length > field.max) return { error: field.error }
      values[field.column] = text
    }
  }
  if (has('locationUrl')) {
    const link = optionalText(body.locationUrl)
    if (link && link.length > 500) return { error: 'The map link can be up to 500 characters' }
    if (link && !link.startsWith('https://')) return { error: 'The map link must start with https://' }
    values.location_url = link
  }
  for (const field of TEXT_FIELDS.slice(1, 2)) {
    if (has(field.key)) {
      const text = optionalText(body[field.key])
      if (text && text.length > field.max) return { error: field.error }
      values[field.column] = text
    }
  }
  if (has('hourlyFee')) {
    const centavos = pesosToCentavos(body.hourlyFee)
    if (centavos === undefined) return { error: 'The fee must be an amount in pesos, like 150 or 150.50' }
    values.hourly_fee_centavos = centavos
  }
  if (has('umpireFee')) {
    const centavos = pesosToCentavos(body.umpireFee)
    if (centavos === undefined) return { error: 'The umpire fee must be an amount in pesos, like 100 or 100.50' }
    values.umpire_fee_centavos = centavos
  }
  for (const field of TEXT_FIELDS.slice(2)) {
    if (has(field.key)) {
      const text = optionalText(body[field.key])
      if (text && text.length > field.max) return { error: field.error }
      values[field.column] = text
    }
  }
  return { values }
}

/** The only columns a facility create/update may ever set from caller-supplied values. */
const FACILITY_VALUE_COLUMNS = ['name', 'area', 'location_url', 'opening_hours', 'hourly_fee_centavos', 'umpire_fee_centavos', 'details']

/**
 * Keeps only the fixed, known facility columns present in `values`,
 * dropping everything else -- so a caller that ever passes a raw
 * request body straight through can't smuggle in an arbitrary column
 * name. Used by facility-store.js to build its INSERT/UPDATE column
 * lists.
 */
export function facilityColumns(values = {}) {
  return FACILITY_VALUE_COLUMNS.filter((column) => Object.prototype.hasOwnProperty.call(values, column))
}

/**
 * Which of `values`' columns actually differ from the facility's current
 * row -- the fields an edit changed, as opposed to the fields it merely
 * sent. `before` is the current facility row (as read from the
 * database); `values` is a `readFacility()` result's `values`. Only the
 * columns present in `values` are compared, in the same order
 * `facilityColumns` would return them, so an edit form that always
 * sends every field still gets credited with only the ones that moved.
 */
export function changedFacilityColumns(before, values = {}) {
  return facilityColumns(values).filter((column) => before?.[column] !== values[column])
}

/**
 * Which facility(ies) a request is scoped to, for reading (a list
 * filter), writing (which facility a new or moved record gets), and
 * authorization (mayManageFacility/mayManageUmpire below). The single
 * place this decision is made -- every route and store function that
 * needs to scope or check something by facility calls this rather than
 * working it out itself, so the rule can never drift between them.
 *
 * `requestedFacilityId` is the facility the caller asked for (already
 * checked to be a well-formed id by the caller, or `null`/omitted) --
 * and it is only ever honoured for the owner. A facility admin can
 * never pick a different facility than their own, no matter what they
 * send, and an admin who belongs to no facility at all can never be
 * handed one this way either. Passing `null` (asking for nothing in
 * particular) is also how callers read an admin's own overall scope,
 * for an authorization check rather than a list filter.
 *
 * Returns exactly one of:
 *   `{ all: true }`  -- the owner, nothing requested: every facility.
 *   `{ id }`         -- the owner with a chosen facility, or any
 *                        facility admin (always their own).
 *   `{ none: true }` -- an admin who belongs to no facility: sees and
 *                        manages nothing. This is the case a careless
 *                        filter can turn into "no restriction" by
 *                        mistake -- callers must treat it as its own
 *                        branch, never fall through to `all`.
 */
export function facilityFilterFor(admin, requestedFacilityId) {
  if (admin?.role === 'owner') {
    return requestedFacilityId ? { id: requestedFacilityId } : { all: true }
  }
  return admin?.facilityId ? { id: admin.facilityId } : { none: true }
}

/** Whether an admin may manage a given facility: the owner any, a facility admin only their own, no one else any. */
export function mayManageFacility(admin, facilityId) {
  const scope = facilityFilterFor(admin, null)
  if (scope.all) return true
  if (scope.id) return scope.id === facilityId
  return false // scope.none
}

export function mayManageUmpire(admin, umpire) {
  return mayManageFacility(admin, umpire?.facility_id ?? null)
}

/** A pause stops a player everywhere, so it is the owner's alone. */
export function mayPausePlayers(admin) { return admin?.role === 'owner' }
export function mayCreateFacility(admin) { return admin?.role === 'owner' }
export function mayMove(admin) { return admin?.role === 'owner' }

/**
 * The SQL condition limiting `column` to one umpire's facility.
 *
 * The mirror of overview-store.js's scopeCondition, for the umpire side
 * where there is only ever one facility and never "all". An umpire with
 * no facility matches NOTHING rather than everything: on a database old
 * enough to still allow one, the safe reading of "belongs nowhere" is
 * "sees nothing", not "sees everything".
 */
export function umpireScope(facilityId, params, column) {
  if (!facilityId) return 'FALSE'
  params.push(facilityId)
  return `${column} = $${params.length}::uuid`
}

/**
 * The address a facility's logo is served at, or null without one. The
 * `v` stamp is when the logo last changed, so the long cache on that
 * address never shows an old logo after a new one is uploaded.
 */
export function logoPath(facilityId, logoUpdatedAt) {
  if (!logoUpdatedAt) return null
  return `/logos/${facilityId}?v=${new Date(logoUpdatedAt).getTime()}`
}

export function facilityPayload(row) {
  return {
    id: row.id,
    name: row.name,
    area: row.area ?? null,
    locationUrl: row.location_url ?? null,
    openingHours: row.opening_hours ?? null,
    hourlyFeeCentavos: row.hourly_fee_centavos ?? null,
    feeText: feeText(row.hourly_fee_centavos ?? null),
    umpireFeeCentavos: row.umpire_fee_centavos ?? null,
    // Unlike the court fee, an unset umpire fee is simply left out.
    umpireFeeText: row.umpire_fee_centavos == null ? null : feeText(row.umpire_fee_centavos),
    details: row.details ?? null,
    logoUrl: logoPath(row.id, row.logo_updated_at ?? null),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// ---- Facility logos ----

export const LOGO_TYPES = ['image/webp', 'image/png', 'image/jpeg']
export const LOGO_FULL_MAX_BYTES = 300 * 1024
export const LOGO_SMALL_MAX_BYTES = 60 * 1024

// How each allowed kind of picture starts. Checked on the bytes, not the
// label: a renamed text file says "image/png" as readily as a real one.
const LOGO_SIGNATURES = {
  'image/png': (b) => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/jpeg': (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/webp': (b) => b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP',
}

function readDataUrl(value) {
  const match = /^data:(image\/[a-z]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(value ?? ''))
  return match ? { mimeType: match[1], bytes: Buffer.from(match[2], 'base64') } : null
}

/**
 * A logo upload, `{ full, small }` as base64 data addresses, both the
 * same allowed kind of picture and each under its size cap. Returns
 * `{ values: { mimeType, full, small } }` with the decoded bytes, or
 * `{ error }` in words an admin can act on.
 */
export function readLogoUpload(body = {}) {
  const full = readDataUrl(body?.full)
  const small = readDataUrl(body?.small)
  if (!full || !small) return { error: "That file isn't a picture" }
  if (full.mimeType !== small.mimeType || !LOGO_TYPES.includes(full.mimeType)) {
    return { error: 'Use a PNG, JPEG or WebP picture' }
  }
  const looksRight = LOGO_SIGNATURES[full.mimeType]
  if (!looksRight(full.bytes) || !looksRight(small.bytes)) return { error: "That file isn't a picture" }
  if (full.bytes.length > LOGO_FULL_MAX_BYTES || small.bytes.length > LOGO_SMALL_MAX_BYTES) {
    return { error: 'That picture is too large' }
  }
  return { values: { mimeType: full.mimeType, full: full.bytes, small: small.bytes } }
}

// ---- What players see of a facility ----
// Only what a player can use to find and choose a place to play: never
// who made it, its admins or its umpires.

// "Fee not set" is for admins; a player page just leaves it out.
const playerFee = (centavos) => (centavos == null ? null : feeText(centavos))

export function playerFacilitySummary(row) {
  return {
    id: row.id,
    name: row.name,
    area: row.area ?? null,
    logoUrl: logoPath(row.id, row.logo_updated_at ?? null),
    // What a ticket on the People tab shows; the page has the rest.
    openingHours: row.opening_hours ?? null,
    feeText: playerFee(row.hourly_fee_centavos),
    umpireFeeText: playerFee(row.umpire_fee_centavos),
  }
}

export function playerFacilityPage(row) {
  return {
    id: row.id,
    name: row.name,
    area: row.area ?? null,
    openingHours: row.opening_hours ?? null,
    feeText: playerFee(row.hourly_fee_centavos),
    umpireFeeText: playerFee(row.umpire_fee_centavos),
    locationUrl: row.location_url ?? null,
    details: row.details ?? null,
    logoUrl: logoPath(row.id, row.logo_updated_at ?? null),
  }
}
