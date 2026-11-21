import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { GenericContainer, Wait } from 'testcontainers'

// Review finding on #8974: the existing `scripts/__tests__/init-or-migrate.test.mjs`
// substitutes an `echo` for the real CLI, and `packages/cli/src/__tests__/mercato.test.ts`
// mocks PostgreSQL, so neither exercises the actual `docker/scripts/init-or-migrate.sh`
// wrapper driving the real built `mercato` CLI against a real database. This suite does:
// a genuinely initialized disposable database, no marker, a missing production password,
// asserting successful migration recovery, marker recreation, and unchanged existing
// records; a negative case proving an unrelated startup failure still aborts; and a direct
// regression proving a rejected fresh production init never creates the target database.
//
// Opt-in (`OM_PG_INTEGRATION=1`) and requires the CLI to already be built
// (`yarn generate && yarn build:packages`) because it spawns the real `packages/cli/bin/mercato`
// binary, not an in-process/mocked call.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const cliBin = path.join(repoRoot, 'packages/cli/bin/mercato')
const wrapperScript = path.join(repoRoot, 'docker/scripts/init-or-migrate.sh')

const POSTGRES_INIT_SQL = `
\\connect template1
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
`

function runCommand(command, args, env, timeoutMs) {
  return spawnSync(command, args, { cwd: repoRoot, env, encoding: 'utf8', timeout: timeoutMs })
}

function baseEnv(databaseUrl, cacheSuffix, extra = {}) {
  return {
    ...process.env,
    DATABASE_URL: databaseUrl,
    NODE_ENV: 'production',
    CACHE_STRATEGY: 'sqlite',
    CACHE_SQLITE_PATH: path.join(os.tmpdir(), `om-8974-pg-integration-cache-${cacheSuffix}.sqlite`),
    JWT_SECRET: 'om-8974-pg-integration-fixture-jwt-secret',
    OM_SECURITY_MFA_SETUP_SECRET: 'om-8974-pg-integration-fixture-mfa-setup-secret',
    // Forms module refuses the dev-only KMS adapter under NODE_ENV=production.
    FORMS_ENCRYPTION_MASTER_KEY: '6f6d2d657068656d6572616c2d696e746567726174696f6e2d666f726d732d31',
    // Out of scope for this fixture: keep the encryption preflight/KMS machinery inert.
    TENANT_DATA_ENCRYPTION: 'off',
    OM_ENABLE_ENTERPRISE_MODULES: 'false',
    OM_ENABLE_ENTERPRISE_MODULES_SSO: 'false',
    OM_ENABLE_ENTERPRISE_MODULES_SECURITY: 'false',
    ...extra,
  }
}

async function queryUsers(databaseUrl) {
  const pg = await import('pg')
  const client = new pg.Client({ connectionString: databaseUrl })
  await client.connect()
  try {
    return (await client.query('SELECT id, email, created_at FROM users ORDER BY created_at')).rows
  } finally {
    await client.end()
  }
}

async function databaseExists(maintenanceUrl, dbName) {
  const pg = await import('pg')
  const client = new pg.Client({ connectionString: maintenanceUrl })
  await client.connect()
  try {
    const result = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName])
    return result.rows.length > 0
  } finally {
    await client.end()
  }
}

