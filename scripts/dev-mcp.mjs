import { timingSafeEqual } from 'node:crypto'
import http from 'node:http'
import path from 'node:path'
import { BlockList, createServer, isIP } from 'node:net'
import { stripHopByHopHeaders } from './dev-runtime-gateway.mjs'

export const MCP_DEFAULT_PORT = 3001
export const MCP_MAX_FAST_CRASHES = 5
export const MCP_FAST_CRASH_UPTIME_MS = 60_000
export const MCP_HEALTH_TIMEOUT_MS = 180_000
export const MCP_HEALTH_POLL_INTERVAL_MS = 2_000
export const MCP_MAX_PORT_SELECTION_ATTEMPTS = 5
export const MCP_LAZY_START_TIMEOUT_MS = 60_000
export const MCP_LAZY_MAX_PENDING_REQUESTS = 16

// Shape of every secret `generateApiKeySecret` issues (managed, user and
// session keys alike). Matching it is a format check, not authentication.
const OPEN_MERCATO_API_KEY_PATTERN = /^omk_[0-9a-f]{8}\.[0-9a-f]{48}$/

const ENABLED_TOKENS = ['1', 'true', 'yes', 'on']
const DISABLED_TOKENS = ['0', 'false', 'no', 'off']

// The MCP server runs by default with every dev runtime except the explicit
// app-only mode. CLI flags win over OM_DEV_WITH_MCP; an unrecognized env token
// falls back to the default (on) rather than silently disabling the server.
export function shouldStartMcp({ args = [], env = {}, appOnly = false } = {}) {
  if (appOnly) return false
  if (args.includes('--no-mcp')) return false
  if (args.includes('--with-mcp')) return true
  const raw = env.OM_DEV_WITH_MCP
  if (typeof raw === 'string' && raw.trim() !== '') {
    const token = raw.trim().toLowerCase()
    if (DISABLED_TOKENS.includes(token)) return false
    if (ENABLED_TOKENS.includes(token)) return true
  }
  return true
}

// The lazy proxy is the default; OM_DEV_MCP_LAZY=0/false/no/off restores the
// eager start, and an unrecognized token keeps the default.
export function shouldStartMcpLazily(env = {}) {
  const raw = env.OM_DEV_MCP_LAZY
  if (typeof raw !== 'string') return true
  return !DISABLED_TOKENS.includes(raw.trim().toLowerCase())
}

/**
 * Bind address for the host-side MCP server `yarn dev` spawns. Loopback unless the
 * OpenCode sidecar needs to reach it: on native Linux `host-gateway` resolves to the
 * bridge IP, which a loopback-only socket refuses, so there (and only there) the server
 * binds 0.0.0.0. Docker Desktop reaches host loopback, so it keeps the default. An
 * explicit MCP_HTTP_HOST always wins. Returns `null` for "no --host flag, use default".
 */
export function resolveDevMcpHost({ platform = process.platform, env = {} } = {}) {
  const explicit = typeof env.MCP_HTTP_HOST === 'string' ? env.MCP_HTTP_HOST.trim() : ''
  if (explicit) return explicit
  if (platform === 'linux') return '0.0.0.0'
  return null
}

export function resolveMcpPort(env = {}) {
  const raw = typeof env.MCP_PORT === 'string' ? env.MCP_PORT.trim() : ''
  if (!raw) return MCP_DEFAULT_PORT
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) return MCP_DEFAULT_PORT
  return parsed
}

function probeMcpBind(port, host) {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen({ port, host, exclusive: true }, () => {
      const address = server.address()
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }
        resolve(typeof address === 'object' && address ? address.port : port)
      })
    })
  })
}

async function probeMcpPort(port) {
  const selectedPort = await probeMcpBind(port)
  for (const host of ['0.0.0.0', '127.0.0.1', '::1']) {
    try {
      await probeMcpBind(selectedPort, host)
    } catch (error) {
      if (host === '::1' && ['EAFNOSUPPORT', 'EADDRNOTAVAIL', 'EPROTONOSUPPORT'].includes(error?.code)) continue
      throw error
    }
  }
  return selectedPort
}

export async function selectAvailableMcpPort(preferredPort, options = {}) {
  const maxAttempts = Number.isInteger(options.maxAttempts) && options.maxAttempts > 0
    ? options.maxAttempts
    : MCP_MAX_PORT_SELECTION_ATTEMPTS

  try {
    return await probeMcpPort(preferredPort)
  } catch (error) {
    if (error?.code !== 'EADDRINUSE' && error?.code !== 'EACCES') throw error
  }

  let lastError = null
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await probeMcpPort(0)
    } catch (error) {
      lastError = error
    }
  }

  throw new Error(`Unable to select a free MCP port after ${maxAttempts} attempts`, { cause: lastError })
}

