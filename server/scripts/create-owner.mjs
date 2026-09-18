#!/usr/bin/env node
// ============================================================
// Creates the owner: the first admin account.
//
//   railway ssh --service api --environment staging -- \
//     node scripts/create-owner.mjs --name "Your Name" --email you@example.com
//
// Locally, against a Postgres running on this machine:
//
//   node scripts/create-owner.mjs --name "Your Name" --email you@example.com --local
//
// Runs inside the Railway container, because the database is not
// reachable from outside it. Prints a one-time setup link to open in a
// browser, where the owner chooses a password or connects Google.
// Refuses if an owner already exists; the database refuses a second
// one too.
//
// ADMIN_ORIGIN has to be set to the admin site's own address, or the
// link above silently points at http://localhost:5175 -- useless
// anywhere but a laptop. So this refuses to run at all unless
// ADMIN_ORIGIN is set, or --local says the localhost link is really
// what's wanted (local development only).
// ============================================================

import { parseArgs } from 'node:util'

const { values } = parseArgs({
  options: {
    name: { type: 'string' },
    email: { type: 'string' },
    local: { type: 'boolean', default: false },
  },
})
const name = String(values.name ?? '').trim()

// Checked before anything imports the database module, so this refuses
// cleanly even when DATABASE_URL is also unset -- nothing is created
// either way, but the ADMIN_ORIGIN message is the useful one to see.
if (!process.env.ADMIN_ORIGIN && !values.local) {
  console.error(
    'ADMIN_ORIGIN is not set. The setup link this prints would point at ' +
      'http://localhost:5175 instead of the real admin site, which is no use ' +
      'to anyone off this machine. Set ADMIN_ORIGIN to the admin site\'s ' +
      'address first, or pass --local if the localhost link is genuinely what ' +
      "you want. Nothing was created.",
  )
  process.exit(1)
}

const { pool, withTransaction } = await import('../src/db.js')
const { createAdmin, createSetupLink } = await import('../src/admin-accounts.js')
const { recordActivity } = await import('../src/admin-activity.js')
const { normalizeEmail, isAdminEmail } = await import('../src/admin-rules.js')

const email = normalizeEmail(values.email)

if (!name || !isAdminEmail(email)) {
  console.error('usage: node scripts/create-owner.mjs --name "Your Name" --email you@example.com [--local]')
  process.exit(2)
}

try {
  const link = await withTransaction(async (client) => {
    const { rows } = await client.query("SELECT 1 FROM admins WHERE role = 'owner'")
    if (rows.length > 0) {
      const error = new Error('An owner already exists. Nothing was created.')
      error.expected = true
      throw error
    }
    const owner = await createAdmin(client, { name, email, role: 'owner', createdBy: null })
    const created = await createSetupLink(client, { adminId: owner.id, createdBy: null })
    await recordActivity(client, {
      action: 'owner.created',
      targetType: 'admin',
      targetId: owner.id,
      summary: `Owner ${name} (${email}) created with the setup command`,
    })
    return created
  })
  console.log(`\nOwner created for ${name} (${email}).`)
  console.log(`Open this link within 24 hours to finish setting up. It works once:\n\n  ${link.url}\n`)
} catch (error) {
  if (error.expected) console.error(error.message)
  else if (error.code === '23505') console.error('An owner, or an admin with that email, already exists. Nothing was created.')
  else console.error('Could not create the owner:', error.message)
  process.exitCode = 1
} finally {
  await pool.end()
}
