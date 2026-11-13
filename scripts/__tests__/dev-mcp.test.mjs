import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import http from 'node:http'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { selectAvailableMcpPort as selectStandaloneMcpPort } from '../../packages/create-app/template/scripts/dev-mcp.mjs'

import {
  MCP_DEFAULT_PORT,
  buildManagedMcpAppEnv,
  buildMcpCliArgs,
  createLazyMcpProxy,
  deriveMcpHealthUrl,
  isFastMcpCrash,
  isManagedMcpReadiness,
  isKeyRotationOutput,
  looksLikeMissingAiAssistantModule,
  looksLikeMcpPortCollision,
  looksLikeMcpServerListening,
  looksLikeMissingKeyOwner,
  looksLikePermissionError,
  looksLikeUninitializedDatabase,
  nextMcpKeyRetryDelayMs,
  mayWakeMcpServer,
  nextMcpRestartDelayMs,
  resolveDevMcpHost,
  resolveMcpKeyFilePath,
  resolveMcpPort,
  selectAvailableMcpPort,
  shouldRetryMcpProvisioning,
  shouldStartMcp,
  shouldStartMcpLazily,
} from '../dev-mcp.mjs'

test('shouldStartMcp defaults to on', () => {
  assert.equal(shouldStartMcp({ args: [], env: {} }), true)
})

test('shouldStartMcp is disabled for app-only runs regardless of flags', () => {
  assert.equal(shouldStartMcp({ args: ['--with-mcp'], env: {}, appOnly: true }), false)
})

test('shouldStartMcp honors --no-mcp over env and default', () => {
  assert.equal(shouldStartMcp({ args: ['--no-mcp'], env: { OM_DEV_WITH_MCP: '1' } }), false)
})

test('shouldStartMcp lets --with-mcp win over a disabling env', () => {
  assert.equal(shouldStartMcp({ args: ['--with-mcp'], env: { OM_DEV_WITH_MCP: '0' } }), true)
})

test('shouldStartMcp reads OM_DEV_WITH_MCP tokens', () => {
  for (const token of ['0', 'false', 'no', 'off', ' OFF ']) {
    assert.equal(shouldStartMcp({ args: [], env: { OM_DEV_WITH_MCP: token } }), false, token)
  }
  for (const token of ['1', 'true', 'yes', 'on']) {
    assert.equal(shouldStartMcp({ args: [], env: { OM_DEV_WITH_MCP: token } }), true, token)
  }
})

test('shouldStartMcp falls back to on for unrecognized env tokens', () => {
  assert.equal(shouldStartMcp({ args: [], env: { OM_DEV_WITH_MCP: 'banana' } }), true)
})

test('resolveMcpPort parses MCP_PORT and rejects invalid values', () => {
  assert.equal(resolveMcpPort({}), MCP_DEFAULT_PORT)
  assert.equal(resolveMcpPort({ MCP_PORT: '4123' }), 4123)
  assert.equal(resolveMcpPort({ MCP_PORT: 'nope' }), MCP_DEFAULT_PORT)
  assert.equal(resolveMcpPort({ MCP_PORT: '0' }), MCP_DEFAULT_PORT)
  assert.equal(resolveMcpPort({ MCP_PORT: '70000' }), MCP_DEFAULT_PORT)
})

test('selectAvailableMcpPort preserves a free preference and falls back when occupied', async () => {
  const preferred = await selectAvailableMcpPort(0)
  assert.equal(await selectAvailableMcpPort(preferred), preferred)

  const occupied = createServer()
  await new Promise((resolve, reject) => {
    occupied.once('error', reject)
    occupied.listen({ port: preferred, host: '127.0.0.1', exclusive: true }, resolve)
  })
  try {
    const fallback = await selectAvailableMcpPort(preferred)
    assert.notEqual(fallback, preferred)
    assert.ok(fallback > 0 && fallback <= 65535)
  } finally {
    await new Promise((resolve) => occupied.close(resolve))
  }
})

