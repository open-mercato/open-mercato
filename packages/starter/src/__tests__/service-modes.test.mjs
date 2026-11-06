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
    withExposedPorts(port) { this.port = port; this.hostConfig = { PortBindings: { [`${port}/tcp`]: [{ HostPort: '0' }] } }; return this }
    withCommand(command) { this.command = command; return this }
    withHealthCheck(health) { this.health = health; return this }
    withWaitStrategy() { return this }
    async start() {
      if (started.length === failAt) throw new Error('simulated startup failure')
      await this.beforeContainerCreated?.()
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
    assert.equal(settings.POSTGRES_USER, 'mercato')
    assert.match(settings.POSTGRES_PASSWORD, /^[a-f0-9]{48}$/)
    assert.notEqual(settings.POSTGRES_PASSWORD, 'p$&')
    assert.equal(decodeURIComponent(new URL(settings.DATABASE_URL).password), settings.POSTGRES_PASSWORD)
    assert.equal(resolveStackPorts(dir, {}).postgres, Number(settings.POSTGRES_PORT))
    assert.equal(new URL(readEnvValue(path.join(app, '.env'), 'DATABASE_URL')).port, settings.POSTGRES_PORT)
    assert.match(settings.MEILISEARCH_API_KEY, /^[a-f0-9]{48}$/)
    assert.notEqual(settings.MEILISEARCH_API_KEY, 'root-key')
    assert.equal(new URL(settings.MEILISEARCH_HOST).protocol, 'http:')
    for (const key of ['REDIS_URL', 'CACHE_REDIS_URL', 'QUEUE_REDIS_URL', 'EVENTS_REDIS_URL', 'DOCUMENTS_COLLAB_REDIS_URL']) {
      const url = new URL(settings[key]); assert.equal(url.port, settings.REDIS_PORT); assert.equal(url.protocol, 'redis:'); assert.equal(url.username, ''); assert.equal(url.password, settings.REDIS_PASSWORD)
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
    assert.deepEqual(mock.started[0].environment, { POSTGRES_USER: 'mercato', POSTGRES_PASSWORD: env.POSTGRES_PASSWORD, POSTGRES_DB: 'open_mercato_local' })
    assert.notEqual(env.POSTGRES_PASSWORD, 'p')
    assert.ok(mock.started.every(item => Object.values(item.hostConfig.PortBindings).flat().every(binding => binding.HostIp === '127.0.0.1')))
    assert.ok(mock.started.every(item => /@sha256:[a-f0-9]{64}$/.test(item.image)))
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
    assert.equal(url.username, 'mercato')
    assert.equal(url.password, env.POSTGRES_PASSWORD)
    assert.notEqual(url.password, 'local_password')
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

test('ephemeral cleanup restores its endpoints when the dev runner persists a database-name override', async () => {
  const dir = fixture(); const mock = containers()
  try {
    const file = path.join(dir, '.env')
    fs.writeFileSync(file, 'DATABASE_URL="postgres://old_user:old_password@existing.example:6543/old_db?sslmode=require"\nOTHER=kept\n')
    const env = {}
    const result = await configureServiceMode({ mode: 'ephemeral', projectDir: dir, env, loadTestcontainers: mock.loader, log: silent })
    const selected = new URL(env.DATABASE_URL); selected.pathname = '/chosen_db'
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^DATABASE_URL=.*$/m, `DATABASE_URL=${selected.toString()}`) + 'LATER=kept\n')
    await result.cleanup()
    const restored = parseEnv(fs.readFileSync(file, 'utf8')); const url = new URL(restored.DATABASE_URL)
    assert.equal(url.hostname, 'existing.example'); assert.equal(url.port, '6543')
    assert.equal(url.username, 'old_user'); assert.equal(url.password, 'old_password')
    assert.equal(url.pathname, '/chosen_db'); assert.equal(url.search, '?sslmode=require')
    assert.equal(restored.OTHER, 'kept'); assert.equal(restored.LATER, 'kept')
    assert.equal(mock.stopped.length, 3)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('database-name cleanup preserves literal replacement tokens in original credentials', async () => {
  const dir = fixture(); const mock = containers()
  try {
    const file = path.join(dir, '.env')
    fs.writeFileSync(file, 'DATABASE_URL=postgres://u:p$&@remote.example/old_db\n')
    const env = {}
    const result = await configureServiceMode({ mode: 'ephemeral', projectDir: dir, env, loadTestcontainers: mock.loader, log: silent })
    const selected = new URL(env.DATABASE_URL); selected.pathname = '/chosen_db'
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^DATABASE_URL=.*$/m, () => `DATABASE_URL=${selected.toString()}`))
    await result.cleanup()
    assert.equal(parseEnv(fs.readFileSync(file, 'utf8')).DATABASE_URL, 'postgres://u:p$&@remote.example/chosen_db')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('random mode keeps owned local credentials across reruns despite ambient remote credentials', async () => {
  const dir = fixture()
  try {
    const remote = { DATABASE_URL: 'postgres://production_user:production_secret@production.example/private', POSTGRES_PASSWORD: 'production_secret', MEILISEARCH_API_KEY: 'production_meili_secret', REDIS_URL: 'rediss://:production_redis_secret@production.example:6379/2', INFRA_BIND_HOST: '0.0.0.0' }
    fs.writeFileSync(path.join(dir, '.env'), Object.entries(remote).map(([key, value]) => `${key}=${value}`).join('\n'))
    let port = 30000
    const first = { ...remote }
    await configureServiceMode({ mode: 'random', projectDir: dir, env: first, getPort: async () => ++port, log: silent })
    const saved = parseEnv(fs.readFileSync(path.join(dir, '.env'), 'utf8'))
    for (const key of ['POSTGRES_PASSWORD', 'REDIS_PASSWORD', 'MEILISEARCH_API_KEY']) {
      assert.match(first[key], /^[a-f0-9]{48}$/)
      assert.ok(!Object.values(remote).includes(first[key]))
    }
    assert.equal(first.INFRA_BIND_HOST, '127.0.0.1')
    assert.equal(new URL(first.REDIS_URL).password, first.REDIS_PASSWORD)
    assert.equal(saved.OM_SETUP_LOCAL_POSTGRES_PASSWORD, first.POSTGRES_PASSWORD)
    const second = { ...remote }
    await configureServiceMode({ mode: 'random', projectDir: dir, env: second, getPort: async () => ++port, log: silent })
    for (const key of ['POSTGRES_PASSWORD', 'REDIS_PASSWORD', 'MEILISEARCH_API_KEY', 'MERCATO_STACK', 'COMPOSE_PROJECT_NAME']) assert.equal(second[key], first[key])
    assert.equal(new URL(second.DATABASE_URL).hostname, '127.0.0.1')
    assert.equal(new URL(second.DATABASE_URL).password, first.POSTGRES_PASSWORD)
    assert.equal(fs.statSync(path.join(dir, '.env')).mode & 0o777, 0o600)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('ephemeral sessions generate independent credentials and pin every application image', async () => {
  const dir = fixture(); const mocks = [containers(), containers()]
  try {
    const remote = 'DATABASE_URL=postgres://remote_user:remote_secret@remote.example/private\nMEILISEARCH_API_KEY=remote_meili_secret\n'
    fs.writeFileSync(path.join(dir, '.env'), remote)
    const passwords = []
    for (const mock of mocks) {
      const env = {}
      const session = await configureServiceMode({ mode: 'ephemeral', projectDir: dir, env, loadTestcontainers: mock.loader, log: silent })
      passwords.push(env.POSTGRES_PASSWORD)
      assert.ok(mock.started.every(item => /@sha256:[a-f0-9]{64}$/.test(item.image)))
      assert.equal(mock.started[1].command[2], env.REDIS_PASSWORD)
      assert.equal(mock.started[1].environment.REDISCLI_AUTH, env.REDIS_PASSWORD)
      assert.notEqual(env.POSTGRES_PASSWORD, 'remote_secret')
      assert.notEqual(env.MEILISEARCH_API_KEY, 'remote_meili_secret')
      await session.cleanup()
      assert.equal(fs.readFileSync(path.join(dir, '.env'), 'utf8'), remote)
    }
    assert.notEqual(passwords[0], passwords[1])
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('owned random stacks retain a persisted database-name choice on later isolated reruns', async () => {
  const dir = fixture()
  try {
    fs.writeFileSync(path.join(dir, '.env'), 'DATABASE_URL=postgres://remote:secret@remote.example/private\n')
    let port = 31000; const env = {}
    await configureServiceMode({ mode: 'random', projectDir: dir, env, getPort: async () => ++port, log: silent })
    const selected = new URL(env.DATABASE_URL); selected.pathname = '/chosen_local_db'
    const file = path.join(dir, '.env')
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^DATABASE_URL=.*$/m, () => `DATABASE_URL=${selected}`))
    const rerun = { DATABASE_URL: 'postgres://production:production_secret@production.example/private' }
    await configureServiceMode({ mode: 'random', projectDir: dir, env: rerun, getPort: async () => ++port, log: silent })
    assert.equal(new URL(rerun.DATABASE_URL).pathname, '/chosen_local_db')
    assert.equal(rerun.POSTGRES_DB, 'chosen_local_db')
    assert.equal(rerun.POSTGRES_PASSWORD, env.POSTGRES_PASSWORD)
    assert.equal(new URL(rerun.DATABASE_URL).hostname, '127.0.0.1')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
