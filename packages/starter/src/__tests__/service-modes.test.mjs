import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseEnv } from 'node:util'
import { readEnvValue } from '../env-file.mjs'
import { resolveStackPorts } from '../constants.mjs'
import test from 'node:test'
import { configureServiceMode, resolveServiceMode, chooseServiceMode } from '../service-modes.mjs'

const fixture = () => fs.mkdtempSync(path.join(os.tmpdir(), 'om-service-modes-'))
const silent = () => {}
function containers({ failAt = -1, interruptAt = -1 } = {}) {
  const started = []
  const stopped = []
  class GenericContainer {
    constructor(image) { this.image = image }
    withEnvironment(environment) { this.environment = environment; return this }
    withExposedPorts(port) { this.port = port; return this }
    withHealthCheck(health) { this.health = health; return this }
    withWaitStrategy() { return this }
    async start() {
      if (started.length === failAt) throw new Error('simulated startup failure')
      started.push(this)
      if (started.length - 1 === interruptAt) process.emit('SIGINT')
      return this
    }
    getHost() { return '127.0.0.1' }
    getMappedPort() { return this.port + 20000 }
    async stop() { stopped.push(this) }
  }
  return { started, stopped, loader: async () => ({ GenericContainer, Wait: { forHealthCheck() {} } }) }
}

test('reuse is the default and conflicting service flags fail', async () => {
  assert.equal(resolveServiceMode([]), 'reuse')
  assert.equal(resolveServiceMode(['--no-infra']), 'reuse')
  assert.equal(await chooseServiceMode({ argv: [], input: {}, output: {} }), 'reuse')
  assert.throws(() => resolveServiceMode(['--ephemeral', '--random-ports']), /Choose only one/)
})