test(
  'real CLI + wrapper: an already-initialized database with a lost marker and a missing production password recovers, migrations re-apply cleanly, the marker is recreated, and existing user data is unchanged',
  { skip: process.env.OM_PG_INTEGRATION !== '1', timeout: 20 * 60_000 },
  async () => {
    const container = await new GenericContainer('pgvector/pgvector:pg16')
      .withEnvironment({ POSTGRES_PASSWORD: 'disposable-fixture', POSTGRES_DB: 'fixture' })
      .withCopyContentToContainer([
        { content: POSTGRES_INIT_SQL, target: '/docker-entrypoint-initdb.d/00-open-mercato-extensions.sql' },
      ])
      .withExposedPorts({ container: 5432, host: 0 })
      .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
      .withStartupTimeout(60_000)
      .start()

    try {
      const databaseUrl = `postgres://postgres:disposable-fixture@${container.getHost()}:${container.getMappedPort(5432)}/fixture`

      // Genuinely initialize the disposable database through the real CLI — full
      // generate + migrate + bootstrap + seed, exactly like a real first deployment.
      const seed = runCommand(
        'node',
        [cliBin, 'init', '--no-demo-users', '--no-examples', '--org=PgIntegrationFixture', '--email=owner@pg-integration-fixture.example'],
        baseEnv(databaseUrl, 'seed', { OM_INIT_SUPERADMIN_PASSWORD: 'Om-Pg-Integration-Fixture-937!' }),
        15 * 60_000,
      )
      assert.equal(seed.status, 0, `seed init failed:\n${seed.stdout}\n${seed.stderr}`)

      const usersBeforeRecovery = await queryUsers(databaseUrl)
      assert.equal(usersBeforeRecovery.length, 1)

      // Simulate a redeploy that lost the init marker and carries a missing production
      // superadmin password — the #8932/#8974 restart-recovery scenario the review asked
      // to see exercised at the real CLI/wrapper boundary.
      const markerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'om-8974-marker-'))
      const markerFile = path.join(markerDir, '.seeded')
      const wrapperEnv = baseEnv(databaseUrl, 'recovery', {
        INIT_MARKER_FILE: markerFile,
        INIT_COMMAND: `node ${cliBin} init`,
        MIGRATE_COMMAND: `node ${cliBin} db migrate`,
        SYNC_ROLE_ACLS_COMMAND: `node ${cliBin} auth sync-role-acls`,
      })
      delete wrapperEnv.OM_INIT_SUPERADMIN_PASSWORD

      try {
        const recovery = runCommand('sh', [wrapperScript], wrapperEnv, 10 * 60_000)
        assert.equal(recovery.status, 0, `wrapper recovery failed:\n${recovery.stdout}\n${recovery.stderr}`)
        assert.match(recovery.stdout, /Initialization aborted: found 1 existing user/)
        assert.match(recovery.stdout, /Initialization reported existing users; treating database as already initialized/)
        assert.doesNotMatch(recovery.stdout + recovery.stderr, /superadmin password/)
        assert.ok(fs.existsSync(markerFile), 'wrapper did not recreate the init marker')

        const usersAfterRecovery = await queryUsers(databaseUrl)
        assert.deepEqual(usersAfterRecovery, usersBeforeRecovery)
      } finally {
        fs.rmSync(markerDir, { recursive: true, force: true })
      }
    } finally {
      await container.stop()
    }
  },
)

test(
  'real CLI + wrapper: an unrelated startup failure still aborts without recreating the marker',
  { skip: process.env.OM_PG_INTEGRATION !== '1', timeout: 60_000 },
  async () => {
    const markerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'om-8974-marker-negative-'))
    const markerFile = path.join(markerDir, '.seeded')
    try {
      // An unreachable DATABASE_URL fails for a reason unrelated to "existing users" —
      // the encryption preflight that gates every setup command cannot verify
      // compatibility and refuses to run anything, so the wrapper must abort rather
      // than treat this as a recoverable restart.
      const wrapperEnv = baseEnv('postgres://postgres@127.0.0.1:1/om-8974-unreachable-fixture', 'negative', {
        INIT_MARKER_FILE: markerFile,
        INIT_COMMAND: `node ${cliBin} init`,
        MIGRATE_COMMAND: `node ${cliBin} db migrate`,
        SYNC_ROLE_ACLS_COMMAND: `node ${cliBin} auth sync-role-acls`,
      })
      const result = runCommand('sh', [wrapperScript], wrapperEnv, 60_000)
      assert.notEqual(result.status, 0, `expected the wrapper to abort, got:\n${result.stdout}\n${result.stderr}`)
      assert.equal(fs.existsSync(markerFile), false)
    } finally {
      fs.rmSync(markerDir, { recursive: true, force: true })
    }
  },
)

test(
  'real CLI: a rejected fresh production init never creates the target database (#8974)',
  { skip: process.env.OM_PG_INTEGRATION !== '1', timeout: 60_000 },
  async () => {
    const container = await new GenericContainer('pgvector/pgvector:pg16')
      .withEnvironment({ POSTGRES_PASSWORD: 'disposable-fixture', POSTGRES_DB: 'fixture' })
      .withExposedPorts({ container: 5432, host: 0 })
      .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
      .withStartupTimeout(60_000)
      .start()

    try {
      const host = container.getHost()
      const port = container.getMappedPort(5432)
      const maintenanceUrl = `postgres://postgres:disposable-fixture@${host}:${port}/fixture`
      const freshDbName = 'om_8974_rejected_fresh_init'
      const freshDatabaseUrl = `postgres://postgres:disposable-fixture@${host}:${port}/${freshDbName}`

      assert.equal(await databaseExists(maintenanceUrl, freshDbName), false)

      const result = runCommand(
        'node',
        [cliBin, 'init'],
        baseEnv(freshDatabaseUrl, 'fresh-reject', { OM_INIT_SUPERADMIN_PASSWORD: 'changeme' }),
        60_000,
      )

      assert.notEqual(result.status, 0, `expected the rejected fresh init to fail, got:\n${result.stdout}\n${result.stderr}`)
      assert.match(result.stdout + result.stderr, /superadmin password/)
      assert.equal(
        await databaseExists(maintenanceUrl, freshDbName),
        false,
        'a rejected fresh production init must not persist a new database',
      )
    } finally {
      await container.stop()
    }
  },
)