// The key file is shared with the OpenCode container via a bind mount
// (compose.infra.yml mounts .mercato/mcp-shared read-only at /run/mcp-shared),
// so the default must stay in sync with that compose file.
export function resolveMcpKeyFilePath(env = {}, cwd = process.cwd()) {
  const override = typeof env.MCP_SERVER_API_KEY_FILE === 'string' ? env.MCP_SERVER_API_KEY_FILE.trim() : ''
  if (override) return path.resolve(cwd, override)
  return path.join(cwd, '.mercato', 'mcp-shared', 'mcp-api-key')
}

export function nextMcpRestartDelayMs(attempt) {
  const normalized = Number.isInteger(attempt) && attempt > 0 ? attempt : 0
  return Math.min(5_000 * 2 ** normalized, 60_000)
}

export function nextMcpKeyRetryDelayMs(attempt) {
  const normalized = Number.isInteger(attempt) && attempt > 0 ? attempt : 0
  return Math.min(30_000 * 2 ** normalized, 120_000)
}

export function isFastMcpCrash(uptimeMs) {
  return typeof uptimeMs === 'number' && uptimeMs >= 0 && uptimeMs < MCP_FAST_CRASH_UPTIME_MS
}

export function buildMcpCliArgs(subcommandArgs) {
  return ['ai_assistant', ...subcommandArgs]
}

export function deriveMcpHealthUrl(port) {
  return `http://localhost:${port}/health`
}

export function buildManagedMcpAppEnv({ enabled, port, keyFilePath, env = {} }) {
  if (!enabled) return {}
  return {
    ...(!env.MCP_SERVER_API_KEY && !env.MCP_SERVER_API_KEY_FILE
      ? { MCP_SERVER_API_KEY_FILE: keyFilePath }
      : {}),
    ...(!env.MCP_URL ? { MCP_URL: `http://localhost:${port}` } : {}),
  }
}

export function isManagedMcpReadiness({ childListening, childExitCode, childSignalCode, attemptedPort, currentPort, responseOk }) {
  return childListening === true
    && childExitCode === null
    && childSignalCode === null
    && attemptedPort === currentPort
    && responseOk === true
}

function matchesKnownKey(candidate, knownKeys) {
  const provided = Buffer.from(candidate)
  let matched = false
  for (const key of knownKeys) {
    const expected = Buffer.from(key)
    if (expected.length === provided.length && timingSafeEqual(expected, provided)) matched = true
  }
  return matched
}

/**
 * Known runner keys authorize cold-start work from any peer. Other issued keys
 * remain usable from trusted peers; only the real server can authenticate them.
 * A public key format alone must never authorize an untrusted network peer.
 */
export function mayWakeMcpServer(apiKeyHeader, knownKeys = [], trustedPeer = false) {
  const candidate = Array.isArray(apiKeyHeader) ? apiKeyHeader[0] : apiKeyHeader
  if (typeof candidate !== 'string' || candidate === '') return false
  return matchesKnownKey(candidate, knownKeys.filter((key) => typeof key === 'string' && key !== ''))
    || (trustedPeer && OPEN_MERCATO_API_KEY_PATTERN.test(candidate))
}

function createTrustedMcpPeers(peers) {
  const addresses = new BlockList()
  for (const peer of peers) {
    const address = peer.trim()
    const family = isIP(address)
    if (family) addresses.addAddress(address, family === 6 ? 'ipv6' : 'ipv4')
  }
  return addresses
}

/**
 * Owns the public MCP port so `yarn dev` does not keep the MCP server resident
 * until a client needs it. While no upstream is published, `/health` is
 * answered in-process with the real server's shape (`status`, `tools`,
 * `timestamp`) plus `lazy: true`, reporting `tools: 0` because nothing is
 * loaded: 503 until `arm()`, then 200. After `arm(knownKeys)` the first request
 * whose `x-api-key` passes `mayWakeMcpServer` resolves `firstUse` and waits
 * for `setUpstream()` (at most `maxPendingRequests` at once); from then on
 * every request is streamed to the real server unbuffered.
 */
