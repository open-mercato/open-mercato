/**
 * Runtime config + pure guardrail helpers for the agent web-search/fetch tools
 * (spec: .ai/specs/enterprise/2026-07-11-agent-web-search-tool.md). All values
 * are read from `OM_AGENT_WEB_SEARCH_*` env, with permissive defaults. The
 * always-on SSRF guard lives in the provider package and is NOT configurable
 * here — this layer adds domain allow/deny, caps, and rate ceilings on top.
 */
/** Selected search provider. Default `model` = reuse the agent's own LLM web_search. */
export type WebSearchProviderId = 'model' | 'tavily' | 'brave' | 'exa' | 'searxng' | 'none'

const PROVIDER_IDS: readonly WebSearchProviderId[] = ['model', 'tavily', 'brave', 'exa', 'searxng', 'none']

export type WebSearchRuntimeConfig = {
  /** Selected search provider (`OM_AGENT_WEB_SEARCH_PROVIDER`), default `model`. */
  provider: WebSearchProviderId
  /** SearXNG base URL (only used when provider = `searxng`); null when unset. */
  baseUrl: string | null
  /** Tavily API key (only used when provider = `tavily`); null when unset. */
  tavilyApiKey: string | null
  maxResults: number
  maxBytes: number
  timeoutMs: number
  allowDomains: string[]
  denyDomains: string[]
  ratePerRun: number
  ratePerTenantPerMinute: number
}

function parseProvider(raw: string | undefined): WebSearchProviderId {
  const value = (raw ?? '').trim().toLowerCase()
  return (PROVIDER_IDS as readonly string[]).includes(value) ? (value as WebSearchProviderId) : 'model'
}

const DEFAULTS = {
  maxResults: 10,
  maxBytes: 64 * 1024,
  timeoutMs: 10_000,
  ratePerRun: 20,
  ratePerTenantPerMinute: 120,
} as const

function positiveInt(raw: string | undefined, fallback: number): number {
  const value = Number.parseInt((raw ?? '').trim(), 10)
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function domainList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0)
}

export function resolveWebSearchConfig(env: NodeJS.ProcessEnv = process.env): WebSearchRuntimeConfig {
  const baseUrl = (env.OM_AGENT_WEB_SEARCH_BASE_URL ?? '').trim()
  const tavilyApiKey = (env.OM_AGENT_WEB_SEARCH_TAVILY_API_KEY ?? '').trim()
  return {
    provider: parseProvider(env.OM_AGENT_WEB_SEARCH_PROVIDER),
    baseUrl: baseUrl.length > 0 ? baseUrl : null,
    tavilyApiKey: tavilyApiKey.length > 0 ? tavilyApiKey : null,
    maxResults: positiveInt(env.OM_AGENT_WEB_SEARCH_MAX_RESULTS, DEFAULTS.maxResults),
    maxBytes: positiveInt(env.OM_AGENT_WEB_FETCH_MAX_BYTES, DEFAULTS.maxBytes),
    timeoutMs: positiveInt(env.OM_AGENT_WEB_SEARCH_TIMEOUT_MS, DEFAULTS.timeoutMs),
    allowDomains: domainList(env.OM_AGENT_WEB_SEARCH_ALLOW_DOMAINS),
    denyDomains: domainList(env.OM_AGENT_WEB_SEARCH_DENY_DOMAINS),
    ratePerRun: positiveInt(env.OM_AGENT_WEB_SEARCH_RATE_PER_RUN, DEFAULTS.ratePerRun),
    ratePerTenantPerMinute: positiveInt(
      env.OM_AGENT_WEB_SEARCH_RATE_PER_TENANT_PER_MINUTE,
      DEFAULTS.ratePerTenantPerMinute,
    ),
  }
}

export function hostnameOf(rawUrl: string): string | null {
  try {
    return new URL(rawUrl).hostname.toLowerCase()
  } catch {
    return null
  }
}

/**
 * Domain guardrail: deny wins over allow; an allowlist (when non-empty) means
 * only listed domains and their subdomains pass. Matching is exact host or a
 * dot-boundary suffix so `example.com` also matches `news.example.com` but not
 * `notexample.com`.
 */
export function isHostAllowed(
  hostname: string,
  config: Pick<WebSearchRuntimeConfig, 'allowDomains' | 'denyDomains'>,
): boolean {
  const host = hostname.toLowerCase()
  const matches = (domain: string): boolean => host === domain || host.endsWith(`.${domain}`)
  if (config.denyDomains.some(matches)) return false
  if (config.allowDomains.length > 0) return config.allowDomains.some(matches)
  return true
}
