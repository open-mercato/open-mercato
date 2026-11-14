import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { verifyServiceConnections, ServiceConnectionError } from '../service-connections.mjs'
import { serviceConnectionsStep, runSteps } from '../steps.mjs'

const databaseUrl = 'postgres://fixture:db-secret@127.0.0.1:5432/fixture?application_name=query-secret'
const env = { DATABASE_URL: databaseUrl, REDIS_URL: 'redis://:redis-secret@127.0.0.1:6379/2', QUEUE_REDIS_URL: 'redis://:queue-secret@127.0.0.1:6380/3', MEILISEARCH_HOST: 'http://127.0.0.1:7700', MEILISEARCH_API_KEY: 'meili-secret' }

function clients({ postgresFailure, redisFailure, redisError = 'WRONGPASS redis-secret queue-secret', queryFailure, neverConnect = false } = {}) {
  const calls = []
  const closed = []
  class Client {
    constructor(options) { calls.push(['postgres-options', options]) }
    async connect() { if (neverConnect) return new Promise(() => {}); if (postgresFailure) throw postgresFailure }
    async query(sql) { calls.push(['query', sql]); if (queryFailure) throw queryFailure; return { rows: [{ value: 1 }] } }
    async end() { closed.push('postgres') }
  }
  class Redis {
    constructor(url, options) { this.url = url; calls.push(['redis-options', url, options]) }
    on(_event, handler) { this.onError = handler }
    async connect() { if (redisFailure?.(this.url)) throw new Error(redisError) }
    async ping() { calls.push(['ping', this.url]); return 'PONG' }
    disconnect() { closed.push(this.url) }
  }
  return { calls, closed, loadModule: async (_root, name) => name === 'pg' ? { Client } : Redis }
}

function options(mock, overrides = {}) {
  return { projectDir: '/missing-fixture', env, loadModule: mock.loadModule, log: () => {}, fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ results: [] }), body: { cancel: async () => {} } }), ...overrides }
}

function redacted(error) {
  for (const secret of ['db-secret', 'query-secret', 'redis-secret', 'queue-secret', 'meili-secret']) assert.ok(!error.message.includes(secret), error.message)
  return true
}

test('verifies PostgreSQL query, every configured Redis consumer and a protected Meilisearch API', async () => {
  const mock = clients()
  let responseClosed = false
  const result = await verifyServiceConnections(options(mock, { fetchImpl: async (url, request) => {
    assert.equal(url.pathname, '/indexes')
    assert.equal(request.headers.Authorization, 'Bearer meili-secret')
    assert.ok(request.signal)
    return { ok: true, status: 200, json: async () => ({ results: [] }), body: { cancel: async () => { responseClosed = true } } }
  } }))
  assert.deepEqual(result.checked, ['DATABASE_URL', 'REDIS_URL', 'QUEUE_REDIS_URL', 'MEILISEARCH_HOST'])
  assert.deepEqual(mock.calls.filter(([kind]) => kind === 'query'), [['query', 'SELECT 1']])
  assert.deepEqual(mock.calls.filter(([kind]) => kind === 'ping').map(([, url]) => url), [env.REDIS_URL, env.QUEUE_REDIS_URL])
  assert.equal(mock.closed.length, 3)
  assert.equal(responseClosed, true)
})

test('the documents collaboration Redis is only verified when collaboration is enabled', async () => {
  const collabEnv = { DATABASE_URL: databaseUrl, DOCUMENTS_COLLAB_REDIS_URL: 'redis://127.0.0.1:6379' }
  const disabled = clients({ redisFailure: () => true })
  const result = await verifyServiceConnections(options(disabled, { env: collabEnv }))
  assert.deepEqual(result.checked, ['DATABASE_URL'])
  assert.equal(disabled.calls.filter(([kind]) => kind === 'redis-options').length, 0)

  const enabled = clients({ redisFailure: () => true })
  await assert.rejects(
    verifyServiceConnections(options(enabled, { env: { ...collabEnv, NEXT_PUBLIC_DOCUMENTS_COLLAB_URL: 'ws://localhost:4101' } })),
    /DOCUMENTS_COLLAB_REDIS_URL/,
  )
})