for (const [runtime, selectPort] of [['monorepo', selectAvailableMcpPort], ['standalone', selectStandaloneMcpPort]]) {
  for (const host of ['127.0.0.1', '0.0.0.0', '::1', '::']) {
    test(`${runtime} MCP selection avoids an occupied ${host} port`, async (context) => {
      const occupied = createServer()
      try {
        await new Promise((resolve, reject) => {
          occupied.once('error', reject)
          occupied.listen({ port: 0, host, ipv6Only: host.includes(':'), exclusive: true }, resolve)
        })
      } catch (error) {
        if (host.includes(':') && ['EAFNOSUPPORT', 'EADDRNOTAVAIL', 'EPROTONOSUPPORT'].includes(error?.code)) {
          context.skip('IPv6 is unavailable on this host')
          return
        }
        throw error
      }

      const selected = createServer()
      try {
        const preferred = occupied.address().port
        const fallback = await selectPort(preferred)
        assert.notEqual(fallback, preferred)
        await new Promise((resolve, reject) => {
          selected.once('error', reject)
          selected.listen({ port: fallback, host, ipv6Only: host.includes(':'), exclusive: true }, resolve)
        })
      } finally {
        if (selected.listening) await new Promise((resolve) => selected.close(resolve))
        await new Promise((resolve) => occupied.close(resolve))
      }
    })
  }
}

test('resolveMcpKeyFilePath defaults under .mercato/mcp-shared and honors the env override', () => {
  const cwd = path.join(path.sep, 'srv', 'repo')
  assert.equal(
    resolveMcpKeyFilePath({}, cwd),
    path.join(cwd, '.mercato', 'mcp-shared', 'mcp-api-key'),
  )
  assert.equal(
    resolveMcpKeyFilePath({ MCP_SERVER_API_KEY_FILE: 'custom/key' }, cwd),
    path.resolve(cwd, 'custom/key'),
  )
  const absolute = path.join(path.sep, 'run', 'mcp', 'key')
  assert.equal(resolveMcpKeyFilePath({ MCP_SERVER_API_KEY_FILE: absolute }, cwd), absolute)
})

test('nextMcpRestartDelayMs backs off exponentially and caps at 60s', () => {
  assert.equal(nextMcpRestartDelayMs(0), 5_000)
  assert.equal(nextMcpRestartDelayMs(1), 10_000)
  assert.equal(nextMcpRestartDelayMs(2), 20_000)
  assert.equal(nextMcpRestartDelayMs(10), 60_000)
  assert.equal(nextMcpRestartDelayMs(-3), 5_000)
})

test('nextMcpKeyRetryDelayMs backs off 30s → 60s → 120s cap', () => {
  assert.equal(nextMcpKeyRetryDelayMs(0), 30_000)
  assert.equal(nextMcpKeyRetryDelayMs(1), 60_000)
  assert.equal(nextMcpKeyRetryDelayMs(2), 120_000)
  assert.equal(nextMcpKeyRetryDelayMs(9), 120_000)
})

test('isFastMcpCrash classifies by uptime', () => {
  assert.equal(isFastMcpCrash(1_000), true)
  assert.equal(isFastMcpCrash(59_999), true)
  assert.equal(isFastMcpCrash(60_000), false)
  assert.equal(isFastMcpCrash(-1), false)
})

test('buildMcpCliArgs prefixes the ai_assistant module for a direct mercato CLI invocation', () => {
  assert.deepEqual(
    buildMcpCliArgs(['mcp:serve-http', '--port', '3001']),
    ['ai_assistant', 'mcp:serve-http', '--port', '3001'],
  )
  assert.deepEqual(
    buildMcpCliArgs(['mcp:ensure-api-key', '--file', 'x']),
    ['ai_assistant', 'mcp:ensure-api-key', '--file', 'x'],
  )
})

test('deriveMcpHealthUrl points at localhost health endpoint', () => {
  assert.equal(deriveMcpHealthUrl(3001), 'http://localhost:3001/health')
})

