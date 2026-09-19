// ============================================================
// Facilities: reading, creating and updating them, and the admins
// and umpires that belong to one. Writes here run inside the
// caller's transaction so a facility change and its activity entry
// are recorded together, the same as the other admin stores.
// ============================================================

import { personStatus } from './people-rules.js'
import { facilityColumns } from './facility-rules.js'

const FACILITY_COLUMNS =
  'id, name, area, location_url, opening_hours, hourly_fee_centavos, details, created_by, created_at, updated_at'

/**
 * Every facility for a facility-rules.js `facilityFilterFor()` result:
 * `{ all }` -> every facility, ordered by name; `{ id }` -> that one
 * facility (empty if it doesn't exist); `{ none }`, missing, or any
 * unrecognised shape -> `[]`, fail closed rather than open.
 */
export async function listFacilities(queryFn, filter) {
  if (filter?.all) {
    const { rows } = await queryFn(`SELECT ${FACILITY_COLUMNS} FROM facilities ORDER BY name`)
    return rows
  }
  if (filter?.id) {
    const { rows } = await queryFn(`SELECT ${FACILITY_COLUMNS} FROM facilities WHERE id = $1`, [filter.id])
    return rows
  }
  return []
}

export async function findFacility(queryFn, id) {
  const { rows } = await queryFn(`SELECT ${FACILITY_COLUMNS} FROM facilities WHERE id = $1`, [id])
  return rows[0] ?? null
}

/**
 * The current row for a facility, with its row lock held until the
 * caller's transaction ends -- for a caller that needs to compare an
 * incoming edit against the current values before deciding what (if
 * anything) to write. Returns null when the facility doesn't exist.
 */
export async function lockFacility(db, id) {
  const { rows } = await db.query(`SELECT ${FACILITY_COLUMNS} FROM facilities WHERE id = $1 FOR UPDATE`, [id])
  return rows[0] ?? null
}

/**
 * Inserts a facility from `values` (the fixed column set `readFacility`
 * produces -- column names never come from anywhere else: `values` is
 * filtered through `facilityColumns` here regardless of what the
 * caller passed). Throws 23505 on `facilities_name_lower_idx` for a
 * name clash, left for the route to turn into its own message. Throws
 * when `values` has no allowed column.
 */
export async function createFacility(db, values, createdBy) {
  const columns = facilityColumns(values)
  if (columns.length === 0) throw new Error('createFacility: no allowed facility columns in values')
  const placeholders = columns.map((_, i) => `$${i + 1}`)
  const { rows } = await db.query(
    `INSERT INTO facilities (${columns.join(', ')}, created_by)
     VALUES (${placeholders.join(', ')}, $${columns.length + 1})
     RETURNING ${FACILITY_COLUMNS}`,
    [...columns.map((column) => values[column]), createdBy ?? null],
  )
  return rows[0]
}

/**
 * Updates a facility from `values` (again, filtered through
 * `facilityColumns`) and stamps `updated_at`. Returns the row, or null
 * when the facility doesn't exist. Throws 23505 the same way
 * createFacility does, and throws when `values` has no allowed column.
 */
export async function updateFacility(db, id, values) {
  const columns = facilityColumns(values)
  if (columns.length === 0) throw new Error('updateFacility: no allowed facility columns in values')
  const sets = columns.map((column, i) => `${column} = $${i + 2}`)
  sets.push('updated_at = now()')
  const { rows } = await db.query(
    `UPDATE facilities SET ${sets.join(', ')} WHERE id = $1
     RETURNING ${FACILITY_COLUMNS}`,
    [id, ...columns.map((column) => values[column])],
  )
  return rows[0] ?? null
}

/** The facility's admins and umpires, for its detail page. */
export async function facilityPeople(queryFn, id) {
  const [{ rows: admins }, { rows: umpires }] = await Promise.all([
    queryFn(
      'SELECT id, name, email, deactivated_at FROM admins WHERE facility_id = $1 ORDER BY name',
      [id],
    ),
    queryFn(
      'SELECT id, name, email, paused_at, closed_at FROM umpires WHERE facility_id = $1 ORDER BY name',
      [id],
    ),
  ])
  return {
    admins: admins.map((row) => ({ id: row.id, name: row.name, email: row.email, active: !row.deactivated_at })),
    umpires: umpires.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      status: personStatus({ pausedAt: row.paused_at, closedAt: row.closed_at }),
    })),
  }
}