test('PostgreSQL credential rejection is actionable, redacted and closes the connection', async () => {
  const mock = clients({ postgresFailure: Object.assign(new Error('db-secret query-secret'), { code: '28P01' }) })
  await assert.rejects(verifyServiceConnections(options(mock)), (error) => {
    assert.ok(error instanceof ServiceConnectionError)
    assert.equal(error.service, 'PostgreSQL')
    assert.equal(error.kind, 'authentication')
    assert.match(error.message, /DATABASE_URL/)
    return redacted(error)
  })
  assert.deepEqual(mock.closed, ['postgres'])
})

test('a separate Redis consumer with wrong credentials stops verification and disconnects', async () => {
  const mock = clients({ redisFailure: (url) => url === env.QUEUE_REDIS_URL })
  await assert.rejects(verifyServiceConnections(options(mock)), (error) => {
    assert.equal(error.kind, 'authentication')
    assert.equal(error.envKey, 'QUEUE_REDIS_URL')
    return redacted(error)
  })
  assert.deepEqual(mock.closed, ['postgres', env.REDIS_URL, env.QUEUE_REDIS_URL])
})

test('Meilisearch rejects an invalid key even when the server responds to unauthenticated health', async () => {
  const mock = clients()
  let closed = false
  await assert.rejects(verifyServiceConnections(options(mock, { fetchImpl: async (url) => {
    assert.equal(url.pathname, '/indexes')
    return { ok: false, status: 401, body: { cancel: async () => { closed = true } } }
  } })), (error) => {
    assert.equal(error.service, 'Meilisearch')
    assert.equal(error.kind, 'authentication')
    return redacted(error)
  })
  assert.equal(closed, true)
})

test('unreachable and timed-out PostgreSQL fail with bounded, sanitized errors', async () => {
  for (const config of [{ postgresFailure: Object.assign(new Error('db-secret'), { code: 'ECONNREFUSED' }) }, { neverConnect: true }]) {
    const mock = clients(config)
    await assert.rejects(verifyServiceConnections(options(mock, { timeoutMs: 20 })), (error) => {
      assert.equal(error.kind, 'unreachable')
      return redacted(error)
    })
    assert.deepEqual(mock.closed, ['postgres'])
  }
})

