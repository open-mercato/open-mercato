import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'

import {
  buildUpstreamHeaders,
  createDevRuntimeGateway,
  isGatewayControlPath,
  isNavigationRequest,
  stripHopByHopHeaders,
} from '../dev-runtime-gateway.mjs'

const TOKEN = 'gateway-token-fixture'
const SPLASH_MARKER = '<!doctype html><title>Open Mercato Dev Splash</title>'

function listen(server, handler) {
  return new Promise((resolve) => {
    if (handler) server.on('request', handler)
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  })
}

function closeServer(server) {
  return new Promise((resolve) => {
    server.closeAllConnections?.()
    server.close(() => resolve())
  })
}

// `fetch` strips forbidden `Sec-*` headers, so navigation semantics can only be
// exercised through a raw HTTP client.
function rawRequest(port, path, init = {}) {
  return new Promise((resolve, reject) => {
    const body = init.body ?? null
    const headers = { ...(init.headers ?? {}) }
    if (body != null) headers['content-length'] = Buffer.byteLength(body)

    const request = http.request({ host: '127.0.0.1', port, path, method: init.method ?? 'GET', headers }, (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: {
          get: (name) => {
            const value = response.headers[name.toLowerCase()]
            return Array.isArray(value) ? value.join(', ') : (value ?? null)
          },
        },
        text: Buffer.concat(chunks).toString('utf8'),
      }))
    })
    request.on('error', reject)
    if (body != null) request.write(body)
    request.end()
  })
}

async function withGateway(options, run) {
  const upstreamServer = http.createServer(options.upstream ?? ((req, res) => {
    res.statusCode = 200
    res.setHeader('content-type', 'text/plain')
    res.end('upstream-ok')
  }))
  const upstreamPort = await listen(upstreamServer)

  const state = { health: options.health ?? 'ready', upstreamAvailable: options.upstreamAvailable !== false }
  const gateway = createDevRuntimeGateway({
    token: TOKEN,
    env: {},
    getStatus: options.getStatus ?? (() => ({ schemaVersion: 1, generation: 1, health: state.health, ready: true, failed: false, incidents: [] })),
    getDiagnosticLines: options.getDiagnosticLines,
    recordBrowserReport: options.recordBrowserReport,
    runAction: options.runAction,
    renderSplashHtml: () => SPLASH_MARKER,
    resolveUpstream: () => (state.upstreamAvailable ? { host: '127.0.0.1', port: upstreamPort } : null),
  })
  const publicPort = (await gateway.listen(0, '127.0.0.1')).port

  const request = (path, init = {}) => rawRequest(publicPort, path, init)

  try {
    return await run({ request, state, publicPort, upstreamPort })
  } finally {
    await gateway.close()
    await closeServer(upstreamServer)
  }
}

// Mirrors what a browser sends for a real address-bar navigation.
const HTML_HEADERS = { accept: 'text/html,application/xhtml+xml', 'sec-fetch-mode': 'navigate' }

test('classifies gateway-owned control paths', () => {
  assert.equal(isGatewayControlPath('/__open-mercato'), true)
  assert.equal(isGatewayControlPath('/__open-mercato/status'), true)
  assert.equal(isGatewayControlPath('/__open-mercato-other'), false)
  assert.equal(isGatewayControlPath('/backend'), false)
})

test('treats only html GET/HEAD requests as navigations', () => {
  assert.equal(isNavigationRequest('GET', '/backend', { accept: 'text/html' }), true)
  assert.equal(isNavigationRequest('HEAD', '/backend', { accept: 'text/html' }), true)
  assert.equal(isNavigationRequest('POST', '/backend', { accept: 'text/html' }), false)
  assert.equal(isNavigationRequest('GET', '/backend', { accept: 'application/json' }), false)
  assert.equal(isNavigationRequest('GET', '/api/customers', { accept: 'text/html' }), false)
  assert.equal(isNavigationRequest('GET', '/_next/static/chunk.js', { accept: 'text/html' }), false)
  assert.equal(isNavigationRequest('GET', '/__open-mercato/status', { accept: 'text/html' }), false)
})

test('never treats a fetch/XHR request as a navigation', () => {
  assert.equal(isNavigationRequest('GET', '/backend', { accept: 'text/html', 'sec-fetch-mode': 'cors' }), false)
  assert.equal(isNavigationRequest('GET', '/backend', { accept: 'text/html', 'sec-fetch-mode': 'no-cors' }), false)
  assert.equal(isNavigationRequest('GET', '/backend', { accept: 'text/html', 'sec-fetch-mode': 'navigate' }), true)
  assert.equal(isNavigationRequest('GET', '/backend', { accept: 'text/html', 'x-requested-with': 'XMLHttpRequest' }), false)
})