test('reuse leaves config and env byte-identical and does not load Testcontainers', async () => {
  const dir = fixture()
  try {
    const original = 'DATABASE_URL=postgres://u:p@remote.example:5432/db?sslmode=require\n'
    fs.writeFileSync(path.join(dir, '.env'), original)
    const env = { DATABASE_URL: original.split('=')[1] }
    const copy = { ...env }
    await configureServiceMode({ mode: 'reuse', projectDir: dir, env, loadTestcontainers() { assert.fail('must not load') } })
    assert.equal(fs.readFileSync(path.join(dir, '.env'), 'utf8'), original)
    assert.deepEqual(env, copy)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('random mode synchronizes both env files, all Redis consumers, credentials and isolated project identity', async () => {
  const dir = fixture()
  try {
    const app = path.join(dir, 'apps', 'mercato'); fs.mkdirSync(app, { recursive: true })
    const rootEnv = path.join(dir, '.env')
    fs.writeFileSync(rootEnv, 'MEILISEARCH_MASTER_KEY=root-key\n')
    fs.writeFileSync(path.join(app, '.env'), 'DATABASE_URL=postgres://owner:p%24%26@remote:5432/db?sslmode=require\nREDIS_URL=rediss://user:secret@remote:6379/2\nDOCUMENTS_COLLAB_REDIS_URL=redis://remote:6380/3\nMEILISEARCH_HOST=https://remote:7700\n')
    const env = {}; let port = 20000
    const result = await configureServiceMode({ mode: 'random', projectDir: app, envFiles: [rootEnv], env, getPort: async () => ++port, log: silent })
    assert.equal(result.noInfra, false)
    assert.equal(result.cleanup, undefined)
    const settings = parseEnv(fs.readFileSync(path.join(app, '.env'), 'utf8'))
    assert.deepEqual({ ...parseEnv(fs.readFileSync(rootEnv, 'utf8')) }, { ...settings })
    assert.equal(new URL(settings.DATABASE_URL).port, settings.POSTGRES_PORT)
    assert.equal(new URL(settings.DATABASE_URL).search, '')
    assert.equal(settings.POSTGRES_USER, 'owner')
    assert.match(settings.POSTGRES_PASSWORD, /^local_[a-f0-9]+$/)
    assert.equal(decodeURIComponent(new URL(settings.DATABASE_URL).password), settings.POSTGRES_PASSWORD)
    assert.equal(resolveStackPorts(dir, {}).postgres, Number(settings.POSTGRES_PORT))
    assert.equal(new URL(readEnvValue(path.join(app, '.env'), 'DATABASE_URL')).port, settings.POSTGRES_PORT)
    assert.equal(settings.MEILISEARCH_API_KEY, 'root-key')
    assert.equal(new URL(settings.MEILISEARCH_HOST).protocol, 'http:')
    for (const key of ['REDIS_URL', 'CACHE_REDIS_URL', 'QUEUE_REDIS_URL', 'EVENTS_REDIS_URL', 'DOCUMENTS_COLLAB_REDIS_URL']) {
      const url = new URL(settings[key]); assert.equal(url.port, settings.REDIS_PORT); assert.equal(url.protocol, 'redis:'); assert.equal(url.username, ''); assert.equal(url.password, '')
    }
    assert.equal(settings.MERCATO_STACK, settings.COMPOSE_PROJECT_NAME)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('random mode rolls back earlier config writes if another env file cannot be written', async () => {
  const dir = fixture()
  try {
    const file = path.join(dir, '.env'); const original = 'DATABASE_URL=postgres://user:pw@remote/db\n'; fs.writeFileSync(file, original)
    const blocker = path.join(dir, 'read-only'); fs.mkdirSync(blocker); fs.writeFileSync(path.join(blocker, '.env'), 'UNRELATED=kept\n'); fs.chmodSync(blocker, 0o500)
    const env = {}; let port = 30000
    await assert.rejects(configureServiceMode({ mode: 'random', projectDir: dir, envFiles: [path.join(blocker, '.env')], env, getPort: async () => ++port, log: silent }))
    assert.equal(fs.readFileSync(file, 'utf8'), original)
    assert.deepEqual(env, {})
  } finally { fs.chmodSync(path.join(dir, 'read-only'), 0o700); fs.rmSync(dir, { recursive: true, force: true }) }
})

test('ephemeral services use mapped endpoints and restore original settings without clobbering later edits', async () => {
  const dir = fixture(); const mock = containers()
  try {
    const file = path.join(dir, '.env'); fs.writeFileSync(file, 'DATABASE_URL=postgres://u:p@remote/db\nUNRELATED=kept\n')
    const env = { DATABASE_URL: 'postgres://u:p@remote/db' }
    const result = await configureServiceMode({ mode: 'ephemeral', projectDir: dir, env, loadTestcontainers: mock.loader, log: silent })
    assert.equal(result.noInfra, true)
    assert.equal(new URL(env.DATABASE_URL).port, '25432')
    assert.equal(mock.started.length, 3)
    assert.deepEqual(mock.started[0].environment, { POSTGRES_USER: 'u', POSTGRES_PASSWORD: 'p', POSTGRES_DB: 'db' })
    fs.appendFileSync(file, 'LATER=value\n')
    await result.cleanup(); await result.cleanup()
    assert.equal(mock.stopped.length, 3)
    assert.equal(env.DATABASE_URL, 'postgres://u:p@remote/db')
    assert.equal(env.REDIS_URL, undefined)
    const restored = parseEnv(fs.readFileSync(file, 'utf8'))
    assert.deepEqual({ ...restored }, { DATABASE_URL: 'postgres://u:p@remote/db', UNRELATED: 'kept', LATER: 'value' })
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

for (const options of [{ failAt: 1 }, { interruptAt: 1 }]) {
  test(`ephemeral startup cleans its services after ${options.failAt ? 'failure' : 'interrupt'}`, async () => {
    const dir = fixture(); const mock = containers(options)
    try {
      const original = 'DATABASE_URL=postgres://u:p@remote/db\n'; fs.writeFileSync(path.join(dir, '.env'), original)
      await assert.rejects(configureServiceMode({ mode: 'ephemeral', projectDir: dir, env: {}, loadTestcontainers: mock.loader, log: silent }))
      assert.equal(mock.stopped.length, mock.started.length)
      assert.equal(fs.readFileSync(path.join(dir, '.env'), 'utf8'), original)
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })
}

test('shared service helper is mirrored byte-for-byte into the standalone template', () => {
  assert.deepEqual(fs.readFileSync(new URL('../service-modes.mjs', import.meta.url)), fs.readFileSync(new URL('../../../create-app/template/scripts/dev-service-modes.mjs', import.meta.url)))
})


test('isolated database endpoints discard all remote connection overrides and synchronize fallback credentials', async () => {
  const dir = fixture()
  try {
    fs.writeFileSync(path.join(dir, '.env'), 'DATABASE_URL=postgres://remote/db?host=remote.example&port=5439&user=old&password=old&dbname=remote&sslmode=require\nPOSTGRES_USER=local_user\nPOSTGRES_PASSWORD=local_password\n')
    const env = {}; let port = 23000
    await configureServiceMode({ mode: 'random', projectDir: dir, env, getPort: async () => ++port, log: silent })
    const url = new URL(env.DATABASE_URL)
    assert.equal(url.hostname, '127.0.0.1')
    assert.equal(url.search, '')
    assert.equal(url.username, 'local_user')
    assert.equal(url.password, 'local_password')
    assert.equal(url.port, env.POSTGRES_PORT)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('ephemeral cleanup restores raw apostrophe and multiline assignments while preserving unrelated later edits', async () => {
  const dir = fixture()
  try {
    const file = path.join(dir, '.env')
    const original = `DATABASE_URL=postgres://u:p@remote/db\nPOSTGRES_PASSWORD="a'b"\nMEILISEARCH_API_KEY="multi\nline"\n`
    fs.writeFileSync(file, original)
    const result = await configureServiceMode({ mode: 'ephemeral', projectDir: dir, env: {}, services: [], loadTestcontainers: async () => ({}), log: silent })
    fs.appendFileSync(file, 'LATER=keep\n')
    await result.cleanup()
    assert.deepEqual({ ...parseEnv(fs.readFileSync(file, 'utf8')) }, { ...parseEnv(original), LATER: 'keep' })
    assert.match(fs.readFileSync(file, 'utf8'), /POSTGRES_PASSWORD="a'b"/)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('cleanup restores other files and process settings after a filesystem failure and can retry', async () => {
  const dir = fixture(); const mock = containers()
  const file = path.join(dir, '.env'); const other = path.join(dir, 'compose.env')
  try {
    const original = 'DATABASE_URL=postgres://u:p@remote/db\n'
    fs.writeFileSync(file, original); fs.writeFileSync(other, 'KEEP=value\n')
    const env = { DATABASE_URL: 'postgres://u:p@remote/db' }
    const result = await configureServiceMode({ mode: 'ephemeral', projectDir: dir, envFiles: [other], env, loadTestcontainers: mock.loader, log: silent })
    fs.appendFileSync(file, 'LATER=keep\n'); fs.chmodSync(file, 0o400)
    await assert.rejects(result.cleanup(), /Could not fully restore/)
    assert.equal(fs.readFileSync(other, 'utf8'), 'KEEP=value\n')
    assert.equal(env.DATABASE_URL, 'postgres://u:p@remote/db')
    assert.equal(mock.stopped.length, 3)
    fs.chmodSync(file, 0o600); await result.cleanup()
    assert.deepEqual({ ...parseEnv(fs.readFileSync(file, 'utf8')) }, { DATABASE_URL: 'postgres://u:p@remote/db', LATER: 'keep' })
    assert.equal(mock.stopped.length, 3)
  } finally { if (fs.existsSync(file)) fs.chmodSync(file, 0o600); fs.rmSync(dir, { recursive: true, force: true }) }
})

test('normalized local database identifiers fit the PostgreSQL identifier limit', async () => {
  const dir = fixture()
  try {
    fs.writeFileSync(path.join(dir, '.env'), 'DATABASE_URL=postgres://user%40remote:password@remote/database%40remote\n')
    const env = {}; let port = 24000
    await configureServiceMode({ mode: 'random', projectDir: dir, env, getPort: async () => ++port, log: silent })
    assert.ok(Buffer.byteLength(env.POSTGRES_USER) <= 63)
    assert.ok(Buffer.byteLength(env.POSTGRES_DB) <= 63)
    assert.equal(decodeURIComponent(new URL(env.DATABASE_URL).username), env.POSTGRES_USER)
    assert.equal(decodeURIComponent(new URL(env.DATABASE_URL).pathname.slice(1)), env.POSTGRES_DB)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
