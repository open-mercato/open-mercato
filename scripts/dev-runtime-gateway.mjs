import http from 'node:http'

import { isMatchingDevRuntimeToken, validateBrowserReport } from './dev-runtime-diagnostics.mjs'
import { assertLocalSplashRequest } from './dev-splash-shared.mjs'
import { RUNTIME_RECOVERY_ACTIONS } from './dev-runtime-state.mjs'

export const GATEWAY_NAMESPACE = '/__open-mercato'
export const DEV_RUNTIME_TOKEN_HEADER = 'x-om-dev-runtime-token'

// RFC 7230 hop-by-hop headers. They describe a single transport link and must
// never be forwarded across the proxy boundary.
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

const MAX_DIAGNOSTIC_BODY_BYTES = 8192
const SERVE_SPLASH_HEALTH = new Set(['starting', 'recovering', 'unavailable'])

export function isGatewayControlPath(pathname) {
  return pathname === GATEWAY_NAMESPACE || pathname.startsWith(`${GATEWAY_NAMESPACE}/`)
}

// A navigation is what a developer sees in the address bar. Only navigations
// may be answered with splash HTML — an API or asset request must always reach
// the upstream so a business 4xx/5xx is never masked.
export function isNavigationRequest(method, pathname, headers = {}) {
  if (method !== 'GET' && method !== 'HEAD') return false
  if (isGatewayControlPath(pathname)) return false
  if (pathname.startsWith('/api/') || pathname.startsWith('/_next/')) return false
  if (headers['x-requested-with']) return false
  // Browsers label a real navigation `sec-fetch-mode: navigate`; every other
  // value (`cors`, `no-cors`, `same-origin`) is a programmatic fetch that must
  // reach the upstream even though it may accept HTML.
  const fetchMode = headers['sec-fetch-mode']
  if (typeof fetchMode === 'string' && fetchMode !== 'navigate') return false
  const accept = typeof headers.accept === 'string' ? headers.accept : ''
  return accept.includes('text/html')
}

export function stripHopByHopHeaders(headers) {
  const forwarded = {}
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (HOP_BY_HOP_HEADERS.has(name.toLowerCase())) continue
    forwarded[name] = value
  }
  return forwarded
}

function resolveForwardedProto(req) {
  return req.socket?.encrypted ? 'https' : 'http'
}

export function buildUpstreamHeaders(req, upstream) {
  const headers = stripHopByHopHeaders(req.headers)
  const originalHost = typeof req.headers.host === 'string' ? req.headers.host : ''

  headers.host = `${upstream.host}:${upstream.port}`
  headers['x-forwarded-host'] = originalHost
  headers['x-forwarded-proto'] = resolveForwardedProto(req)
  headers['x-forwarded-for'] = [req.headers['x-forwarded-for'], req.socket?.remoteAddress]
    .filter(Boolean)
    .join(', ')

  // The upstream validates Origin against its own host. Rewriting it to the
  // internal address keeps Next's server-action origin check satisfied while
  // the developer keeps browsing the public port.
  if (typeof req.headers.origin === 'string' && originalHost && req.headers.origin.includes(originalHost)) {
    headers.origin = `${resolveForwardedProto(req)}://${upstream.host}:${upstream.port}`
  }

  return headers
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(body)
}

function sendJsonError(res, status, code, message) {
  sendJson(res, status, { error: { code, message } })
}

function readRequestBody(req, maxBytes) {
  return new Promise((resolve) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > maxBytes) {
        req.destroy()
        resolve({ ok: false })
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve({ ok: true, body: Buffer.concat(chunks).toString('utf8') }))
    req.on('error', () => resolve({ ok: false }))
  })
}

/**
 * Opt-in development gateway. It owns the public port, answers the
 * `/__open-mercato/*` control namespace itself, serves splash feedback for
 * navigations while the runtime cannot serve, and otherwise streams traffic to
 * the managed Next.js upstream — including raw HMR `upgrade` forwarding.
 *
 * It is a development aid, never a production reverse proxy.
 */
