// ============================================================
// Removing what one smoke run made, on staging only.
//
// Every smoke run adds umpires, admins, facilities, players and nights
// to staging, and before this existed they piled up: 140 "Smoke
// Facility" places and a thousand players in a fortnight, burying the
// data anyone actually wanted to look at.
//
// The run says what it made, by id, and only those go -- plus the
// nights and players made by the umpire it signs in as, which exists
// for the smoke test alone. Deleting by ownership of the smoke OWNER
// admin was considered and refused: on staging that account is the one
// that invited the real owner's admin account, so "everything it made"
// would have included a real person.
//
// Guards that hold whatever a caller sends:
//   - an owner admin is never deleted;
//   - a player who still appears in a match that is staying is kept;
//   - a facility anything still points at is kept rather than failing
//     the whole tidy.
// ============================================================

const LIST_KEYS = ['umpireIds', 'adminIds', 'facilityIds', 'playerIds']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_IDS = 2000

/** Reads a tidy request body: { umpireIds, adminIds, facilityIds, playerIds, inviteCodes, nightsOf, activityOf }. */
export function readTidyRequest(body) {
  const values = {}
  for (const key of LIST_KEYS) {
    const list = body?.[key] ?? []
    if (!Array.isArray(list) || list.length > MAX_IDS || !list.every((id) => typeof id === 'string' && UUID.test(id))) {
      return { error: `${key} must be a list of ids` }
    }
    values[key] = [...new Set(list)]
  }
  const codes = body?.inviteCodes ?? []
  if (!Array.isArray(codes) || codes.length > MAX_IDS || !codes.every((c) => typeof c === 'string' && c.length > 0 && c.length <= 64)) {
    return { error: 'inviteCodes must be a list of codes' }
  }
  values.inviteCodes = [...new Set(codes)]
  const nightsOf = body?.nightsOf ?? null
  if (nightsOf !== null && !(typeof nightsOf === 'string' && UUID.test(nightsOf))) {
    return { error: 'nightsOf must be an umpire id' }
  }
  values.nightsOf = nightsOf
  const activityOf = body?.activityOf ?? null
  if (activityOf !== null && !(typeof activityOf === 'string' && UUID.test(activityOf))) {
    return { error: 'activityOf must be an admin id' }
  }
  values.activityOf = activityOf
  return { values }
}

/** Deletes one smoke run's records inside the caller's transaction; returns counts. */
export async function tidySmokeRun(client, { umpireIds, adminIds, facilityIds, playerIds, inviteCodes, nightsOf, activityOf }) {
  const makers = nightsOf ? [...umpireIds, nightsOf] : umpireIds
  const counts = {}
  const run = async (key, sql, params) => {
    counts[key] = (await client.query(sql, params)).rowCount
  }

  // Nights first: their matches, rallies and rosters go with them.
  await run('sessions',
    'DELETE FROM sessions WHERE created_by = ANY($1::uuid[]) OR facility_id = ANY($2::uuid[])',
    [makers, facilityIds])

  await run('players',
    `DELETE FROM players p
      WHERE (p.id = ANY($1::uuid[]) OR p.created_by = ANY($2::uuid[]))
        AND NOT EXISTS (
          SELECT 1 FROM matches m
           WHERE p.id = ANY(m.team_a || m.team_b)
              OR m.first_server_player = p.id OR m.right_start_a = p.id OR m.right_start_b = p.id)`,
    [playerIds, makers])

  await run('invites',
    'DELETE FROM invites WHERE code = ANY($1::text[]) OR used_by = ANY($2::uuid[]) OR facility_id = ANY($3::uuid[])',
    [inviteCodes, umpireIds, facilityIds])

  const keep = nightsOf ? [nightsOf] : []
  await run('umpires',
    `DELETE FROM umpires
      WHERE (id = ANY($1::uuid[]) OR facility_id = ANY($2::uuid[]))
        AND NOT (id = ANY($3::uuid[]))`,
    [umpireIds, facilityIds, keep])

  // activityOf is the admin the run signs in as: its sign-ins and
  // password changes are test noise, but the account itself stays.
  await run('adminActivity',
    `DELETE FROM admin_activity
      WHERE admin_id = ANY($1::uuid[]) OR facility_id = ANY($2::uuid[])
         OR target_id = ANY($3::text[])`,
    [activityOf ? [...adminIds, activityOf] : adminIds, facilityIds,
      [...umpireIds, ...adminIds, ...facilityIds, ...playerIds, ...inviteCodes]])

  await run('admins',
    "DELETE FROM admins WHERE id = ANY($1::uuid[]) AND role <> 'owner'",
    [adminIds])

  await run('dismissedWarnings',
    'DELETE FROM dismissed_warnings WHERE facility_id = ANY($1::uuid[])',
    [facilityIds])

  await run('facilities',
    `DELETE FROM facilities f
      WHERE f.id = ANY($1::uuid[])
        AND NOT EXISTS (SELECT 1 FROM umpires u WHERE u.facility_id = f.id)
        AND NOT EXISTS (SELECT 1 FROM admins a WHERE a.facility_id = f.id)
        AND NOT EXISTS (SELECT 1 FROM sessions s WHERE s.facility_id = f.id)
        AND NOT EXISTS (SELECT 1 FROM invites i WHERE i.facility_id = f.id)
        AND NOT EXISTS (SELECT 1 FROM admin_activity x WHERE x.facility_id = f.id)
        AND NOT EXISTS (SELECT 1 FROM dismissed_warnings d WHERE d.facility_id = f.id)`,
    [facilityIds])

  return counts
}