test('strips hop-by-hop headers in both directions', () => {
  const stripped = stripHopByHopHeaders({
    'content-type': 'text/html',
    connection: 'keep-alive',
    'keep-alive': 'timeout=5',
    'transfer-encoding': 'chunked',
    upgrade: 'websocket',
    te: 'trailers',
    'proxy-authorization': 'Basic x',
    cookie: 'session=1',
  })
  assert.deepEqual(stripped, { 'content-type': 'text/html', cookie: 'session=1' })
})

test('reconstructs forwarding headers deliberately', () => {
  const headers = buildUpstreamHeaders(
    {
      headers: { host: 'localhost:3000', origin: 'http://localhost:3000', cookie: 'session=1', connection: 'keep-alive' },
      socket: { remoteAddress: '127.0.0.1' },
    },
    { host: '127.0.0.1', port: 3111 },
  )

  assert.equal(headers.host, '127.0.0.1:3111')
  assert.equal(headers['x-forwarded-host'], 'localhost:3000')
  assert.equal(headers['x-forwarded-proto'], 'http')
  assert.equal(headers['x-forwarded-for'], '127.0.0.1')
  assert.equal(headers.origin, 'http://127.0.0.1:3111')
  assert.equal(headers.cookie, 'session=1')
  assert.equal(headers.connection, undefined)
})

test('serves the structured status from the control namespace', async () => {
  await withGateway({}, async ({ request }) => {
    const response = await request('/__open-mercato/status')
    assert.equal(response.status, 200)
    assert.equal(JSON.parse(response.text).health, 'ready')
  })
})

test('serves bounded logs and tolerates a malformed cursor', async () => {
  const snapshots = []
  await withGateway({
    getDiagnosticLines: (cursor) => {
      snapshots.push(cursor)
      return { lines: [{ seq: 1, text: 'boom' }], nextCursor: 1, generation: 1 }
    },
  }, async ({ request }) => {
    assert.equal((await request('/__open-mercato/logs?cursor=5')).status, 200)
    assert.equal((await request('/__open-mercato/logs?cursor=not-a-number')).status, 200)
    assert.equal((await request('/__open-mercato/logs')).status, 200)
    assert.deepEqual(snapshots, [5, 0, 0])
  })
})

test('answers an unknown control route with JSON, never splash HTML', async () => {
  await withGateway({}, async ({ request }) => {
    const response = await request('/__open-mercato/nope', { headers: HTML_HEADERS })
    assert.equal(response.status, 404)
    assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8')
    assert.equal(JSON.parse(response.text).error.code, 'not_found')
  })
})

test('accepts a valid browser report and rejects an unauthenticated one', async () => {
  const recorded = []
  await withGateway({
    recordBrowserReport: (report) => {
      recorded.push(report)
      return 'issue-1'
    },
  }, async ({ request }) => {
    const rejected = await request('/__open-mercato/diagnostics', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'global-error', message: 'boom' }),
    })
    assert.equal(rejected.status, 403)
    assert.deepEqual(recorded, [])

    const accepted = await request('/__open-mercato/diagnostics', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-om-dev-runtime-token': TOKEN },
      body: JSON.stringify({ kind: 'global-error', message: 'boom', path: '/backend' }),
    })
    assert.equal(accepted.status, 202)
    assert.equal(JSON.parse(accepted.text).accepted, true)
    assert.equal(recorded.length, 1)
    assert.equal(recorded[0].message, 'boom')
  })
})

test('rejects a malformed browser report', async () => {
  await withGateway({ recordBrowserReport: () => 'issue-1' }, async ({ request }) => {
    const response = await request('/__open-mercato/diagnostics', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-om-dev-runtime-token': TOKEN },
      body: JSON.stringify({ kind: 'shell-exec', message: 'boom' }),
    })
    assert.equal(response.status, 400)
  })
})

