import { Resolver, promises as dnsPromises } from 'node:dns'
import { request as httpsRequest } from 'node:https'
import { setTimeout as delay } from 'node:timers/promises'
import { EntityManager } from '@mikro-orm/postgresql'
import {
  DomainMapping,
  type DomainStatus,
} from '@open-mercato/core/modules/customer_accounts/data/entities'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { emitCustomerAccountsEvent } from '@open-mercato/core/modules/customer_accounts/events'
import { normalizeHostname, tryNormalizeHostname } from '@open-mercato/core/modules/customer_accounts/lib/hostname'
import { platformDomains } from '@open-mercato/core/modules/customer_accounts/lib/platformDomains'
import { detectProxy, isInKnownProxyRange } from '@open-mercato/core/modules/customer_accounts/lib/proxyRanges'

const DOMAIN_ROUTING_TAG = 'domain_routing'
const RESOLVE_KEY_PREFIX = 'domain_routing:resolve'
const ACTIVE_BY_ORG_KEY_PREFIX = 'domain_routing:active-by-org'
const RESOLVE_TTL_MS = 5 * 60_000
const TLS_HEALTH_CHECK_TIMEOUT_MS = 10_000
const TLS_HEALTH_CHECK_RETRY_DELAYS_MS = [1_000, 4_000, 16_000]
const DEFAULT_DNS_RECHECK_THRESHOLD_MS = 5 * 60_000
const DEFAULT_TLS_MAX_RETRIES = 6

export type ResolveResult = {
  domainMappingId: string
  hostname: string
  tenantId: string
  organizationId: string
  orgSlug: string | null
  status: DomainStatus
}

export type DnsDiagnostics = {
  expectedCnameTarget: string
  expectedARecordTarget: string | null
  detectedRecords: Array<{ type: 'CNAME' | 'A'; value: string; proxy?: string }>
  reverseResolve?: { attempted: boolean; originHeaderPresent: boolean }
  suggestion: string
}

export type VerifyResult = {
  domainMapping: DomainMapping
  diagnostics?: DnsDiagnostics
}

export type RegisterInput = {
  hostname: string
  organizationId: string
  tenantId: string
  replacesDomainId?: string
}

type CacheService = {
  get(key: string, options?: unknown): Promise<unknown>
  set(key: string, value: unknown, options?: { ttl?: number; tags?: string[] }): Promise<void>
  deleteByTags(tags: string[]): Promise<number>
}

type DnsResolverContract = {
  resolveCname(hostname: string): Promise<string[]>
  resolve4(hostname: string): Promise<string[]>
}

type HealthCheckContract = (hostname: string, timeoutMs: number) => Promise<{
  ok: boolean
  originHeaderPresent: boolean
  reason?: string
}>

const defaultDnsResolver: DnsResolverContract = {
  async resolveCname(hostname) {
    try {
      return await dnsPromises.resolveCname(hostname)
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'ENODATA' || code === 'ENOTFOUND') return []
      throw err
    }
  },
  async resolve4(hostname) {
    try {
      return await dnsPromises.resolve4(hostname)
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'ENODATA' || code === 'ENOTFOUND') return []
      throw err
    }
  },
}

const defaultHealthCheck: HealthCheckContract = (hostname, timeoutMs) =>
  new Promise((resolve) => {
    const headerName = (process.env.CUSTOMER_DOMAIN_ORIGIN_HEADER ?? 'X-Open-Mercato-Origin').toLowerCase()
    const req = httpsRequest(
      {
        host: hostname,
        port: 443,
        path: '/api/customer_accounts/domain-check',
        method: 'GET',
        headers: { 'X-Domain-Check-Secret': process.env.DOMAIN_CHECK_SECRET ?? '' },
        timeout: timeoutMs,
      },
      (res) => {
        const headerValue = res.headers[headerName]
        const originHeader = Array.isArray(headerValue) ? headerValue[0] : headerValue
        const originHeaderPresent = typeof originHeader === 'string' && originHeader === '1'
        const status = res.statusCode ?? 0
        res.resume() // discard body
        resolve({
          ok: status >= 200 && status < 400,
          originHeaderPresent,
          reason: status >= 200 && status < 400 ? undefined : `HTTP ${status}`,
        })
      },
    )
    req.on('timeout', () => {
      req.destroy(new Error('TLS health check timed out'))
    })
    req.on('error', (err) => {
      resolve({ ok: false, originHeaderPresent: false, reason: (err as Error).message })
    })
    req.end()
  })

