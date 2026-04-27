// Reusable URL helpers for dev splash variants (monorepo dev orchestrator,
// ephemeral dev runtime, and the standalone create-app template). Pure ESM,
// dependency-free so the dev scripts can use it before `yarn install` runs.
//
// All splash variants share the same problem: they used to hardcode
// `http://localhost:<port>` / `http://127.0.0.1:<port>` for both the
// splash URL and the printed app URL. When a developer runs the dev
// runtime behind a reverse proxy (for example on
// `https://devsandbox.openmercato.com`), the printed URLs and any
// redirects must follow the configured public base URL, drop standard
// ports for the scheme (80 for `http:`, 443 for `https:`), and only
// fall back to the actually-bound port when the configured port was
// taken and the runtime had to randomize.

const STANDARD_PORT_BY_SCHEME = Object.freeze({
  'http:': 80,
  'https:': 443,
})

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0'])

export function parsePortNumber(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const parsed = Number.parseInt(String(value).trim(), 10)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    return null
  }
  return parsed
}

export function isStandardPort(scheme, port) {
  if (port === null || port === undefined) return false
  const normalized = typeof scheme === 'string' && !scheme.endsWith(':') ? `${scheme}:` : scheme
  const expected = STANDARD_PORT_BY_SCHEME[normalized]
  return expected !== undefined && Number(port) === expected
}

export function parseConfiguredBaseUrl(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  let parsed
  try {
    parsed = new URL(trimmed)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  const explicitPort = parsed.port ? Number.parseInt(parsed.port, 10) : null
  return {
    protocol: parsed.protocol,
    hostname: parsed.hostname,
    port: Number.isInteger(explicitPort) ? explicitPort : null,
  }
}

export function formatBaseUrl({ protocol, hostname, port } = {}, options = {}) {
  if (typeof protocol !== 'string' || !protocol || typeof hostname !== 'string' || !hostname) {
    throw new TypeError('formatBaseUrl requires a protocol and hostname')
  }
  const normalizedScheme = protocol.endsWith(':') ? protocol : `${protocol}:`
  const includeStandardPort = options.includeStandardPort === true
  const formattedHost = hostname.includes(':') && !hostname.startsWith('[')
    ? `[${hostname}]`
    : hostname
  if (port === null || port === undefined) {
    return `${normalizedScheme}//${formattedHost}`
  }
  if (!includeStandardPort && isStandardPort(normalizedScheme, port)) {
    return `${normalizedScheme}//${formattedHost}`
  }
  return `${normalizedScheme}//${formattedHost}:${port}`
}

function pickConfiguredFromEnv(env) {
  return parseConfiguredBaseUrl(env?.APP_URL) ?? parseConfiguredBaseUrl(env?.NEXT_PUBLIC_APP_URL)
}

// Resolve the developer-facing app base URL.
//
// Inputs:
//   env: process.env-like object. Reads APP_URL, NEXT_PUBLIC_APP_URL, PORT.
//   options.actualPort: the port the dev server actually bound to. When the
//     configured port was already in use, this differs from the configured
//     value -- in that case we treat the run as randomized and surface the
//     actually-bound port so the printed URL is reachable.
//   options.defaultPort: the port to assume when nothing else is configured
//     (defaults to 3000, matching Next.js dev defaults).
//   options.defaultHostname: fallback hostname when no APP_URL is configured
//     (defaults to 'localhost').
//
// Returns:
//   { url, protocol, hostname, port, hasConfiguredBaseUrl, portWasRandomized }
//   `port` is null when the URL omits an explicit port.
export function resolveDevBaseUrl(env = {}, options = {}) {
  const actualPort = Number.isInteger(options.actualPort) ? options.actualPort : null
  const defaultPort = Number.isInteger(options.defaultPort) ? options.defaultPort : 3000
  const defaultHostname = typeof options.defaultHostname === 'string' && options.defaultHostname
    ? options.defaultHostname
    : 'localhost'

  const configured = pickConfiguredFromEnv(env)
  const envPort = parsePortNumber(env?.PORT)

  let protocol
  let hostname
  let configuredPort

  if (configured) {
    protocol = configured.protocol
    hostname = configured.hostname
    configuredPort = configured.port ?? envPort
  } else {
    protocol = 'http:'
    hostname = defaultHostname
    configuredPort = envPort
  }

  let resolvedPort
  let portWasRandomized = false

  if (actualPort !== null) {
    if (configuredPort !== null && configuredPort !== actualPort) {
      // Configured port was taken; the runtime fell back to a free one. The
      // printed URL must reflect what the developer can actually open.
      resolvedPort = actualPort
      portWasRandomized = true
    } else if (configuredPort !== null) {
      resolvedPort = configuredPort
    } else if (configured && !LOOPBACK_HOSTS.has(hostname.toLowerCase())) {
      // Configured URL has no explicit port (e.g. https://devsandbox.openmercato.com).
      // The dev server is fronted by a reverse proxy on the standard port for
      // the scheme; the locally-bound `actualPort` is internal and must not
      // leak into the printed URL.
      resolvedPort = null
    } else {
      resolvedPort = actualPort
    }
  } else if (configuredPort !== null) {
    resolvedPort = configuredPort
  } else if (configured) {
    resolvedPort = null
  } else {
    resolvedPort = defaultPort
  }

  if (resolvedPort !== null && isStandardPort(protocol, resolvedPort)) {
    resolvedPort = null
  }

  const url = formatBaseUrl({ protocol, hostname, port: resolvedPort })

  return {
    url,
    protocol,
    hostname,
    port: resolvedPort,
    hasConfiguredBaseUrl: configured !== null,
    portWasRandomized,
  }
}

// Resolve the URL where the dev splash itself can be reached. The splash
// process always binds locally, but the developer's browser may live on
// the configured public host (proxy-fronted dev sandboxes). We keep the
// scheme + hostname from the configured public URL when it exists so the
// splash link the developer sees uses the same origin as the rest of the
// app, and we always attach the actually-bound splash port so the link
// resolves regardless of what the configured port was.
export function resolveSplashUrl(env = {}, splashPort, options = {}) {
  const port = Number.isInteger(splashPort) ? splashPort : null
  const configured = pickConfiguredFromEnv(env)
  const defaultHostname = typeof options.defaultHostname === 'string' && options.defaultHostname
    ? options.defaultHostname
    : 'localhost'

  if (!configured) {
    if (port === null) {
      return formatBaseUrl({ protocol: 'http:', hostname: defaultHostname, port: null })
    }
    return formatBaseUrl({ protocol: 'http:', hostname: defaultHostname, port })
  }

  if (port === null) {
    return formatBaseUrl({ protocol: configured.protocol, hostname: configured.hostname, port: null })
  }

  return formatBaseUrl({ protocol: configured.protocol, hostname: configured.hostname, port })
}
