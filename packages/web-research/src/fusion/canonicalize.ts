export type CanonicalUrl = {
  /** Cleaned URL suitable for display and re-fetching. */
  readonly url: string
  /** Aggressively normalized form used only for dedup. */
  readonly key: string
  readonly domain: string
}

const TRACKING_PARAMS = new Set([
  'fbclid',
  'gclid',
  'gclsrc',
  'dclid',
  'msclkid',
  'yclid',
  'twclid',
  'igshid',
  'mc_cid',
  'mc_eid',
  'ref_src',
  'ref_url',
  's_kwcid',
  'vero_id',
  'wickedid',
  '_ga',
  '_gl',
  'spm',
])

/** Query keys carrying the real destination on known redirect hops. */
const REDIRECT_HOSTS: ReadonlyArray<{ host: RegExp; path?: RegExp; params: readonly string[] }> = [
  { host: /(^|\.)duckduckgo\.com$/, path: /^\/l\/?$/, params: ['uddg'] },
  { host: /(^|\.)google\.[a-z.]+$/, path: /^\/url$/, params: ['q', 'url'] },
  { host: /(^|\.)out\.reddit\.com$/, params: ['url'] },
  { host: /(^|\.)steamcommunity\.com$/, path: /^\/linkfilter\/?$/, params: ['url'] },
]

function isTracking(key: string): boolean {
  const lower = key.toLowerCase()
  return lower.startsWith('utm_') || TRACKING_PARAMS.has(lower)
}

function unwrapRedirect(url: URL): URL | null {
  for (const rule of REDIRECT_HOSTS) {
    if (!rule.host.test(url.hostname)) continue
    if (rule.path && !rule.path.test(url.pathname)) continue
    for (const param of rule.params) {
      const target = url.searchParams.get(param)
      if (!target) continue
      try {
        const parsed = new URL(target)
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed
      } catch {
        continue
      }
    }
  }
  return null
}

/**
 * Normalizes a result URL for display and produces a separate dedup key. The two
 * differ on purpose: the key folds `www.` and the scheme so the same page found
 * by two adapters collapses into one hit, while the displayed URL stays faithful
 * enough to fetch.
 */
export function canonicalizeUrl(raw: string): CanonicalUrl | null {
  let parsed: URL
  try {
    parsed = new URL(raw.trim())
  } catch {
    return null
  }

  for (let hop = 0; hop < 3; hop += 1) {
    const unwrapped = unwrapRedirect(parsed)
    if (!unwrapped) break
    parsed = unwrapped
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  if (parsed.hostname.length === 0) return null

  parsed.hash = ''
  parsed.username = ''
  parsed.password = ''

  const retained = [...parsed.searchParams.entries()].filter(([key]) => !isTracking(key))
  retained.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
  parsed.search = ''
  for (const [key, value] of retained) parsed.searchParams.append(key, value)

  const host = parsed.hostname.toLowerCase()
  parsed.hostname = host
  if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
    parsed.pathname = parsed.pathname.replace(/\/+$/, '')
  }

  const domain = host.startsWith('www.') ? host.slice(4) : host
  const key = `${domain}${parsed.pathname}${parsed.search}`

  return { url: parsed.toString(), key, domain }
}