export class DomainMappingService {
  private cache: CacheService | null
  private dns: DnsResolverContract
  private healthCheckImpl: HealthCheckContract

  constructor(
    private em: EntityManager,
    deps?: {
      cacheService?: CacheService
      dnsResolver?: DnsResolverContract
      healthCheck?: HealthCheckContract
    },
  ) {
    this.cache = deps?.cacheService ?? null
    this.dns = deps?.dnsResolver ?? defaultDnsResolver
    this.healthCheckImpl = deps?.healthCheck ?? defaultHealthCheck
  }

  // -------------------------------------------------------------------------
  // Read paths
  // -------------------------------------------------------------------------

  async findById(id: string, scope?: { tenantId?: string }): Promise<DomainMapping | null> {
    const where: Record<string, unknown> = { id }
    if (scope?.tenantId) where.tenantId = scope.tenantId
    return this.em.findOne(DomainMapping, where as never)
  }

  async findByOrganization(
    organizationId: string,
    scope?: { tenantId?: string },
  ): Promise<DomainMapping[]> {
    const where: Record<string, unknown> = { organizationId }
    if (scope?.tenantId) where.tenantId = scope.tenantId
    return this.em.find(DomainMapping, where as never, { orderBy: { createdAt: 'asc' } })
  }

  async resolveByHostname(input: string): Promise<ResolveResult | null> {
    const hostname = tryNormalizeHostname(input)
    if (!hostname) return null
    if (platformDomains().includes(hostname)) return null

    const cacheKey = `${RESOLVE_KEY_PREFIX}:${hostname}`
    if (this.cache) {
      const cached = (await this.cache.get(cacheKey)) as ResolveResult | null | undefined
      if (cached !== undefined && cached !== null) return cached
    }

    const result = await this.lookupResolveResult(hostname)
    if (this.cache) {
      await this.cache.set(cacheKey, result, {
        ttl: RESOLVE_TTL_MS,
        tags: [DOMAIN_ROUTING_TAG, `${DOMAIN_ROUTING_TAG}:${hostname}`],
      })
    }
    return result
  }

  async isAllowedForTls(input: string): Promise<{ organizationId: string; status: DomainStatus } | null> {
    const hostname = tryNormalizeHostname(input)
    if (!hostname) return null
    if (platformDomains().includes(hostname)) return null
    const row = await this.em.findOne(DomainMapping, {
      hostname,
      status: { $in: ['active', 'verified'] },
    } as never)
    if (!row) return null
    return { organizationId: row.organizationId, status: row.status }
  }

  async resolveActiveByOrg(organizationId: string): Promise<{ hostname: string; status: DomainStatus } | null> {
    const cacheKey = `${ACTIVE_BY_ORG_KEY_PREFIX}:${organizationId}`
    if (this.cache) {
      const cached = (await this.cache.get(cacheKey)) as { hostname: string; status: DomainStatus } | null | undefined
      if (cached !== undefined && cached !== null) return cached
    }

    const row = await this.em.findOne(DomainMapping, {
      organizationId,
      status: 'active',
    } as never)
    const result = row ? { hostname: row.hostname, status: row.status } : null

    if (this.cache) {
      await this.cache.set(cacheKey, result, {
        ttl: RESOLVE_TTL_MS,
        tags: [DOMAIN_ROUTING_TAG, `${DOMAIN_ROUTING_TAG}:org:${organizationId}`],
      })
    }
    return result
  }

