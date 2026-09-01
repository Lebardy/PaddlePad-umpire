#!/usr/bin/env node
// ============================================================
// One command that stands up a whole disposable stack, runs the smoke
// test against it, and tears it down again.
//
//   pnpm --filter ./server test:e2e      (or: node scripts/e2e.mjs)
//
// This exists because the alternative was testing against production.
// The smoke test needs a real database and a real umpire account, and
// creating those on the live API means writing test rows next to real
// recorded play and then trusting a cleanup script to find them all
// again. A throwaway database is simply a better answer to that.
//
// What it does NOT cover, and is not meant to: anything about the
// deploy itself. Root directory, service variables, CORS origins and
// build differences are all invisible from here -- that class of bug
// only shows up on Railway, which is what a staging environment is for.
// Passing this is a necessary check before deploying, not a sufficient
// one.
// ============================================================

import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SERVER_DIR = path.resolve(HERE, '..')
const REPO_ROOT = path.resolve(SERVER_DIR, '..')
const COMPOSE_FILE = path.join(REPO_ROOT, 'docker-compose.test.yml')

// Must match docker-compose.test.yml. Port 5433 rather than 5432 so a
// system Postgres can never be mistaken for this one.
const TEST_DATABASE_URL =
  'postgres://paddlepad:paddlepad@127.0.0.1:5433/paddlepad_test'

// The API under test gets its own port so a `pnpm dev` server already
// running on 3000 doesn't get talked to by accident -- or worse, tested
// against and then reported as green.
const TEST_PORT = 3101
const TEST_API = `http://127.0.0.1:${TEST_PORT}`

// Test-only values. Both are fine in the repository: this stack is
// local, empty and thrown away, and nothing signed by this secret is
// ever accepted anywhere else.
const TEST_JWT_SECRET = 'e2e-only-secret-not-used-anywhere-else-0123456789abcdef'
const TEST_INVITE = 'E2EE-2EE2-E2E2'
// The shared key the ML service would use. Fixed here for the same
// reason as the JWT secret above: a test credential that is obviously a
// test credential cannot be mistaken for a real one if it leaks into a
// log or a screenshot.
const TEST_INTERNAL_KEY = 'e2e-only-internal-key-not-used-anywhere-else-0123456789'

/**
 * Refuses to touch anything that isn't the disposable test database.
 *
 * This script drops and recreates the public schema, which is
 * unrecoverable. The guard is the same principle as
 * cleanup-test-data.mjs: make the destructive path structurally unable
 * to reach real data, rather than relying on whoever runs it having
 * exported the right variable.
 */
function assertDisposable(url) {
  const parsed = new URL(url)
  const localHost = ['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname)
  const testDatabase = parsed.pathname === '/paddlepad_test'
  if (!localHost || !testDatabase) {
    console.error(
      `Refusing to reset ${parsed.hostname}${parsed.pathname}.\n` +
        'This script only ever runs against the local paddlepad_test database.',
    )
    process.exit(1)
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options })
  if (result.error) throw result.error
  return result.status ?? 1
}

/**
 * Brings the Postgres container up, waiting for its healthcheck.
 *
 * The two ways this fails on a fresh machine look nothing alike in the
 * output, so they are named separately -- "permission denied" in
 * particular reads like a bug in this script rather than the group
 * membership problem it actually is.
 */
