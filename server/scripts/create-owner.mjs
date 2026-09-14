#!/usr/bin/env node
// ============================================================
// Creates the owner: the first admin account.
//
//   railway ssh --service api --environment staging -- \
//     node scripts/create-owner.mjs --name "Your Name" --email you@example.com
//
// Runs inside the Railway container, because the database is not
// reachable from outside it. Prints a one-time setup link to open in a
// browser, where the owner chooses a password or connects Google.
// Refuses if an owner already exists; the database refuses a second
// one too.
// ============================================================

import { parseArgs } from 'node:util'
import { pool, withTransaction } from '../src/db.js'
import { createAdmin, createSetupLink } from '../src/admin-accounts.js'
import { recordActivity } from '../src/admin-activity.js'
import { normalizeEmail } from '../src/admin-rules.js'

const { values } = parseArgs({ options: { name: { type: 'string' }, email: { type: 'string' } } })
const name = String(values.name ?? '').trim()
const email = normalizeEmail(values.email)

if (!name || !email.includes('@')) {
  console.error('usage: node scripts/create-owner.mjs --name "Your Name" --email you@example.com')
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
