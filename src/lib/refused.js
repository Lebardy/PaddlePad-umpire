// ============================================================
// Words for an upload the server refused for good.
//
// The outbox knows such an entry only as a kind and an id ("log" of
// match 7a6f...). An umpire deciding whether to try it again or let it
// go needs to be told what it was: which session, which match. Plain
// functions with no imports, so scripts/check-refused.mjs can run them.
// ============================================================

/**
 * One line naming what was being sent.
 *
 * `find` looks things up on this device: session(id), match(id) and
 * playerName(id), each returning null when the record is gone.
 */
export function describeRefused(entry, find) {
  const session = () => {
    const found = find.session(entry.entityId)
    return found ? `“${found.name}”` : 'a session no longer on this device'
  }
  const match = () => {
    const found = find.match(entry.entityId)
    if (!found) return 'a match no longer on this device'
    const side = (team) => team.map((id) => find.playerName(id) ?? '?').join(' & ')
    return `${side(found.teamA)} vs ${side(found.teamB)}`
  }

  switch (entry.kind) {
    case 'session':
      return `The new session ${session()}`
    case 'roster':
      return `The players in ${session()}`
    case 'sessionEnd':
      return `${find.session(entry.entityId)?.endedAt ? 'Ending' : 'Reopening'} ${session()}`
    case 'sessionVoid':
      return `${find.session(entry.entityId)?.voidedAt ? 'Voiding' : 'Restoring'} ${session()}`
    case 'sessionDelete':
      return 'Deleting a session'
    case 'match':
      return `The new match, ${match()}`
    case 'log':
      return `The rallies of ${match()}`
    case 'matchVoid':
      return `${find.match(entry.entityId)?.voidedAt ? 'Voiding' : 'Restoring'} ${match()}`
    case 'matchDelete':
      return 'Deleting a match'
    default:
      return 'A change'
  }
}