  async resolveAll(): Promise<ResolveResult[]> {
    const rows = await this.em.find(DomainMapping, { status: 'active' } as never)
    if (rows.length === 0) return []
    const orgIds = Array.from(new Set(rows.map((r) => r.organizationId)))
    const orgs = await this.em.find(Organization, { id: { $in: orgIds } } as never)
    const slugByOrg = new Map<string, string | null>(orgs.map((o) => [o.id, o.slug ?? null]))

    return rows.map<ResolveResult>((row) => ({
      domainMappingId: row.id,
      hostname: row.hostname,
      tenantId: row.tenantId,
      organizationId: row.organizationId,
      orgSlug: slugByOrg.get(row.organizationId) ?? null,
      status: row.status,
    }))
  }

  // -------------------------------------------------------------------------
  // Worker queries
  // -------------------------------------------------------------------------

  async findPendingVerification(threshold?: { olderThanMs?: number }): Promise<DomainMapping[]> {
    const olderThan = threshold?.olderThanMs ?? DEFAULT_DNS_RECHECK_THRESHOLD_MS
    const cutoff = new Date(Date.now() - olderThan)
    return this.em.find(
      DomainMapping,
      {
        status: { $in: ['pending', 'dns_failed'] },
        $or: [{ lastDnsCheckAt: null }, { lastDnsCheckAt: { $lt: cutoff } }],
      } as never,
      { orderBy: { lastDnsCheckAt: 'asc' } },
    )
  }

  async findPendingTls(options?: { maxRetries?: number; batchSize?: number }): Promise<DomainMapping[]> {
    const maxRetries = options?.maxRetries ?? DEFAULT_TLS_MAX_RETRIES
    const limit = options?.batchSize ?? 50
    return this.em.find(
      DomainMapping,
      {
        $or: [
          { status: 'verified' },
          { status: 'tls_failed', tlsRetryCount: { $lt: maxRetries } },
        ],
      } as never,
      { orderBy: { updatedAt: 'asc' }, limit },
    )
  }

  // -------------------------------------------------------------------------
  // Write paths
  // -------------------------------------------------------------------------

  async register(input: RegisterInput): Promise<DomainMapping> {
    const hostname = normalizeHostname(input.hostname)

    let replacesDomain: DomainMapping | null = null
    if (input.replacesDomainId) {
      replacesDomain = await this.em.findOne(DomainMapping, {
        id: input.replacesDomainId,
        tenantId: input.tenantId,
      } as never)
    }

    const entity = this.em.create(DomainMapping, {
      hostname,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      replacesDomain: replacesDomain ?? null,
      provider: 'traefik',
      status: 'pending',
      tlsRetryCount: 0,
      createdAt: new Date(),
    } as never)
    await this.em.persist(entity).flush()

    await emitCustomerAccountsEvent('customer_accounts.domain_mapping.created', {
      id: entity.id,
      hostname: entity.hostname,
      organizationId: entity.organizationId,
      tenantId: entity.tenantId,
      status: entity.status,
    } as never)
    await this.invalidateCacheFor(entity.hostname, entity.organizationId)

    return entity
  }