function startDatabase() {
  console.log('› starting the test database')
  const probe = spawnSync('docker', ['info'], { encoding: 'utf8' })
  const trouble = `${probe.stderr ?? ''}${probe.stdout ?? ''}`

  if (probe.error?.code === 'ENOENT') {
    console.error('\nDocker is not installed, so there is nothing to start.')
    process.exit(1)
  }
  if (probe.status !== 0) {
    if (/permission denied/i.test(trouble)) {
      console.error(
        '\nThe Docker daemon is running but this user cannot reach its socket.\n' +
          'Add yourself to the docker group, then start a new login session:\n' +
          '  sudo usermod -aG docker "$USER"\n' +
          '\nWorth knowing before you do: membership in that group is\n' +
          'effectively root on this machine, since it can mount any path\n' +
          'into a container. Prefixing this command with sudo instead is\n' +
          'the narrower option.',
      )
    } else {
      console.error(
        '\nCould not reach the Docker daemon.\n' +
          'If it is not running: sudo systemctl start docker',
      )
    }
    process.exit(1)
  }

  const status = run('docker', [
    'compose',
    '-f',
    COMPOSE_FILE,
    'up',
    '-d',
    '--wait',
  ])
  if (status !== 0) {
    console.error('\nThe test database container failed to start.')
    process.exit(1)
  }
}

/**
 * Empties the database so every run starts from nothing.
 *
 * Determinism is the point. The bootstrap invite that lets the smoke
 * test register its umpire is only honoured while no umpires exist, so
 * a run against a leftover database would fail for a reason that has
 * nothing to do with the code under test. schema.sql is idempotent and
 * applied on boot, so dropping everything costs a second and removes a
 * whole category of confusing failure.
 */
async function resetSchema() {
  console.log('› resetting the schema')
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL })
  await client.connect()
  await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
  await client.end()
}

/** Starts the API and resolves once it reports healthy. */
async function startApi() {
  console.log('› starting the API')
  const api = spawn('node', ['src/index.js'], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      DATABASE_URL: TEST_DATABASE_URL,
      JWT_SECRET: TEST_JWT_SECRET,
      BOOTSTRAP_INVITE_CODE: TEST_INVITE,
      INTERNAL_API_KEY: TEST_INTERNAL_KEY,
      // The suite makes dozens of deliberately-failing sign-in and
      // registration attempts in a few seconds -- exactly the traffic
      // the limiter exists to stop. Safe here and nowhere else: this
      // stack is local, empty and thrown away.
      DANGEROUSLY_DISABLE_RATE_LIMITS: '1',
      CORS_ORIGIN: 'http://localhost:5173',
      PORT: String(TEST_PORT),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  // Kept rather than streamed: a passing run should be quiet, but a
  // failing one needs the server's side of the story.
  let output = ''
  api.stdout.on('data', (chunk) => (output += chunk))
  api.stderr.on('data', (chunk) => (output += chunk))

  let exited = false
  api.on('exit', () => (exited = true))

  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (exited) {
      console.error('\nThe API exited before it became healthy:\n')
      console.error(output)
      process.exit(1)
    }
    try {
      const response = await fetch(`${TEST_API}/health`)
      if (response.ok) return { api, dump: () => output }
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }

  api.kill('SIGKILL')
  console.error('\nThe API never became healthy within 30s:\n')
  console.error(output)
  process.exit(1)
}

async function main() {
  assertDisposable(TEST_DATABASE_URL)
  startDatabase()
  await resetSchema()
  const { api, dump } = await startApi()

  console.log('› running the smoke test\n')
  const status = run('node', [path.join(HERE, 'smoke.mjs'), TEST_API], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      SMOKE_INVITE: TEST_INVITE,
      SMOKE_INTERNAL_KEY: TEST_INTERNAL_KEY,
    },
  })

  api.kill('SIGTERM')

  if (status !== 0) {
    console.log('\n--- API output ---')
    console.log(dump())
  }

  // The container is left running on purpose: the next run reuses it
  // and resets the schema instead, which is the difference between a
  // two-second loop and a ten-second one. Stop it with:
  //   docker compose -f docker-compose.test.yml down -v
  console.log(
    status === 0
      ? '\n✓ e2e passed. The test database is still up for the next run.'
      : '\n✗ e2e failed.',
  )
  process.exit(status)
}

main().catch((error) => {
  console.error('\ne2e harness crashed:', error)
  process.exit(1)
})
