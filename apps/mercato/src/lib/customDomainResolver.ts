import {
  createCustomDomainCache,
  readMaxEntries,
  readNegativeTtlMs,
  readPositiveTtlMs,
  type CustomDomainCache,
  type DomainResolution,
} from './customDomainCache'

const DEFAULT_FETCH_TIMEOUT_MS = 5_000

type ResolveResponse =
  | { ok: true; tenantId: string; organizationId: string; orgSlug: string | null; status: 'active' }
  | { ok: false; error: string }

type ResolveAllResponse =
  | {
      ok: true
      domains: Array<{
        hostname: string
        tenantId: string
        organizationId: string
        orgSlug: string | null
        status: 'active'
      }>
    }
  | { ok: false; error: string }

function readInternalAppOrigin(): string | null {
  const candidates = [
    process.env.INTERNAL_APP_ORIGIN,
    process.env.NEXT_INTERNAL_APP_ORIGIN,
  ].filter((value): value is string => Boolean(value && value.trim().length > 0))
  if (candidates.length > 0) return candidates[0]!.replace(/\/$/, '')
  const port = process.env.PORT?.trim() || '3000'
  return `http://127.0.0.1:${port}`
}

function readResolveSecret(): string | null {
  const secret = process.env.DOMAIN_RESOLVE_SECRET?.trim()
  return secret && secret.length > 0 ? secret : null
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

export type CustomDomainRouterDeps = {
  origin?: string | null
  secret?: string | null
  fetchTimeoutMs?: number
  fetchImpl?: typeof fetch
  logger?: Pick<Console, 'warn' | 'error'>
}

export type CustomDomainRouter = {
  cache: CustomDomainCache
  resolve(hostname: string): Promise<DomainResolution | null>
  warmUp(): Promise<{ primed: number } | { primed: 0; error: string }>
  reset(): void
}

export function createCustomDomainRouter(deps: CustomDomainRouterDeps = {}): CustomDomainRouter {
  const origin = (deps.origin ?? readInternalAppOrigin())?.replace(/\/$/, '') ?? null
  const secret = deps.secret ?? readResolveSecret()
  const timeoutMs = deps.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS
  const fetcher = deps.fetchImpl ?? fetch
  const logger = deps.logger ?? console

  async function singleResolve(hostname: string): Promise<DomainResolution | null> {
    if (!origin || !secret) return null
    const url = `${origin}/api/customer-accounts/domain-resolve?host=${encodeURIComponent(hostname)}`
    let response: Response
    try {
      response = await fetchWithTimeout(
        fetcher,
        url,
        {
          method: 'GET',
          headers: { 'X-Domain-Resolve-Secret': secret, accept: 'application/json' },
        },
        timeoutMs,
      )
    } catch (err) {
      throw new Error(`domain-resolve fetch failed: ${(err as Error)?.message ?? 'unknown'}`)
    }
    if (response.status === 404) return null
    if (!response.ok) {
      throw new Error(`domain-resolve returned HTTP ${response.status}`)
    }
    const body = (await response.json()) as ResolveResponse
    if (!body.ok) return null
    return {
      hostname,
      tenantId: body.tenantId,
      organizationId: body.organizationId,
      orgSlug: body.orgSlug,
      status: body.status,
    }
  }

  const cache = createCustomDomainCache({
    positiveTtlMs: readPositiveTtlMs(),
    negativeTtlMs: readNegativeTtlMs(),
    maxEntries: readMaxEntries(),
    resolver: singleResolve,
    onResolveError: (hostname, err) => {
      logger.warn?.(`[custom-domain] resolve failed for ${hostname}: ${(err as Error)?.message ?? err}`)
    },
  })

  async function warmUp(): Promise<{ primed: number } | { primed: 0; error: string }> {
    if (!origin || !secret) {
      return { primed: 0, error: 'INTERNAL_APP_ORIGIN or DOMAIN_RESOLVE_SECRET is not configured' }
    }
    const url = `${origin}/api/customer-accounts/domain-resolve/all`
    try {
      const response = await fetchWithTimeout(
        fetcher,
        url,
        {
          method: 'GET',
          headers: { 'X-Domain-Resolve-Secret': secret, accept: 'application/json' },
        },
        timeoutMs,
      )
      if (!response.ok) {
        return { primed: 0, error: `warm-up returned HTTP ${response.status}` }
      }
      const body = (await response.json()) as ResolveAllResponse
      if (!body.ok) return { primed: 0, error: body.error || 'warm-up returned ok=false' }
      cache.primeFromList(body.domains)
      return { primed: body.domains.length }
    } catch (err) {
      return { primed: 0, error: (err as Error)?.message ?? 'unknown' }
    }
  }

  return {
    cache,
    resolve: cache.resolve,
    warmUp,
    reset: cache.clear,
  }
}

let sharedRouter: CustomDomainRouter | null = null
let sharedWarmUpPromise: Promise<unknown> | null = null

export function getSharedCustomDomainRouter(): CustomDomainRouter {
  if (!sharedRouter) {
    sharedRouter = createCustomDomainRouter()
  }
  return sharedRouter
}

export function ensureWarmUp(): Promise<unknown> {
  if (!sharedWarmUpPromise) {
    const router = getSharedCustomDomainRouter()
    sharedWarmUpPromise = router.warmUp().then((result) => {
      if ('error' in result && result.primed === 0) {
        console.warn(`[custom-domain] warm-up skipped: ${result.error}`)
      } else if ('primed' in result) {
        console.info(`[custom-domain] warm-up primed ${result.primed} domain(s)`)
      }
      return result
    })
  }
  return sharedWarmUpPromise
}

export function resetSharedRouterForTests(): void {
  sharedRouter = null
  sharedWarmUpPromise = null
}

export function platformDomainList(): string[] {
  return (process.env.PLATFORM_DOMAINS ?? 'localhost,openmercato.com')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
}

export function isPlatformHost(hostname: string): boolean {
  return platformDomainList().includes(hostname.toLowerCase())
}
