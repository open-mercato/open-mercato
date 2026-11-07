import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createEphemeralDatabaseGuard } from '../../packages/cli/src/lib/testing/ephemeral-database-guard.ts'

const require = createRequire(import.meta.url)
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const docker = (args) => execFileSync('docker', args, { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const dockerAvailable = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], { timeout: 5000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).status === 0

test('strict Turbo initialization uses only its proved disposable database (#8808)', { skip: !dockerAvailable && 'Docker is required for two owned database fixtures', timeout: 90000 }, async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'om-init-isolation-'))
  const appDirectory = path.join(directory, 'apps', 'fixture')
  const suffix = randomUUID().replaceAll('-', '')
  const containerName = `om-init-guard-${suffix}`
  const password = randomUUID()
  const ownedDatabase = `owned_${suffix}`
  const controlDatabase = `control_${suffix}`
  let containerId
  let ownedClient
  let controlClient
  try {
    containerId = docker(['run', '--rm', '-d', '--name', containerName, '-e', `POSTGRES_PASSWORD=${password}`, '-e', `POSTGRES_DB=${ownedDatabase}`, '-p', '127.0.0.1::5432', 'postgres:16'])
    const startedAt = Date.now()
    while (spawnSync('docker', ['exec', containerId, 'pg_isready', '-U', 'postgres', '-d', ownedDatabase], { timeout: 5000, stdio: 'ignore' }).status !== 0) {
      assert.ok(Date.now() - startedAt < 45000, 'Owned PostgreSQL fixture becomes ready')
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    docker(['exec', containerId, 'createdb', '-U', 'postgres', controlDatabase])
    const publishedPort = docker(['port', containerId, '5432/tcp']).split(':').at(-1)
    assert.match(publishedPort, /^\d+$/)
    const ownedUrl = `postgresql://postgres:${password}@127.0.0.1:${publishedPort}/${ownedDatabase}`
    const controlUrl = `postgresql://postgres:${password}@127.0.0.1:${publishedPort}/${controlDatabase}`
    const { Client } = await import('pg')
    ownedClient = new Client({ connectionString: ownedUrl })
    controlClient = new Client({ connectionString: controlUrl })
    await ownedClient.connect()
    await controlClient.connect()
    await ownedClient.query('CREATE TABLE sentinel (value text NOT NULL)')
    await ownedClient.query('INSERT INTO sentinel VALUES ($1)', [suffix])
    await controlClient.query('CREATE TABLE sentinel (value text NOT NULL)')
    await controlClient.query('INSERT INTO sentinel VALUES ($1)', [suffix])
    const proofPath = await createEphemeralDatabaseGuard(ownedUrl, ownedDatabase, path.join(directory, 'proof'))

    mkdirSync(appDirectory, { recursive: true })
    writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name: 'isolation-fixture', private: true, packageManager: 'npm@10.8.1', workspaces: ['apps/*'] }))
    writeFileSync(path.join(directory, 'package-lock.json'), JSON.stringify({ name: 'isolation-fixture', lockfileVersion: 3, packages: { '': { name: 'isolation-fixture', workspaces: ['apps/*'] }, 'apps/fixture': { name: '@open-mercato/app', version: '0.0.0' } } }))
    writeFileSync(path.join(appDirectory, 'package.json'), JSON.stringify({ name: '@open-mercato/app', version: '0.0.0', private: true, type: 'module', scripts: { initialize: 'node initialize.mjs' } }))
    writeFileSync(path.join(appDirectory, '.env'), `DATABASE_URL=${controlUrl}\n`, { mode: 0o600 })
    const helperUrl = pathToFileURL(path.join(repositoryRoot, 'packages/cli/src/lib/testing/ephemeral-database-guard.ts')).href
    const dotenvUrl = pathToFileURL(require.resolve('dotenv')).href
    const pgUrl = pathToFileURL(require.resolve('pg')).href
    writeFileSync(path.join(appDirectory, 'initialize.mjs'), `
import { readEphemeralDatabaseGuard, assertEphemeralDatabaseConnection, assertEphemeralDatabaseOwnership } from ${JSON.stringify(helperUrl)};
import dotenv from ${JSON.stringify(dotenvUrl)};
import pg from ${JSON.stringify(pgUrl)};
dotenv.config({ path: '.env', quiet: true });
const guard = readEphemeralDatabaseGuard(process.argv.slice(2));
if (!guard) throw new Error('Owned fixture requires its database guard argument');
assertEphemeralDatabaseConnection(guard, process.env.DATABASE_URL);
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  await assertEphemeralDatabaseOwnership(guard, client);
  await client.query('DROP TABLE sentinel');
  await client.query('CREATE TABLE initialized (id integer)');
} finally { await client.end(); }
`)
    const sourceConfiguration = JSON.parse(readFileSync(process.env.OM_TEST_BASE_TURBO_CONFIG ?? path.join(repositoryRoot, 'turbo.json'), 'utf8'))
    const configure = (task) => writeFileSync(path.join(directory, 'turbo.json'), JSON.stringify({ $schema: 'https://turbo.build/schema.json', tasks: { initialize: task } }))
    const invoke = (environment, args = [`--ephemeral-database-guard=${proofPath}`]) => spawnSync(path.join(repositoryRoot, 'node_modules/.bin/turbo'), ['run', 'initialize', '--filter=@open-mercato/app', '--env-mode=strict', '--', ...args], { cwd: directory, env: { ...process.env, TURBO_TELEMETRY_DISABLED: '1', ...environment }, encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] })
    const assertSentinels = async () => {
      assert.deepEqual((await ownedClient.query('SELECT value FROM sentinel')).rows, [{ value: suffix }])
      assert.deepEqual((await controlClient.query('SELECT value FROM sentinel')).rows, [{ value: suffix }])
    }

    configure({ ...sourceConfiguration.tasks.initialize, passThroughEnv: [] })
    assert.notEqual(invoke({ DATABASE_URL: ownedUrl }).status, 0, 'Stripped environment must refuse the dotenv fallback')
    await assertSentinels()
    configure(sourceConfiguration.tasks.initialize)
    assert.notEqual(invoke({ DATABASE_URL: controlUrl }).status, 0, 'Mismatched effective target must be refused')
    await assertSentinels()
    assert.notEqual(invoke({ DATABASE_URL: ownedUrl }, ['--ephemeral-database-guard']).status, 0, 'Missing ownership proof must be refused')
    await assertSentinels()
    await ownedClient.query(`COMMENT ON DATABASE "${ownedDatabase}" IS 'not-the-owned-marker'`)
    assert.notEqual(invoke({ DATABASE_URL: ownedUrl }).status, 0, 'Wrong connected ownership marker must be refused')
    await assertSentinels()
    const refreshedProof = await createEphemeralDatabaseGuard(ownedUrl, ownedDatabase, path.join(directory, 'proof'))
    const success = invoke({ DATABASE_URL: ownedUrl }, [`--ephemeral-database-guard=${refreshedProof}`])
    assert.equal(success.status, 0, `Correctly forwarded and proved owned initialization exits successfully: ${success.stderr.replaceAll(password, '[redacted]')}`)
    assert.equal((await ownedClient.query("SELECT to_regclass('public.initialized') AS initialized")).rows[0].initialized, 'initialized')
    assert.equal((await ownedClient.query("SELECT to_regclass('public.sentinel') AS sentinel")).rows[0].sentinel, null)
    assert.deepEqual((await controlClient.query('SELECT value FROM sentinel')).rows, [{ value: suffix }])
  } finally {
    await ownedClient?.end()
    await controlClient?.end()
    if (containerId) docker(['rm', '-f', containerId])
    rmSync(directory, { recursive: true, force: true })
  }
})