  async verify(id: string): Promise<VerifyResult> {
    const entity = await this.em.findOne(DomainMapping, { id } as never)
    if (!entity) throw new Error(`DomainMapping ${id} not found`)

    const expectedCname = process.env.CUSTOM_DOMAIN_CNAME_TARGET ?? ''
    const expectedARecord = process.env.CUSTOM_DOMAIN_A_RECORD_TARGET ?? null
    const now = new Date()
    entity.lastDnsCheckAt = now

    const verification = await this.runDnsVerification(entity.hostname, {
      expectedCname,
      expectedARecord,
    })

    if (verification.ok) {
      entity.status = 'verified'
      entity.verifiedAt = now
      entity.dnsFailureReason = null
      entity.tlsRetryCount = 0
      entity.tlsFailureReason = null
      await this.em.persist(entity).flush()
      await emitCustomerAccountsEvent('customer_accounts.domain_mapping.verified', {
        id: entity.id,
        hostname: entity.hostname,
        organizationId: entity.organizationId,
        tenantId: entity.tenantId,
      } as never)
      await this.invalidateCacheFor(entity.hostname, entity.organizationId)
      return { domainMapping: entity }
    }

    entity.status = 'dns_failed'
    entity.dnsFailureReason = verification.reason
    await this.em.persist(entity).flush()
    await emitCustomerAccountsEvent('customer_accounts.domain_mapping.dns_failed', {
      id: entity.id,
      hostname: entity.hostname,
      organizationId: entity.organizationId,
      tenantId: entity.tenantId,
      reason: verification.reason,
      detectedRecords: verification.diagnostics.detectedRecords,
    } as never)
    await this.invalidateCacheFor(entity.hostname, entity.organizationId)
    return { domainMapping: entity, diagnostics: verification.diagnostics }
  }

  async activate(id: string): Promise<DomainMapping> {
    const entity = await this.em.findOne(DomainMapping, { id } as never)
    if (!entity) throw new Error(`DomainMapping ${id} not found`)
    if (entity.status === 'active') return entity
    if (entity.status !== 'verified' && entity.status !== 'tls_failed') {
      throw new Error(`DomainMapping ${id} cannot transition to active from ${entity.status}`)
    }

    entity.status = 'active'
    entity.tlsRetryCount = 0
    entity.tlsFailureReason = null
    await this.em.persist(entity).flush()

    await emitCustomerAccountsEvent('customer_accounts.domain_mapping.activated', {
      id: entity.id,
      hostname: entity.hostname,
      organizationId: entity.organizationId,
      tenantId: entity.tenantId,
    } as never)

    if (entity.replacesDomain) {
      const replaced = await this.em.findOne(DomainMapping, {
        id: (entity.replacesDomain as unknown as { id: string }).id,
      } as never)
      if (replaced) {
        const replacedHostname = replaced.hostname
        const replacedOrg = replaced.organizationId
        this.em.remove(replaced)
        await this.em.flush()
        await emitCustomerAccountsEvent('customer_accounts.domain_mapping.replaced', {
          id: entity.id,
          hostname: entity.hostname,
          organizationId: entity.organizationId,
          tenantId: entity.tenantId,
          replacedDomainId: replaced.id,
          replacedHostname,
        } as never)
        await emitCustomerAccountsEvent('customer_accounts.domain_mapping.deleted', {
          id: replaced.id,
          hostname: replacedHostname,
          organizationId: replacedOrg,
          tenantId: replaced.tenantId,
        } as never)
        await this.invalidateCacheFor(replacedHostname, replacedOrg)
      }
    }

    await this.invalidateCacheFor(entity.hostname, entity.organizationId)
    return entity
  }

  async remove(id: string, scope?: { tenantId?: string }): Promise<void> {
    const where: Record<string, unknown> = { id }
    if (scope?.tenantId) where.tenantId = scope.tenantId
    const entity = await this.em.findOne(DomainMapping, where as never)
    if (!entity) return

    const hostname = entity.hostname
    const organizationId = entity.organizationId
    const tenantId = entity.tenantId

    this.em.remove(entity)
    await this.em.flush()

    await emitCustomerAccountsEvent('customer_accounts.domain_mapping.deleted', {
      id,
      hostname,
      organizationId,
      tenantId,
    } as never)
    await this.invalidateCacheFor(hostname, organizationId)
  }

