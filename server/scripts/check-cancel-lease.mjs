#!/usr/bin/env node
// ============================================================
// Cancelling a match, or a session holding one, while another device
// is scoring it (src/routes/matches.js and sessions.js, DELETE /:id).
//
//   node server/scripts/check-cancel-lease.mjs
//
// Runs the real route handlers with the database faked: no Postgres.
// ============================================================

process.env.DATABASE_URL ??= 'postgres://nobody@localhost:1/none'
process.env.JWT_SECRET ??= 'x'.repeat(40)
const { pool } = await import('../src/db.js')
const matches = (await import('../src/routes/matches.js')).default
const sessions = (await import('../src/routes/sessions.js')).default

let pass = 0
let fail = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `   expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`)
}

const fresh = new Date().toISOString()
const held = { status: 'in_progress', scoring_device: 'A', scoring_claimed_at: fresh, recorded_by_name: 'Sam' }
let rows = []
let deleted = []
pool.query = async (text) => {
  if (/^\s*DELETE/.test(text)) { deleted.push(text.trim().split(/\s+/).slice(0, 3).join(' ')); return { rows: [], rowCount: 1 } }
  if (/count\(\*\)/.test(text)) return { rows: [{ n: 0 }], rowCount: 1 }
  if (/SELECT 1 FROM sessions/.test(text)) return { rows: [{}], rowCount: 1 }
  if (/FROM matches m/.test(text)) return { rows, rowCount: rows.length }
  return { rows: [], rowCount: 0 }
}

async function remove(router, deviceId) {
  const layer = router.stack.find((l) => l.route?.path === '/:id' && l.route.methods.delete)
  const handler = layer.route.stack.at(-1).handle
  const out = { status: null, body: null }
  const res = {
    status(code) { out.status = code; return this },
    json(body) { out.body = body; return this },
    end() { return this },
  }
  deleted = []
  await handler({ params: { id: 'm1' }, body: deviceId === undefined ? undefined : { deviceId }, umpire: { facilityId: 'f1' } }, res)
  return { ...out, deleted: deleted.length > 0 }
}

for (const [name, router] of [['match', matches], ['session', sessions]]) {
  console.log(`cancelling a ${name}`)
  rows = [held]
  const other = await remove(router, 'B')
  check('another device is refused with 409', other.status, 409)
  check('the refusal names the holder', other.body?.heldBy?.umpireName, 'Sam')
  check('and the match is still there', other.deleted, false)
  const own = await remove(router, 'A')
  check('the holding device may cancel (204)', [own.status, own.deleted], [204, true])
  const old = await remove(router, undefined)
  check('an older app copy with no deviceId may cancel (204)', [old.status, old.deleted], [204, true])
  rows = [{ ...held, scoring_claimed_at: new Date(Date.now() - 20 * 60_000).toISOString() }]
  const lapsed = await remove(router, 'B')
  check('a lapsed lease no longer protects it (204)', [lapsed.status, lapsed.deleted], [204, true])
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