test('queues an allowlisted recovery action and rejects everything else', async () => {
  const invoked = []
  await withGateway({
    runAction: async (action) => {
      invoked.push(action)
      return { ok: true, actionId: 'action-1', generation: 1 }
    },
  }, async ({ request }) => {
    const accepted = await request('/__open-mercato/actions/migrate', {
      method: 'POST',
      headers: { 'x-om-dev-runtime-token': TOKEN },
    })
    assert.equal(accepted.status, 202)
    assert.deepEqual(JSON.parse(accepted.text), { accepted: true, actionId: 'action-1', generation: 1 })

    const unknown = await request('/__open-mercato/actions/rm-rf', {
      method: 'POST',
      headers: { 'x-om-dev-runtime-token': TOKEN },
    })
    assert.equal(unknown.status, 400)
    assert.equal(JSON.parse(unknown.text).error.code, 'unknown_action')

    const unauthenticated = await request('/__open-mercato/actions/restart', { method: 'POST' })
    assert.equal(unauthenticated.status, 403)

    assert.deepEqual(invoked, ['migrate'])
  })
})

test('reports a busy action as a conflict', async () => {
  await withGateway({
    runAction: async () => ({ ok: false, status: 409, code: 'action_busy', message: 'Another action is running.' }),
  }, async ({ request }) => {
    const response = await request('/__open-mercato/actions/generate', {
      method: 'POST',
      headers: { 'x-om-dev-runtime-token': TOKEN },
    })
    assert.equal(response.status, 409)
    assert.equal(JSON.parse(response.text).error.code, 'action_busy')
  })
})

test('reports 503 when the supervisor cannot run actions', async () => {
  await withGateway({}, async ({ request }) => {
    const response = await request('/__open-mercato/actions/restart', {
      method: 'POST',
      headers: { 'x-om-dev-runtime-token': TOKEN },
    })
    assert.equal(response.status, 503)
  })
})

test('serves splash HTML for navigations while the runtime cannot serve', async () => {
  for (const health of ['starting', 'recovering', 'unavailable']) {
    await withGateway({ health }, async ({ request }) => {
      const response = await request('/backend', { headers: HTML_HEADERS })
      assert.equal(response.status, 200)
      assert.equal(response.text, SPLASH_MARKER)
    })
  }
})

test('proxies navigations while ready or degraded', async () => {
  for (const health of ['ready', 'degraded']) {
    await withGateway({
      health,
      upstream: (req, res) => {
        res.statusCode = 200
        res.setHeader('content-type', 'text/html')
        res.end('<html>upstream page</html>')
      },
    }, async ({ request }) => {
      const response = await request('/backend', { headers: HTML_HEADERS })
      assert.equal(response.status, 200)
      assert.equal(response.text, '<html>upstream page</html>')
    })
  }
})

test('never replaces a business API error with splash HTML', async () => {
  for (const status of [400, 401, 404, 422, 500]) {
    await withGateway({
      health: 'unavailable',
      upstream: (req, res) => {
        res.statusCode = status
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ error: 'business failure' }))
      },
    }, async ({ request }) => {
      const response = await request('/api/customers', { headers: HTML_HEADERS })
      assert.equal(response.status, status)
      assert.equal(JSON.parse(response.text).error, 'business failure')
    })
  }
})

test('passes static and _next assets through untouched', async () => {
  await withGateway({
    health: 'starting',
    upstream: (req, res) => {
      res.statusCode = 200
      res.setHeader('content-type', 'application/javascript')
      res.setHeader('x-upstream-path', req.url)
      res.end('console.log(1)')
    },
  }, async ({ request }) => {
    const chunk = await request('/_next/static/chunks/main.js', { headers: HTML_HEADERS })
    assert.equal(chunk.status, 200)
    assert.equal(chunk.text, 'console.log(1)')
    assert.equal(chunk.headers.get('x-upstream-path'), '/_next/static/chunks/main.js')

    const asset = await request('/open-mercato.svg', { headers: { accept: 'image/svg+xml' } })
    assert.equal(asset.status, 200)
  })
})

test('preserves the request body, method, cookies and response headers', async () => {
  const received = {}
  await withGateway({
    upstream: (req, res) => {
      received.method = req.method
      received.cookie = req.headers.cookie
      received.forwardedHost = req.headers['x-forwarded-host']
      const chunks = []
      req.on('data', (chunk) => chunks.push(chunk))
      req.on('end', () => {
        received.body = Buffer.concat(chunks).toString('utf8')
        res.statusCode = 201
        res.setHeader('set-cookie', 'om_session=abc; Path=/')
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ ok: true }))
      })
    },
  }, async ({ request, publicPort }) => {
    const response = await request('/api/customers', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: 'om_session=abc' },
      body: JSON.stringify({ name: 'Ada' }),
    })

    assert.equal(response.status, 201)
    assert.equal(response.headers.get('set-cookie'), 'om_session=abc; Path=/')
    assert.equal(received.method, 'POST')
    assert.equal(received.cookie, 'om_session=abc')
    assert.equal(received.body, JSON.stringify({ name: 'Ada' }))
    assert.equal(received.forwardedHost, `127.0.0.1:${publicPort}`)
  })
})