test('buildManagedMcpAppEnv propagates the selected port without replacing explicit external configuration', () => {
  assert.deepEqual(buildManagedMcpAppEnv({
    enabled: true,
    port: 3123,
    keyFilePath: '/repo/.mercato/mcp-api-key',
    env: {},
  }), {
    MCP_SERVER_API_KEY_FILE: '/repo/.mercato/mcp-api-key',
    MCP_URL: 'http://localhost:3123',
  })
  assert.deepEqual(buildManagedMcpAppEnv({
    enabled: true,
    port: 3123,
    keyFilePath: '/repo/.mercato/mcp-api-key',
    env: {
      MCP_SERVER_API_KEY: 'external-key',
      MCP_URL: 'https://external.example/mcp',
    },
  }), {})
  assert.deepEqual(buildManagedMcpAppEnv({ enabled: false, port: 3123, keyFilePath: '/tmp/key', env: {} }), {})
})

test('isManagedMcpReadiness rejects stale probes and accepts only the current listening child', () => {
  const ready = {
    childListening: true,
    childExitCode: null,
    childSignalCode: null,
    attemptedPort: 3123,
    currentPort: 3123,
    responseOk: true,
  }
  assert.equal(isManagedMcpReadiness(ready), true)
  assert.equal(isManagedMcpReadiness({ ...ready, childListening: false }), false)
  assert.equal(isManagedMcpReadiness({ ...ready, childExitCode: 1 }), false)
  assert.equal(isManagedMcpReadiness({ ...ready, attemptedPort: 3001 }), false)
  assert.equal(isManagedMcpReadiness({ ...ready, responseOk: false }), false)
})

test('MCP lifecycle output classifiers distinguish bind collisions and child readiness', () => {
  assert.equal(looksLikeMcpPortCollision(['Error: listen EADDRINUSE: address already in use :::3001']), true)
  assert.equal(looksLikeMcpPortCollision(['connect ECONNREFUSED 127.0.0.1:3001']), false)
  assert.equal(looksLikeMcpServerListening(['{"msg":"Server listening","port":3002}']), true)
  assert.equal(looksLikeMcpServerListening(['Endpoint ready http://localhost:3002/mcp']), false)
})

test('output classifiers detect rotation, permission, and uninitialized-database lines', () => {
  assert.equal(isKeyRotationOutput(['[mcp:ensure-api-key] New key created (id=1, prefix=omk_)']), true)
  assert.equal(isKeyRotationOutput(['[mcp:ensure-api-key] Existing key is valid (id=1, prefix=omk_)']), false)
  assert.equal(looksLikePermissionError(['EACCES: permission denied, open /repo/.mercato/mcp-shared/mcp-api-key']), true)
  assert.equal(looksLikePermissionError(['some other failure']), false)
  assert.equal(looksLikeUninitializedDatabase(['error: relation "api_keys" does not exist']), true)
  assert.equal(looksLikeUninitializedDatabase(['connect ECONNREFUSED 127.0.0.1:5432']), true)
  assert.equal(looksLikeUninitializedDatabase(['TypeError: boom']), false)
})

test('looksLikeMissingKeyOwner detects the owner-not-found throw', () => {
  assert.equal(
    looksLikeMissingKeyOwner(['[internal] MCP API key owner not found: no active user with email "superadmin@acme.com".']),
    true,
  )
  assert.equal(looksLikeMissingKeyOwner(['Run "mercato init" first or pass --email pointing at an existing admin user.']), true)
  // "Run mercato init" is an owner-resolution failure, not a bare DB-not-ready signal.
  assert.equal(looksLikeUninitializedDatabase(['Run "mercato init" first']), false)
  assert.equal(looksLikeMissingKeyOwner(['connect ECONNREFUSED 127.0.0.1:5432']), false)
})