export function createDevRuntimeGateway(options = {}) {
  const getStatus = typeof options.getStatus === 'function' ? options.getStatus : () => null
  const getDiagnosticLines = typeof options.getDiagnosticLines === 'function' ? options.getDiagnosticLines : () => ({ lines: [], nextCursor: 0, generation: 0 })
  const recordBrowserReport = typeof options.recordBrowserReport === 'function' ? options.recordBrowserReport : () => null
  const runAction = typeof options.runAction === 'function' ? options.runAction : null
  const resolveUpstream = typeof options.resolveUpstream === 'function' ? options.resolveUpstream : () => null
  const renderSplashHtml = typeof options.renderSplashHtml === 'function' ? options.renderSplashHtml : () => '<!doctype html><title>Open Mercato Dev</title>'
  const env = options.env ?? process.env
  const token = typeof options.token === 'string' ? options.token : null
  const logger = options.logger ?? console

  function isAuthorized(req) {
    return isMatchingDevRuntimeToken(token, req.headers[DEV_RUNTIME_TOKEN_HEADER])
  }

  function currentHealth() {
    return getStatus()?.health ?? 'starting'
  }

  async function handleControlRequest(req, res, url) {
    const guard = assertLocalSplashRequest(req, env)
    if (!guard.ok) {
      sendJsonError(res, guard.status, 'forbidden', guard.error)
      return
    }

    if (req.method === 'GET' && url.pathname === `${GATEWAY_NAMESPACE}/status`) {
      const status = getStatus()
      if (!status) {
        sendJsonError(res, 404, 'not_found', 'Runtime status is not available.')
        return
      }
      sendJson(res, 200, status)
      return
    }

    if (req.method === 'GET' && url.pathname === `${GATEWAY_NAMESPACE}/logs`) {
      const raw = url.searchParams.get('cursor')
      // A malformed cursor restarts the snapshot rather than failing the view.
      const parsed = Number.parseInt(raw ?? '', 10)
      sendJson(res, 200, getDiagnosticLines(Number.isInteger(parsed) && parsed >= 0 ? parsed : 0))
      return
    }

    if (req.method === 'POST' && url.pathname === `${GATEWAY_NAMESPACE}/diagnostics`) {
      if (!isAuthorized(req)) {
        sendJsonError(res, 403, 'forbidden', 'Invalid dev runtime token.')
        return
      }
      const body = await readRequestBody(req, MAX_DIAGNOSTIC_BODY_BYTES)
      if (!body.ok) {
        sendJsonError(res, 400, 'report_too_large', 'Diagnostic report exceeds the size limit.')
        return
      }
      const validated = validateBrowserReport(body.body, { maxBytes: MAX_DIAGNOSTIC_BODY_BYTES })
      if (!validated.ok) {
        sendJsonError(res, validated.status, validated.error.code, validated.error.message)
        return
      }
      const issueId = recordBrowserReport(validated.report)
      sendJson(res, 202, { accepted: true, issueId: issueId ?? null })
      return
    }

    if (req.method === 'POST' && url.pathname.startsWith(`${GATEWAY_NAMESPACE}/actions/`)) {
      if (!isAuthorized(req)) {
        sendJsonError(res, 403, 'forbidden', 'Invalid dev runtime token.')
        return
      }
      if (!runAction) {
        sendJsonError(res, 503, 'supervisor_unavailable', 'The supervisor cannot run recovery actions.')
        return
      }
      const action = url.pathname.slice(`${GATEWAY_NAMESPACE}/actions/`.length)
      if (!RUNTIME_RECOVERY_ACTIONS.includes(action)) {
        sendJsonError(res, 400, 'unknown_action', 'Unknown recovery action.')
        return
      }
      const result = await runAction(action)
      if (!result?.ok) {
        sendJsonError(res, result?.status ?? 409, result?.code ?? 'conflict', result?.message ?? 'The action could not be queued.')
        return
      }
      sendJson(res, 202, { accepted: true, actionId: result.actionId, generation: result.generation })
      return
    }

    sendJsonError(res, 404, 'not_found', 'Unknown dev runtime control route.')
  }

  function serveSplash(req, res) {
    res.statusCode = 200
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.setHeader('cache-control', 'no-store')
    res.end(req.method === 'HEAD' ? '' : renderSplashHtml(req))
  }

  function proxyRequest(req, res, upstream) {
    const proxied = http.request({
      host: upstream.host,
      port: upstream.port,
      method: req.method,
      path: req.url,
      headers: buildUpstreamHeaders(req, upstream),
    }, (upstreamResponse) => {
      res.statusCode = upstreamResponse.statusCode ?? 502
      for (const [name, value] of Object.entries(stripHopByHopHeaders(upstreamResponse.headers))) {
        if (value !== undefined) res.setHeader(name, value)
      }
      upstreamResponse.pipe(res)
    })

    proxied.on('error', (error) => {
      if (res.headersSent) {
        res.destroy()
        return
      }
      if (isNavigationRequest(req.method, new URL(req.url, 'http://localhost').pathname, req.headers)) {
        serveSplash(req, res)
        return
      }
      sendJsonError(res, 502, 'upstream_unavailable', `The development runtime did not answer: ${error.code ?? 'ECONNRESET'}`)
    })

    // Abort propagation both ways so a cancelled download does not leak an
    // upstream request.
    res.on('close', () => { if (!res.writableFinished) proxied.destroy() })
    req.pipe(proxied)
  }

  const server = http.createServer((req, res) => {
    if (!req.url) {
      sendJsonError(res, 400, 'bad_request', 'Missing request target.')
      return
    }

    const url = new URL(req.url, 'http://localhost')

    // Gateway-owned paths are never proxied, even if a module later declares a
    // colliding route.
    if (isGatewayControlPath(url.pathname)) {
      void handleControlRequest(req, res, url)
      return
    }

    const upstream = resolveUpstream()
    const health = currentHealth()
    const navigation = isNavigationRequest(req.method, url.pathname, req.headers)

    if (navigation && SERVE_SPLASH_HEALTH.has(health)) {
      serveSplash(req, res)
      return
    }

    if (!upstream) {
      if (navigation) {
        serveSplash(req, res)
        return
      }
      sendJsonError(res, 503, 'upstream_unavailable', 'The development runtime is not listening yet.')
      return
    }

    proxyRequest(req, res, upstream)
  })

  // An upgraded socket is detached from the server's connection tracking, so
  // shutdown has to tear the tunnels down explicitly or `close()` never
  // settles.
  const tunnelSockets = new Set()

  function trackTunnelSocket(socket) {
    tunnelSockets.add(socket)
    socket.once('close', () => tunnelSockets.delete(socket))
  }

  // HMR rides on a raw WebSocket upgrade, which the request handler above never
  // sees. Forwarding it explicitly is what keeps fast refresh working.
  server.on('upgrade', (req, socket, head) => {
    const upstream = resolveUpstream()
    if (!upstream || !req.url) {
      socket.end('HTTP/1.1 503 Service Unavailable\r\n\r\n')
      return
    }

    // `Connection`/`Upgrade` are hop-by-hop for a normal proxy hop, but they
    // are exactly what makes this hop an upgrade — put them back deliberately.
    const upgradeHeaders = buildUpstreamHeaders(req, upstream)
    upgradeHeaders.connection = 'Upgrade'
    upgradeHeaders.upgrade = req.headers.upgrade ?? 'websocket'

    const proxied = http.request({
      host: upstream.host,
      port: upstream.port,
      method: req.method,
      path: req.url,
      headers: upgradeHeaders,
    })

    proxied.on('upgrade', (upstreamResponse, upstreamSocket, upstreamHead) => {
      const headerLines = Object.entries(upstreamResponse.headers)
        .flatMap(([name, value]) => (Array.isArray(value) ? value.map((item) => `${name}: ${item}`) : [`${name}: ${value}`]))
      socket.write(`HTTP/1.1 101 Switching Protocols\r\n${headerLines.join('\r\n')}\r\n\r\n`)
      // Bytes the upstream already sent past its 101 belong to the tunnel, so
      // push them back before piping instead of dropping them.
      if (upstreamHead?.length) upstreamSocket.unshift(upstreamHead)
      trackTunnelSocket(socket)
      trackTunnelSocket(upstreamSocket)
      upstreamSocket.pipe(socket)
      socket.pipe(upstreamSocket)
      upstreamSocket.on('error', () => socket.destroy())
      socket.on('error', () => upstreamSocket.destroy())
    })

    proxied.on('error', () => {
      socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n')
    })

    socket.on('error', () => proxied.destroy())
    if (head?.length) proxied.write(head)
    // The upgrade request itself carries no body beyond `head`.
    proxied.end()
  })

  return {
    server,
    listen(port, host) {
      return new Promise((resolve, reject) => {
        const handleError = (error) => {
          server.off('listening', handleListening)
          reject(error)
        }
        const handleListening = () => {
          server.off('error', handleError)
          resolve(server.address())
        }
        server.once('error', handleError)
        server.once('listening', handleListening)
        server.listen(port, host)
      })
    },
    close() {
      return new Promise((resolve) => {
        for (const socket of tunnelSockets) socket.destroy()
        tunnelSockets.clear()
        server.close(() => resolve())
        server.closeAllConnections?.()
      })
    },
    logger,
  }
}