test('answers a non-navigation request with JSON when no upstream is listening', async () => {
  await withGateway({ upstreamAvailable: false }, async ({ request }) => {
    const response = await request('/api/customers', { headers: { accept: 'application/json' } })
    assert.equal(response.status, 503)
    assert.equal(JSON.parse(response.text).error.code, 'upstream_unavailable')
  })
})

test('falls back to splash HTML for a navigation when no upstream is listening', async () => {
  await withGateway({ health: 'ready', upstreamAvailable: false }, async ({ request }) => {
    const response = await request('/backend', { headers: HTML_HEADERS })
    assert.equal(response.status, 200)
    assert.equal(response.text, SPLASH_MARKER)
  })
})

test('forwards an HMR websocket upgrade to the upstream', async () => {
  // An upgraded socket detaches from the server, so the test has to close it
  // itself or `server.close()` never settles.
  const upstreamTunnels = new Set()
  const upstreamServer = http.createServer()
  upstreamServer.on('upgrade', (req, socket) => {
    upstreamTunnels.add(socket)
    socket.write('HTTP/1.1 101 Switching Protocols\r\nupgrade: websocket\r\nconnection: Upgrade\r\n\r\n')
    socket.write('hmr-hello')
  })
  const upstreamPort = await listen(upstreamServer)

  const gateway = createDevRuntimeGateway({
    token: TOKEN,
    env: {},
    getStatus: () => ({ health: 'ready' }),
    renderSplashHtml: () => SPLASH_MARKER,
    resolveUpstream: () => ({ host: '127.0.0.1', port: upstreamPort }),
  })
  const publicPort = (await gateway.listen(0, '127.0.0.1')).port

  try {
    const received = await new Promise((resolve, reject) => {
      const request = http.request({
        host: '127.0.0.1',
        port: publicPort,
        path: '/_next/webpack-hmr',
        headers: { connection: 'Upgrade', upgrade: 'websocket' },
      })
      request.on('upgrade', (_response, socket, head) => {
        // Bytes written right after the 101 arrive in `head`; anything later
        // arrives as a normal socket read.
        if (head?.length) {
          socket.destroy()
          resolve(head.toString('utf8'))
          return
        }
        socket.once('data', (chunk) => {
          socket.destroy()
          resolve(chunk.toString('utf8'))
        })
      })
      request.on('error', reject)
      request.end()
    })

    assert.equal(received, 'hmr-hello')
  } finally {
    for (const socket of upstreamTunnels) socket.destroy()
    await gateway.close()
    await closeServer(upstreamServer)
  }
})

test('closes an upgrade cleanly while the upstream is unavailable', async () => {
  const gateway = createDevRuntimeGateway({
    token: TOKEN,
    env: {},
    getStatus: () => ({ health: 'unavailable' }),
    renderSplashHtml: () => SPLASH_MARKER,
    resolveUpstream: () => null,
  })
  const publicPort = (await gateway.listen(0, '127.0.0.1')).port

  try {
    const statusLine = await new Promise((resolve, reject) => {
      const request = http.request({
        host: '127.0.0.1',
        port: publicPort,
        path: '/_next/webpack-hmr',
        headers: { connection: 'Upgrade', upgrade: 'websocket' },
      })
      request.on('response', (response) => resolve(response.statusCode))
      request.on('upgrade', () => resolve('upgraded'))
      request.on('error', reject)
      request.end()
    })

    assert.equal(statusLine, 503)
  } finally {
    await gateway.close()
  }
})

test('rejects a control request from a non-local host header', async () => {
  const gateway = createDevRuntimeGateway({
    token: TOKEN,
    env: {},
    getStatus: () => ({ health: 'ready' }),
    renderSplashHtml: () => SPLASH_MARKER,
    resolveUpstream: () => null,
  })
  const publicPort = (await gateway.listen(0, '127.0.0.1')).port

  try {
    const status = await new Promise((resolve, reject) => {
      const request = http.request({
        host: '127.0.0.1',
        port: publicPort,
        path: '/__open-mercato/status',
        headers: { host: 'evil.example' },
      }, (response) => {
        response.resume()
        resolve(response.statusCode)
      })
      request.on('error', reject)
      request.end()
    })

    assert.equal(status, 403)
  } finally {
    await gateway.close()
  }
})