test('resolveDevMcpHost binds 0.0.0.0 only on native Linux, where host-gateway is the bridge IP', () => {
  assert.equal(resolveDevMcpHost({ platform: 'linux', env: {} }), '0.0.0.0')
  assert.equal(resolveDevMcpHost({ platform: 'darwin', env: {} }), null)
  assert.equal(resolveDevMcpHost({ platform: 'win32', env: {} }), null)
})

test('resolveDevMcpHost honours an explicit MCP_HTTP_HOST on every platform', () => {
  assert.equal(resolveDevMcpHost({ platform: 'darwin', env: { MCP_HTTP_HOST: '127.0.0.1' } }), '127.0.0.1')
  assert.equal(resolveDevMcpHost({ platform: 'linux', env: { MCP_HTTP_HOST: '10.0.0.5' } }), '10.0.0.5')
  assert.equal(resolveDevMcpHost({ platform: 'linux', env: { MCP_HTTP_HOST: '   ' } }), '0.0.0.0')
})

test('looksLikeMissingAiAssistantModule matches the CLI missing-module output only', () => {
  assert.equal(looksLikeMissingAiAssistantModule(['❌ Module not found: "ai_assistant"']), true)
  assert.equal(looksLikeMissingAiAssistantModule(['Module not found: "customers"']), false)
  assert.equal(looksLikeMissingAiAssistantModule(['Module not found: "ai_assistant_x"']), false)
  assert.equal(looksLikeMissingAiAssistantModule(['Module not found: "ai_assistants"']), false)
  assert.equal(looksLikeMissingAiAssistantModule(["Error: Cannot find module 'x' code: 'MODULE_NOT_FOUND'"]), false)
  assert.equal(looksLikeMissingAiAssistantModule(['connect ECONNREFUSED 127.0.0.1:5432']), false)
})

test('shouldRetryMcpProvisioning stops for a missing ai_assistant module and keeps retrying transient failures', () => {
  assert.equal(shouldRetryMcpProvisioning(['❌ Module not found: "ai_assistant"']), false)
  assert.equal(shouldRetryMcpProvisioning(['connect ECONNREFUSED 127.0.0.1:5432']), true)
  assert.equal(shouldRetryMcpProvisioning(['error: relation "api_keys" does not exist']), true)
  assert.equal(shouldRetryMcpProvisioning([]), true)
})

test('dev runner returns without retrying when ai_assistant is missing, in root and template copies', () => {
  const here = path.dirname(fileURLToPath(import.meta.url))
  for (const file of [
    path.resolve(here, '..', 'dev.mjs'),
    path.resolve(here, '..', '..', 'packages', 'create-app', 'template', 'scripts', 'dev.mjs'),
  ]) {
    const source = readFileSync(file, 'utf8')
    const guard = source.indexOf('if (!shouldRetryMcpProvisioning(capturedLines))')
    const retry = source.indexOf('nextMcpKeyRetryDelayMs(attempt)')
    assert.ok(guard > 0 && guard < retry, file)
    assert.match(source.slice(guard, retry), /return false/, file)
  }
})

test('shouldStartMcpLazily defaults to lazy and only an explicit disabling token restores the eager start', () => {
  assert.equal(shouldStartMcpLazily({}), true)
  for (const token of ['0', 'false', 'no', 'off', ' OFF ']) {
    assert.equal(shouldStartMcpLazily({ OM_DEV_MCP_LAZY: token }), false, token)
  }
  for (const token of ['1', 'true', 'yes', 'on', '', 'banana']) {
    assert.equal(shouldStartMcpLazily({ OM_DEV_MCP_LAZY: token }), true, token)
  }
})

async function listenOnLoopback(server) {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return server.address().port
}

function sendRequest(port, { method = 'GET', path: requestPath = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port, method, path: requestPath, headers, agent: false }, (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') }))
    })
    request.on('error', reject)
    request.end(body)
  })
}

async function startLazyProxy(options) {
  const proxy = createLazyMcpProxy(options)
  const { port } = await proxy.listen(0, '127.0.0.1')
  let firstUseSeen = false
  void proxy.firstUse.then(() => { firstUseSeen = true })
  return { proxy, port, firstUseSeen: () => firstUseSeen }
}

