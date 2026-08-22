import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const here = dirname(fileURLToPath(import.meta.url))

// Railway injects DATABASE_URL for a provisioned Postgres service.
if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. Add a Postgres service in Railway (it sets ' +
      'this automatically), or copy server/.env.example to server/.env ' +
      'for local development.',
  )
}

// Railway's managed Postgres terminates TLS with a certificate that
// isn't in Node's trust store, so verification has to be relaxed for
// hosted connections. Local Postgres generally speaks plaintext, so
// SSL is skipped entirely there.
const isLocal = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL)

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },
})

export function query(text, params) {
  return pool.query(text, params)
}

/**
 * Runs one callback inside a transaction, rolling back on any throw.
 * Used wherever a write spans more than one table (creating a match
 * and its events, adding a session plus its roster rows) so a failure
 * can't leave half a record behind.
 */
export async function withTransaction(fn) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

/**
 * Applies schema.sql on startup. Every statement in that file is
 * written to be idempotent (CREATE TABLE IF NOT EXISTS and friends),
 * so this runs safely on every boot and there's no separate migration
 * step to forget before a deploy.
 */
export async function migrate() {
  const schema = await readFile(join(here, '..', 'schema.sql'), 'utf8')
  await pool.query(schema)
}