export function createLazyMcpProxy({
  upstreamTimeoutMs = MCP_LAZY_START_TIMEOUT_MS,
  maxPendingRequests = MCP_LAZY_MAX_PENDING_REQUESTS,
  trustedPeers = ['127.0.0.1', '::1'],
} = {}) {
  let armed = false
  let knownKeys = []
  let upstream = null
  let notifyFirstUse = () => {}
  const firstUse = new Promise((resolve) => { notifyFirstUse = resolve })
  const waiters = new Set()
  const trustedAddresses = createTrustedMcpPeers(trustedPeers)

  function sendJson(req, res, status, payload) {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    res.end(req.method === 'HEAD' ? undefined : JSON.stringify(payload))
  }

  function waitForUpstream(res) {
    return new Promise((resolve) => {
      const settle = (outcome) => {
        clearTimeout(timer)
        res.off('close', onClose)
        waiters.delete(settle)
        resolve(outcome)
      }
      const onClose = () => settle('closed')
      const timer = setTimeout(settle, upstreamTimeoutMs, 'timeout')
      res.once('close', onClose)
      waiters.add(settle)
    })
  }

  function forward(req, res, target) {
    const upstreamRequest = http.request({
      host: target.host,
      port: target.port,
      method: req.method,
      path: req.url,
      headers: stripHopByHopHeaders(req.headers),
      agent: false,
    }, (upstreamResponse) => {
      res.writeHead(upstreamResponse.statusCode ?? 502, stripHopByHopHeaders(upstreamResponse.headers))
      res.flushHeaders()
      upstreamResponse.on('error', () => res.destroy())
      upstreamResponse.pipe(res)
    })
    upstreamRequest.on('error', () => {
      if (res.headersSent || res.destroyed) {
        res.destroy()
        return
      }
      sendJson(req, res, 502, { error: 'MCP server did not answer' })
    })
    res.on('close', () => { if (!res.writableFinished) upstreamRequest.destroy() })
    req.pipe(upstreamRequest)
  }

  const server = http.createServer((req, res) => {
    if (!upstream && (req.url ?? '/').split('?')[0] === '/health') {
      sendJson(req, res, armed ? 200 : 503, {
        status: armed ? 'ok' : 'starting',
        tools: 0,
        lazy: true,
        timestamp: new Date().toISOString(),
      })
      return
    }
    if (upstream) {
      forward(req, res, upstream)
      return
    }
    if (!armed) {
      sendJson(req, res, 503, { error: 'MCP server is not ready yet' })
      return
    }
    const remoteAddress = req.socket.remoteAddress
    const trustedPeer = remoteAddress && trustedAddresses.check(remoteAddress, isIP(remoteAddress) === 6 ? 'ipv6' : 'ipv4')
    if (!mayWakeMcpServer(req.headers['x-api-key'], knownKeys, trustedPeer)) {
      sendJson(req, res, 401, {
        error: req.headers['x-api-key'] ? 'Invalid or expired API key' : 'API key required (x-api-key header)',
      })
      return
    }
    if (waiters.size >= maxPendingRequests) {
      res.setHeader('retry-after', '5')
      sendJson(req, res, 429, { error: 'MCP server is starting; too many pending requests' })
      return
    }
    notifyFirstUse()
    void waitForUpstream(res).then((outcome) => {
      if (outcome === 'closed') return
      if (outcome === 'ready' && upstream) forward(req, res, upstream)
      else sendJson(req, res, 503, { error: 'MCP server did not become ready' })
    })
  })

  return {
    server,
    firstUse,
    arm(keys = []) {
      knownKeys = keys.filter((key) => typeof key === 'string' && key !== '')
      armed = true
    },
    setUpstream(target) {
      upstream = target
      if (!target) return
      for (const settle of [...waiters]) settle('ready')
    },
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
      for (const settle of [...waiters]) settle('closed')
      return new Promise((resolve) => {
        if (!server.listening) {
          resolve()
          return
        }
        server.close(() => resolve())
        server.closeAllConnections()
      })
    },
  }
}

export function looksLikeMcpPortCollision(outputLines = []) {
  return outputLines.some((line) => /EADDRINUSE|address already in use/i.test(String(line)))
}

export function looksLikeMcpServerListening(outputLines = []) {
  return outputLines.some((line) => /Server listening/i.test(String(line)))
}

export function looksLikePermissionError(outputLines = []) {
  return outputLines.some((line) => /EACCES|EPERM|permission denied/i.test(String(line)))
}

export function looksLikeUninitializedDatabase(outputLines = []) {
  return outputLines.some((line) =>
    /relation .* does not exist|database .* does not exist|ECONNREFUSED/i.test(String(line)),
  )
}

// `mcp:ensure-api-key` resolves the key's owner by the superadmin email in the
// null-tenant scope and throws when no user matches — the app is up but the DB
// was seeded under a different admin email or a different LOOKUP_HASH_PEPPER.
export function looksLikeMissingKeyOwner(outputLines = []) {
  return outputLines.some((line) =>
    /MCP API key owner not found|no active user with email|Run "?mercato init"?/i.test(String(line)),
  )
}

// The CLI dispatcher exits 1 with `Module not found: "ai_assistant"` when the
// app intentionally omits the module (empty/wms starter presets). That is a
// configuration state, not a transient startup failure, so it must not be retried.
export function looksLikeMissingAiAssistantModule(outputLines = []) {
  return outputLines.some((line) => /Module not found: "ai_assistant"(?![\w-])/.test(String(line)))
}

export function shouldRetryMcpProvisioning(outputLines = []) {
  return !looksLikeMissingAiAssistantModule(outputLines)
}

export function isKeyRotationOutput(outputLines = []) {
  return outputLines.some((line) => String(line).includes('New key created'))
}