test('loads env files with app and shell precedence while leaving their contents unchanged', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'service-check-env-'))
  try {
    const root = path.join(dir, 'root.env')
    const app = path.join(dir, '.env')
    fs.writeFileSync(root, 'DATABASE_URL=postgres://root:pw@localhost/root\n')
    fs.writeFileSync(app, 'DATABASE_URL=postgres://app:pw@localhost/app\n')
    const mock = clients()
    await verifyServiceConnections(options(mock, { projectDir: dir, envFiles: [root], env: {} }))
    assert.equal(mock.calls[0][1].connectionString, 'postgres://app:pw@localhost/app')
    assert.equal(fs.readFileSync(app, 'utf8'), 'DATABASE_URL=postgres://app:pw@localhost/app\n')
    const shell = clients()
    await verifyServiceConnections(options(shell, { projectDir: dir, envFiles: [root], env: { DATABASE_URL: databaseUrl } }))
    assert.equal(shell.calls[0][1].connectionString, databaseUrl)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('missing dependencies and invalid URLs fail before setup mutates a database', async () => {
  const mock = clients()
  await assert.rejects(verifyServiceConnections(options(mock, { env: {} })), /DATABASE_URL.*missing or invalid/)
  await assert.rejects(verifyServiceConnections(options(mock, { loadModule: async () => { throw Object.assign(new Error('missing'), { code: 'MISSING_DEPENDENCY' }) } })), /yarn install/)
  const order = []
  const ctx = { mode: 'hybrid', repoRoot: '/missing', env: {}, log: () => {}, verifyServiceConnectionsImpl: async () => { order.push('credentials'); throw new Error('Credentials rejected') } }
  const result = await runSteps([serviceConnectionsStep, { id: 'database', title: 'Database', apply: async () => order.push('database') }], ctx)
  assert.equal(result.ok, false)
  assert.equal(result.failedStep, 'service-connections')
  assert.deepEqual(order, ['credentials'])
})

test('shared verifier and template copy stay byte-identical', () => {
  assert.deepEqual(fs.readFileSync(new URL('../service-connections.mjs', import.meta.url)), fs.readFileSync(new URL('../../../create-app/template/scripts/dev-service-connections.mjs', import.meta.url)))
})


test('Meilisearch checks the application API key without substituting a server-only master key', async () => {
  const mock = clients()
  const configuration = { ...env, MEILISEARCH_API_KEY: '', MEILISEARCH_MASTER_KEY: 'server-master-secret' }
  await assert.rejects(verifyServiceConnections(options(mock, { env: configuration, fetchImpl: async (_url, request) => {
    assert.deepEqual(request.headers, {})
    return { ok: false, status: 401, body: { cancel: async () => {} } }
  } })), (error) => {
    assert.equal(error.kind, 'authentication')
    assert.ok(!error.message.includes('server-master-secret'))
    return true
  })
})

test('fetch connection causes and abort timeouts are reported as unreachable without leaking their cause', async () => {
  for (const failure of [new TypeError('fetch failed', { cause: Object.assign(new Error('meili-secret'), { code: 'ECONNREFUSED' }) }), Object.assign(new Error('meili-secret'), { name: 'TimeoutError' })]) {
    const mock = clients()
    await assert.rejects(verifyServiceConnections(options(mock, { fetchImpl: async () => { throw failure } })), (error) => {
      assert.equal(error.kind, 'unreachable')
      return redacted(error)
    })
  }
})


test('Meilisearch rejects an unrelated HTTP 200 service or malformed API body', async () => {
  for (const json of [async () => ({ application: 'unrelated' }), async () => { throw new SyntaxError('HTML response') }]) {
    const mock = clients()
    let closed = false
    await assert.rejects(verifyServiceConnections(options(mock, { fetchImpl: async () => ({ ok: true, status: 200, json, body: { cancel: async () => { closed = true } } }) })), (error) => {
      assert.equal(error.service, 'Meilisearch')
      assert.equal(error.kind, 'connection')
      return redacted(error)
    })
    assert.equal(closed, true)
  }
})


test('native fetch responses pass after their JSON stream is consumed and retain authentication errors', async () => {
  const mock = clients()
  const result = await verifyServiceConnections(options(mock, { fetchImpl: async () => new Response(JSON.stringify({ results: [] }), { status: 200 }) }))
  assert.equal(result.ok, true)
  await assert.rejects(verifyServiceConnections(options(clients(), { fetchImpl: async () => new Response('Unauthorized', { status: 401 }) })), (error) => {
    assert.equal(error.service, 'Meilisearch')
    assert.equal(error.kind, 'authentication')
    return true
  })
})


test('Redis AUTH against a server without a configured password is an actionable credential failure', async () => {
  const mock = clients({ redisFailure: () => true, redisError: 'ERR AUTH <password> called without any password configured for the default user' })
  await assert.rejects(verifyServiceConnections(options(mock)), (error) => {
    assert.equal(error.service, 'Redis')
    assert.equal(error.kind, 'authentication')
    return redacted(error)
  })
})


test('Redis preserves emitted authentication details when connect rejects with a generic closed-connection error', async () => {
  class Redis {
    on(_event, handler) { this.onError = handler }
    async connect() { this.onError(new Error('WRONGPASS redis-secret')); throw new Error('Connection is closed.') }
    disconnect() {}
  }
  const mock = clients()
  await assert.rejects(verifyServiceConnections(options(mock, { loadModule: async (root, name) => name === 'ioredis' ? Redis : mock.loadModule(root, name) })), (error) => {
    assert.equal(error.kind, 'authentication')
    return redacted(error)
  })
})


test('a missing selected PostgreSQL database verifies credentials read-only through maintenance before initialization creates it', async () => {
  const calls = []
  const closed = []
  class Client {
    constructor(options) { this.url = new URL(options.connectionString); calls.push(this.url.pathname) }
    on() {}
    async connect() { if (this.url.pathname === '/fresh') throw Object.assign(new Error('does not exist'), { code: '3D000' }) }
    async query(sql) { assert.equal(sql, 'SELECT 1'); calls.push(sql) }
    async end() { closed.push(this.url.pathname) }
  }
  const messages = []
  const result = await verifyServiceConnections({ projectDir: '/missing', env: { DATABASE_URL: 'postgres://fixture:pw@localhost/fresh' }, loadModule: async () => ({ Client }), log: (line) => messages.push(line) })
  assert.equal(result.ok, true)
  assert.deepEqual(calls, ['/fresh', '/postgres', 'SELECT 1'])
  assert.deepEqual(closed, ['/fresh', '/postgres'])
  assert.match(messages.join('\n'), /initialization will handle its creation/)
})