const KNOWN_KEY = ['managed', 'key', 'from', 'file'].join('-')
const WELL_FORMED_KEY = `omk_${'a1'.repeat(4)}.${'b2'.repeat(24)}`

function assertHealthShape(response, expectedStatus) {
  const body = JSON.parse(response.body)
  assert.equal(response.status, expectedStatus)
  assert.equal(typeof body.status, 'string')
  assert.equal(typeof body.tools, 'number')
  assert.equal(typeof body.timestamp, 'string')
  return body
}

test('mayWakeMcpServer requires a known key unless the socket peer is trusted', () => {
  assert.equal(mayWakeMcpServer(KNOWN_KEY, [KNOWN_KEY]), true)
  assert.equal(mayWakeMcpServer([KNOWN_KEY], ['', KNOWN_KEY]), true)
  assert.equal(mayWakeMcpServer(WELL_FORMED_KEY, []), false)
  assert.equal(mayWakeMcpServer(WELL_FORMED_KEY, [], true), true)
  assert.equal(mayWakeMcpServer('omk_short.key', [], true), false)
  assert.equal(mayWakeMcpServer(undefined, [KNOWN_KEY]), false)
  assert.equal(mayWakeMcpServer('', ['']), false)
  assert.equal(mayWakeMcpServer(`${KNOWN_KEY}x`, [KNOWN_KEY]), false)
  assert.equal(mayWakeMcpServer('omk_short.key', [KNOWN_KEY]), false)
  assert.equal(mayWakeMcpServer(`${WELL_FORMED_KEY}0`, []), false)
  assert.equal(mayWakeMcpServer(WELL_FORMED_KEY.toUpperCase(), []), false)
})

test('lazy MCP proxy answers /health itself with the real server shape and never starts the server for it', async () => {
  const { proxy, port, firstUseSeen } = await startLazyProxy()
  try {
    const beforeArm = assertHealthShape(await sendRequest(port, { path: '/health' }), 503)
    assert.equal(beforeArm.status, 'starting')
    assert.equal(beforeArm.tools, 0)
    assert.equal(beforeArm.lazy, true)

    const blocked = await sendRequest(port, { method: 'POST', path: '/mcp', headers: { 'x-api-key': WELL_FORMED_KEY }, body: '{}' })
    assert.equal(blocked.status, 503)

    proxy.arm([KNOWN_KEY])
    const armed = await sendRequest(port, { path: '/health?probe=1' })
    assert.equal(armed.headers['content-type'], 'application/json')
    const armedBody = assertHealthShape(armed, 200)
    assert.equal(armedBody.status, 'ok')
    assert.equal(armedBody.tools, 0)
    assert.equal(armedBody.lazy, true)
    const head = await sendRequest(port, { method: 'HEAD', path: '/health' })
    assert.equal(head.status, 200)
    assert.equal(head.body, '')

    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(firstUseSeen(), false)
  } finally {
    await proxy.close()
  }
})

test('lazy MCP proxy answers 401 without waking the server for a missing or malformed API key', async () => {
  const { proxy, port, firstUseSeen } = await startLazyProxy()
  try {
    proxy.arm([KNOWN_KEY])
    const missing = await sendRequest(port, { method: 'POST', path: '/mcp', body: '{}' })
    assert.equal(missing.status, 401)
    assert.equal(JSON.parse(missing.body).error, 'API key required (x-api-key header)')

    const wrong = await sendRequest(port, { method: 'POST', path: '/mcp', headers: { 'x-api-key': 'not-a-key' }, body: '{}' })
    assert.equal(wrong.status, 401)
    assert.equal(JSON.parse(wrong.body).error, 'Invalid or expired API key')

    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(firstUseSeen(), false)
  } finally {
    await proxy.close()
  }
})

