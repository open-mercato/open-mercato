const LOCAL_HOST_NAMES = ['localhost', '127.0.0.1', '::1', '[::1]']

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

// Extract a port-less hostname from an allowlist entry. Accepts a full origin
// (`https://foo.example:4000`), a host:port (`foo.example:4000`), or a bare
// hostname (`foo.example`). Returns the hostname lowercased, or null when the
// entry cannot be parsed.
function extractHostFromAllowlistEntry(entry) {
  if (typeof entry !== 'string') return null
  const trimmed = entry.trim()
  if (!trimmed) return null
  try {
    const url = new URL(trimmed)
    // `url.hostname` is port-less ("foo.example" or "[::1]"). `url.host`
    // would include the port and would not match parseHostHeader's output.
    const hostname = url.hostname?.toLowerCase()
    if (hostname) {
      // URL strips IPv6 brackets from hostname; normalize back so it matches
      // the bracketed form that parseHostHeader produces from a Host header.
      return hostname.includes(':') && !hostname.startsWith('[')
        ? `[${hostname}]`
        : hostname
    }
  } catch {
    // Not a valid URL — fall through to host:port parsing.
  }
  return parseHostHeader(trimmed)
}

// Parses an ALLOWED_ORIGINS-style env value (Next.js convention,
// comma-separated origins/hosts). Each entry is reduced to a port-less
// hostname so comparison stays consistent with `parseHostHeader` output.
function parseAllowedOriginsEnv(envValue) {
  if (typeof envValue !== 'string') return []
  return envValue
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map(extractHostFromAllowlistEntry)
    .filter(Boolean)
}

// Resolves the effective allowed-host set. Always includes loopback names;
// extends with hosts from the `ALLOWED_ORIGINS` env var (Next.js convention).
// Sandbox / preview / dev-container deployments add their public hostname
// there to be accepted by the splash action guard without bypassing the
// DNS-rebinding defense.
export function resolveAllowedSplashHosts(env = process.env) {
  const allowed = new Set(LOCAL_HOST_NAMES)
  for (const host of parseAllowedOriginsEnv(env?.ALLOWED_ORIGINS)) {
    allowed.add(host)
  }
  return allowed
}

export function isLocalSplashHost(value, env = process.env) {
  const host = parseHostHeader(value)
  if (!host) return false
  return resolveAllowedSplashHosts(env).has(host)
}

// Missing/empty Origin is acceptable (non-browser CLIs do not always send one).
// Literal `"null"` is the sentinel browsers send from sandboxed iframes / opaque
// origins, so it must be rejected. Parsable origins must resolve to either a
// loopback host or an entry on the `ALLOWED_ORIGINS` allowlist.
export function isAcceptableSplashOrigin(originHeader, env = process.env) {
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
  return isLocalSplashHost(parsed.host, env)
}

export function assertLocalSplashRequest(req, env = process.env) {
  const headers = req?.headers ?? {}
  if (!isLocalSplashHost(headers.host, env)) {
    return {
      ok: false,
      status: 403,
      error: 'Splash actions are only accessible from a loopback host or an entry in ALLOWED_ORIGINS.',
    }
  }
  if (!isAcceptableSplashOrigin(headers.origin, env)) {
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
