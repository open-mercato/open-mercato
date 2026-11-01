type PolicyOptions = {
  env?: Record<string, string | undefined>
  nonce?: string
  scriptOrigins?: readonly string[]
  connectOrigins?: readonly string[]
  frameOrigins?: readonly string[]
}

function configuredOrigins(value: string | undefined, development: boolean, connections = false): string[] {
  if (!value?.trim()) return []
  return value.trim().split(/\s+/).map((source) => {
    if (!URL.canParse(source)) throw new Error('[internal] CSP configuration must contain explicit permitted origins')
    const url = new URL(source)
    const protocols = connections ? ['https:', 'wss:'] : ['https:']
    if (development) protocols.push(...(connections ? ['http:', 'ws:'] : ['http:']))
    if (
      !protocols.includes(url.protocol)
      || url.username || url.password || url.search || url.hash
      || url.pathname !== '/' || !/^(?:[a-z0-9.-]+|\[[0-9a-f:]+\])$/i.test(url.hostname)
      || (source !== url.origin && source !== `${url.origin}/`)
    ) {
      throw new Error('[internal] CSP configuration must contain explicit permitted origins')
    }
    return url.origin
  })
}

export function createContentSecurityPolicy(options: PolicyOptions = {}): string {
  const { env = {}, nonce, scriptOrigins = [], connectOrigins = [], frameOrigins = [] } = options
  const development = env.NODE_ENV === 'development'
  if (nonce !== undefined && !/^[A-Za-z0-9+/]+={0,2}$/.test(nonce)) {
    throw new Error('[internal] Invalid CSP nonce')
  }
  const nonceSource = nonce ? [`'nonce-${nonce}'`] : []
  const scripts = ["'self'", ...nonceSource, ...scriptOrigins, ...configuredOrigins(env.OM_CSP_SCRIPT_ORIGINS, development)]
  const styles = ["'self'", ...nonceSource, ...configuredOrigins(env.OM_CSP_STYLE_ORIGINS, development)]
  const connections = ["'self'", ...connectOrigins, ...configuredOrigins(env.OM_CSP_CONNECT_ORIGINS, development, true)]
  const frames = ["'self'", ...frameOrigins, ...configuredOrigins(env.OM_CSP_FRAME_ORIGINS, development)]
  if (development) {
    scripts.push("'unsafe-inline'", "'unsafe-eval'")
    styles.splice(1, nonceSource.length, "'unsafe-inline'")
    connections.push('ws:', 'wss:')
  }
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "font-src 'self' data: https:",
    "form-action 'self'",
    "frame-ancestors 'self'",
    `frame-src ${[...new Set(frames)].join(' ')}`,
    "img-src 'self' data: blob: https:",
    "object-src 'none'",
    `script-src ${[...new Set(scripts)].join(' ')}`,
    "script-src-attr 'none'",
    `style-src ${[...new Set(styles)].join(' ')}`,
    "style-src-attr 'unsafe-inline'",
    `connect-src ${[...new Set(connections)].join(' ')}`,
  ].join('; ')
}

export function createContentSecurityPolicyRequestHeaders(
  headers: Headers,
  options: Omit<PolicyOptions, 'nonce'> = {},
) {
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))))
  const contentSecurityPolicy = createContentSecurityPolicy({ ...options, nonce })
  const requestHeaders = new Headers(headers)
  requestHeaders.set('x-nonce', nonce)
  requestHeaders.set('Content-Security-Policy', contentSecurityPolicy)
  return { requestHeaders, contentSecurityPolicy }
}