test('lazy MCP proxy starts on the first request, holds it until the upstream is ready, then forwards everything', async () => {
  const { proxy, port, firstUseSeen } = await startLazyProxy()
  const upstream = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      if (req.url === '/health') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ status: 'ok', tools: 3 }))
        return
      }
      res.writeHead(201, { 'content-type': 'application/json', 'x-upstream': 'real' })
      res.end(JSON.stringify({
        method: req.method,
        url: req.url,
        apiKey: req.headers['x-api-key'],
        body: Buffer.concat(chunks).toString('utf8'),
      }))
    })
  })
  try {
    proxy.arm([KNOWN_KEY])
    const pending = sendRequest(port, {
      method: 'POST',
      path: '/mcp?x=1',
      headers: { 'content-type': 'application/json', 'x-api-key': KNOWN_KEY },
      body: '{"jsonrpc":"2.0","id":1,"method":"initialize"}',
    })
    await proxy.firstUse
    assert.equal(firstUseSeen(), true)
    const upstreamPort = await listenOnLoopback(upstream)
    proxy.setUpstream({ host: '127.0.0.1', port: upstreamPort })

    const forwarded = await pending
    assert.equal(forwarded.status, 201)
    assert.equal(forwarded.headers['x-upstream'], 'real')
    assert.deepEqual(JSON.parse(forwarded.body), {
      method: 'POST',
      url: '/mcp?x=1',
      apiKey: KNOWN_KEY,
      body: '{"jsonrpc":"2.0","id":1,"method":"initialize"}',
    })

    const keyless = await sendRequest(port, { method: 'POST', path: '/mcp', body: '{}' })
    assert.equal(keyless.status, 201)

    const health = await sendRequest(port, { path: '/health' })
    assert.deepEqual(JSON.parse(health.body), { status: 'ok', tools: 3 })

    proxy.setUpstream(null)
    const localHealth = assertHealthShape(await sendRequest(port, { path: '/health' }), 200)
    assert.equal(localHealth.status, 'ok')
    assert.equal(localHealth.tools, 0)
  } finally {
    await proxy.close()
    if (upstream.listening) await new Promise((resolve) => upstream.close(resolve))
  }
})

test('lazy MCP proxy supports user-created keys from loopback and caps pending requests at 429', async () => {
  const { proxy, port, firstUseSeen } = await startLazyProxy({ maxPendingRequests: 2 })
  const upstream = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('{"ok":true}')
  })
  const send = () => sendRequest(port, { method: 'POST', path: '/mcp', headers: { 'x-api-key': WELL_FORMED_KEY }, body: '{}' })
  try {
    proxy.arm([KNOWN_KEY])
    const first = send()
    await proxy.firstUse
    assert.equal(firstUseSeen(), true)
    const second = send()
    await new Promise((resolve) => setTimeout(resolve, 20))

    const overflow = await send()
    assert.equal(overflow.status, 429)
    assert.equal(overflow.headers['retry-after'], '5')

    const upstreamPort = await listenOnLoopback(upstream)
    proxy.setUpstream({ host: '127.0.0.1', port: upstreamPort })
    assert.deepEqual((await Promise.all([first, second])).map((response) => response.status), [200, 200])
  } finally {
    await proxy.close()
    if (upstream.listening) await new Promise((resolve) => upstream.close(resolve))
  }
})

test('untrusted formatted keys cannot wake MCP or occupy an authorized client queue slot', async () => {
  // An empty trust list makes the actual HTTP peer untrusted on every platform.
  const { proxy, port, firstUseSeen } = await startLazyProxy({ trustedPeers: [], maxPendingRequests: 1 })
  const upstream = http.createServer((_req, res) => res.end('authorized'))
  const forged = () => sendRequest(port, {
    method: 'POST', path: '/mcp',
    headers: { 'x-api-key': WELL_FORMED_KEY, 'x-forwarded-for': '127.0.0.1', forwarded: 'for="[::1]"' },
    body: '{}',
  })
  try {
    proxy.arm([KNOWN_KEY])
    assert.deepEqual((await Promise.all(Array.from({ length: 20 }, forged))).map((res) => res.status), Array(20).fill(401))
    assert.equal(firstUseSeen(), false)
    const authorized = sendRequest(port, { method: 'POST', path: '/mcp', headers: { 'x-api-key': KNOWN_KEY }, body: '{}' })
    await proxy.firstUse
    assert.equal((await forged()).status, 401)
    const upstreamPort = await listenOnLoopback(upstream)
    proxy.setUpstream({ host: '127.0.0.1', port: upstreamPort })
    assert.equal((await authorized).body, 'authorized')
    proxy.setUpstream(null)
    assert.equal((await forged()).status, 401)
  } finally {
    await proxy.close()
    if (upstream.listening) await new Promise((resolve) => upstream.close(resolve))
  }
})