  async healthCheck(id: string): Promise<DomainMapping> {
    const entity = await this.em.findOne(DomainMapping, { id } as never)
    if (!entity) throw new Error(`DomainMapping ${id} not found`)
    if (entity.status === 'active') return entity
    if (entity.status !== 'verified' && entity.status !== 'tls_failed') {
      throw new Error(`DomainMapping ${id} cannot run health check from status ${entity.status}`)
    }

    let lastReason: string | null = null
    for (let attempt = 0; attempt < TLS_HEALTH_CHECK_RETRY_DELAYS_MS.length; attempt++) {
      const result = await this.healthCheckImpl(entity.hostname, TLS_HEALTH_CHECK_TIMEOUT_MS)
      if (result.ok) {
        return this.activate(entity.id)
      }
      lastReason = result.reason ?? 'TLS health check failed'
      if (attempt + 1 < TLS_HEALTH_CHECK_RETRY_DELAYS_MS.length) {
        await delay(TLS_HEALTH_CHECK_RETRY_DELAYS_MS[attempt])
      }
    }

    entity.status = 'tls_failed'
    entity.tlsFailureReason = lastReason ?? 'TLS health check failed'
    entity.tlsRetryCount = (entity.tlsRetryCount ?? 0) + 1
    await this.em.persist(entity).flush()

    await emitCustomerAccountsEvent('customer_accounts.domain_mapping.tls_failed', {
      id: entity.id,
      hostname: entity.hostname,
      organizationId: entity.organizationId,
      tenantId: entity.tenantId,
      reason: entity.tlsFailureReason,
      retryCount: entity.tlsRetryCount,
    } as never)
    await this.invalidateCacheFor(entity.hostname, entity.organizationId)
    return entity
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async lookupResolveResult(hostname: string): Promise<ResolveResult | null> {
    const row = await this.em.findOne(DomainMapping, { hostname, status: 'active' } as never)
    if (!row) return null
    const org = await this.em.findOne(Organization, { id: row.organizationId } as never)
    return {
      domainMappingId: row.id,
      hostname: row.hostname,
      tenantId: row.tenantId,
      organizationId: row.organizationId,
      orgSlug: org?.slug ?? null,
      status: row.status,
    }
  }

  private async invalidateCacheFor(hostname: string, organizationId: string | null): Promise<void> {
    if (!this.cache) return
    const tags = [DOMAIN_ROUTING_TAG, `${DOMAIN_ROUTING_TAG}:${hostname}`]
    if (organizationId) tags.push(`${DOMAIN_ROUTING_TAG}:org:${organizationId}`)
    try {
      await this.cache.deleteByTags(tags)
    } catch {
      // Cache invalidation is best-effort — TTL backstop ensures eventual consistency.
    }
  }

  private async runDnsVerification(
    hostname: string,
    expected: { expectedCname: string; expectedARecord: string | null },
  ): Promise<
    | {
        ok: true
        method: 'cname' | 'a-record' | 'reverse-resolve'
        diagnostics: DnsDiagnostics
      }
    | { ok: false; reason: string; diagnostics: DnsDiagnostics }
  > {
    const detectedRecords: DnsDiagnostics['detectedRecords'] = []
    const baseDiag = (overrides?: Partial<DnsDiagnostics>): DnsDiagnostics => ({
      expectedCnameTarget: expected.expectedCname,
      expectedARecordTarget: expected.expectedARecord,
      detectedRecords,
      suggestion: overrides?.suggestion ?? '',
      reverseResolve: overrides?.reverseResolve,
    })

    // Phase 1: CNAME
    let cnameRecords: string[] = []
    try {
      cnameRecords = await this.dns.resolveCname(hostname)
    } catch (err) {
      return {
        ok: false,
        reason: `DNS lookup error (CNAME): ${(err as Error).message}`,
        diagnostics: baseDiag({
          suggestion: 'DNS lookup failed unexpectedly. Try again in a few minutes.',
        }),
      }
    }
    for (const cname of cnameRecords) detectedRecords.push({ type: 'CNAME', value: cname })

    if (expected.expectedCname && cnameRecords.length > 0) {
      const expectedCname = tryNormalizeHostname(expected.expectedCname) ?? expected.expectedCname.toLowerCase()
      const match = cnameRecords.some((c) => (tryNormalizeHostname(c) ?? c.toLowerCase()) === expectedCname)
      if (match) {
        return {
          ok: true,
          method: 'cname',
          diagnostics: baseDiag({
            suggestion: 'CNAME record matches the expected target.',
          }),
        }
      }
      return {
        ok: false,
        reason: `CNAME points to ${cnameRecords.join(', ')} instead of ${expected.expectedCname}`,
        diagnostics: baseDiag({
          suggestion: `Update your CNAME record to point to ${expected.expectedCname}.`,
        }),
      }
    }

    // Phase 2: A record
    let aRecords: string[] = []
    try {
      aRecords = await this.dns.resolve4(hostname)
    } catch (err) {
      return {
        ok: false,
        reason: `DNS lookup error (A): ${(err as Error).message}`,
        diagnostics: baseDiag({ suggestion: 'DNS lookup failed unexpectedly. Try again in a few minutes.' }),
      }
    }
    for (const a of aRecords) {
      const proxy = detectProxy(a)
      detectedRecords.push({ type: 'A', value: a, ...(proxy ? { proxy } : {}) })
    }

    if (aRecords.length === 0) {
      return {
        ok: false,
        reason: `No CNAME or A record found for ${hostname}`,
        diagnostics: baseDiag({
          suggestion: expected.expectedARecord
            ? `For a subdomain, add a CNAME record pointing to ${expected.expectedCname}. For an apex domain, add an A record pointing to ${expected.expectedARecord}. DNS propagation can take up to 48 hours.`
            : `Add a CNAME record pointing to ${expected.expectedCname}. DNS propagation can take up to 48 hours.`,
        }),
      }
    }

    if (expected.expectedARecord && aRecords.includes(expected.expectedARecord)) {
      return {
        ok: true,
        method: 'a-record',
        diagnostics: baseDiag({ suggestion: 'A record matches the expected target.' }),
      }
    }

    // Phase 3: reverse-resolve through proxy
    const proxiedRecords = aRecords.filter((ip) => isInKnownProxyRange(ip))
    if (proxiedRecords.length > 0) {
      const probe = await this.healthCheckImpl(hostname, TLS_HEALTH_CHECK_TIMEOUT_MS)
      if (probe.ok && probe.originHeaderPresent) {
        return {
          ok: true,
          method: 'reverse-resolve',
          diagnostics: baseDiag({
            reverseResolve: { attempted: true, originHeaderPresent: true },
            suggestion: 'Domain is proxied — reverse-resolve confirmed traffic reaches our origin.',
          }),
        }
      }
      return {
        ok: false,
        reason: 'A record points to a known proxy IP, but reverse-resolve over HTTPS did not reach our server',
        diagnostics: baseDiag({
          reverseResolve: { attempted: true, originHeaderPresent: false },
          suggestion: expected.expectedCname
            ? `Your DNS uses a proxy. Either disable the proxy and add a CNAME → ${expected.expectedCname}, or configure your proxy to forward traffic to ${expected.expectedCname}.`
            : 'Disable the DNS proxy or configure it to forward traffic to our platform.',
        }),
      }
    }

    return {
      ok: false,
      reason: expected.expectedARecord
        ? `A record points to ${aRecords.join(', ')} instead of ${expected.expectedARecord}`
        : `A record points to ${aRecords.join(', ')} but apex-domain registration is not enabled on this deployment`,
      diagnostics: baseDiag({
        suggestion: expected.expectedARecord
          ? `Update your A record to point to ${expected.expectedARecord}.`
          : `Apex-domain registration is not enabled on this deployment. Use a subdomain (e.g., shop.${hostname}) and add a CNAME pointing to ${expected.expectedCname}.`,
      }),
    }
  }
}

// Re-exported for tests; allow injection of fakes.
export const __testing__ = {
  DEFAULT_DNS_RECHECK_THRESHOLD_MS,
  DEFAULT_TLS_MAX_RETRIES,
  TLS_HEALTH_CHECK_RETRY_DELAYS_MS,
  RESOLVE_TTL_MS,
  DOMAIN_ROUTING_TAG,
  defaultHealthCheck,
  defaultDnsResolver,
  Resolver,
}
