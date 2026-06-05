const LOCAL_HOST_NAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

function parseHostHeader(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('[')) {
    const closingBracket = trimmed.indexOf(']')
    if (closingBracket === -1) return null
    return trimmed.slice(0, closingBracket + 1).toLowerCase()
  }
  const colon = trimmed.lastIndexOf(':')
  const host = colon === -1 ? trimmed : trimmed.slice(0, colon)
  return host.toLowerCase()
}

export function isLocalSplashHost(value) {
  const host = parseHostHeader(value)
  if (!host) return false
  return LOCAL_HOST_NAMES.has(host)
}

// Missing/empty Origin is acceptable (non-browser CLIs do not always send one).
// Literal `"null"` is the sentinel browsers send from sandboxed iframes / opaque
// origins, so it must be rejected. Parsable origins must resolve to a local host.
export function isAcceptableSplashOrigin(originHeader) {
  if (originHeader == null) return true
  const trimmed = String(originHeader).trim()
  if (trimmed === '') return true
  if (trimmed === 'null') return false
  let parsed
  try {
    parsed = new URL(trimmed)
  } catch {
    return false
  }
  return isLocalSplashHost(parsed.host)
}

export function assertLocalSplashRequest(req) {
  const headers = req?.headers ?? {}
  if (!isLocalSplashHost(headers.host)) {
    return {
      ok: false,
      status: 403,
      error: 'Splash actions are only accessible from the local development host.',
    }
  }
  if (!isAcceptableSplashOrigin(headers.origin)) {
    return {
      ok: false,
      status: 403,
      error: 'Splash actions are only accessible from the splash origin.',
    }
  }
  return { ok: true }
}

// Splash bind defaults to loopback. Operators who deliberately want network-
// reachable splash (for example a container exposing the splash port to the
// host) opt in via OM_DEV_SPLASH_BIND. The Host/Origin guard on action
// endpoints defends browsers against DNS rebinding, but it CANNOT stop a
// network-resident attacker from spoofing Host/Origin headers with a raw HTTP
// client — the opt-in is "I trust everything that can reach this port".
export function resolveSplashBindHost(env = process.env, logger = console) {
  const raw = typeof env?.OM_DEV_SPLASH_BIND === 'string'
    ? env.OM_DEV_SPLASH_BIND.trim()
    : ''
  const normalized = raw.toLowerCase()
  if (normalized === '0.0.0.0' || normalized === 'all') {
    logger?.warn?.('⚠️  OM_DEV_SPLASH_BIND=0.0.0.0 — splash server is reachable from the network. Mutating action endpoints (GitHub publish, coding tool spawn) become exposed to anyone who can reach this port; the Host/Origin guard only stops browser-based DNS rebinding, not raw HTTP clients. Only enable on trusted networks.')
    return '0.0.0.0'
  }
  if (normalized === '::' || normalized === '::0') {
    logger?.warn?.('⚠️  OM_DEV_SPLASH_BIND=:: — splash server is reachable from the network. Mutating action endpoints become exposed to anyone who can reach this port. Only enable on trusted networks.')
    return '::'
  }
  if (normalized === '::1') return '::1'
  if (normalized === '127.0.0.1' || normalized === 'localhost') return '127.0.0.1'
  if (normalized) {
    logger?.warn?.(`⚠️  Unrecognized OM_DEV_SPLASH_BIND="${raw}" — falling back to loopback (127.0.0.1).`)
  }
  return '127.0.0.1'
}