test('explicit trusted peer addresses support user-created keys including IPv4-mapped IPv6', async () => {
  for (const trustedPeers of [['127.0.0.1'], ['::ffff:127.0.0.1']]) {
    const { proxy, port } = await startLazyProxy({ trustedPeers })
    const upstream = http.createServer((_req, res) => { res.writeHead(401); res.end('upstream authenticates') })
    try {
      proxy.arm([KNOWN_KEY])
      const request = sendRequest(port, { path: '/mcp', headers: { 'x-api-key': WELL_FORMED_KEY } })
      await proxy.firstUse
      const upstreamPort = await listenOnLoopback(upstream)
      proxy.setUpstream({ host: '127.0.0.1', port: upstreamPort })
      const response = await request
      assert.equal(response.status, 401)
      assert.equal(response.body, 'upstream authenticates')
    } finally {
      await proxy.close()
      if (upstream.listening) await new Promise((resolve) => upstream.close(resolve))
    }
  }
})

test('invalid trusted peer entries never broaden the network boundary', async () => {
  const { proxy, port, firstUseSeen } = await startLazyProxy({ trustedPeers: ['*', 'localhost', '127.0.0.0/8', ''] })
  try {
    proxy.arm([KNOWN_KEY])
    const response = await sendRequest(port, { path: '/mcp', headers: { 'x-api-key': WELL_FORMED_KEY } })
    assert.equal(response.status, 401)
    assert.equal(firstUseSeen(), false)
  } finally {
    await proxy.close()
  }
})

test('lazy MCP proxy streams SSE unbuffered and aborts the upstream when the client disconnects', async () => {
  const { proxy, port } = await startLazyProxy()
  let upstreamClosed
  const upstreamClosedPromise = new Promise((resolve) => { upstreamClosed = resolve })
  const upstream = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
    res.flushHeaders()
    res.write('event: message\ndata: {"n":1}\n\n')
    res.on('close', () => upstreamClosed(res.writableFinished))
  })
  try {
    const upstreamPort = await listenOnLoopback(upstream)
    proxy.arm([KNOWN_KEY])
    proxy.setUpstream({ host: '127.0.0.1', port: upstreamPort })

    const request = http.get({ host: '127.0.0.1', port, path: '/mcp', headers: { accept: 'text/event-stream' }, agent: false })
    const [response] = await once(request, 'response')
    assert.equal(response.statusCode, 200)
    assert.equal(response.headers['content-type'], 'text/event-stream')
    const [firstChunk] = await once(response, 'data')
    assert.equal(firstChunk.toString('utf8'), 'event: message\ndata: {"n":1}\n\n')

    request.destroy()
    assert.equal(await upstreamClosedPromise, false)
  } finally {
    await proxy.close()
    upstream.closeAllConnections()
    await new Promise((resolve) => upstream.close(resolve))
  }
})

test('lazy MCP proxy answers 503 when the server never becomes ready', async () => {
  const { proxy, port } = await startLazyProxy({ upstreamTimeoutMs: 50 })
  try {
    proxy.arm([KNOWN_KEY])
    const response = await sendRequest(port, { method: 'POST', path: '/mcp', headers: { 'x-api-key': KNOWN_KEY }, body: '{}' })
    assert.equal(response.status, 503)
  } finally {
    await proxy.close()
  }
})
