import { Resolver, promises as dnsPromises } from 'node:dns'
import { randomUUID } from 'node:crypto'
import { request as httpsRequest } from 'node:https'
import type { ClientRequest } from 'node:http'
import { resolveSafeHostAddress } from '@open-mercato/shared/lib/host-pinning'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { setTimeout as delay } from 'node:timers/promises'
import { EntityManager } from '@mikro-orm/postgresql'
import { LockMode } from '@mikro-orm/core'
import { runWithCacheTenant } from '@open-mercato/cache'
import {
  DomainMapping,
  type DomainStatus,
} from '@open-mercato/core/modules/customer_accounts/data/entities'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { emitCustomerAccountsEvent } from '@open-mercato/core/modules/customer_accounts/events'
import { HostnameNormalizationError, normalizeHostname, tryNormalizeHostname } from '@open-mercato/core/modules/customer_accounts/lib/hostname'
import {
  DOMAIN_LIMIT_MESSAGE,
  DOMAIN_OWNERSHIP_UNVERIFIED,
  DOMAIN_RESERVATION_MS,
  DOMAIN_UNAVAILABLE_MESSAGE,
  MAX_DOMAINS_PER_ORG,
  MAX_VERIFIABLE_HOSTNAME_LENGTH,
  UNVERIFIED_DOMAIN_STATUSES,
  domainOwnershipRecord,
  domainVerificationCutoff,
  domainVerificationDeadline,
  liveDomainMappings,
} from '../lib/domainMappingLifecycle'
import { findOrganizationInTenant } from '@open-mercato/core/modules/customer_accounts/lib/organizationLookup'
import { platformDomains } from '@open-mercato/core/modules/customer_accounts/lib/platformDomains'
import { detectProxy, isInKnownProxyRange } from '@open-mercato/core/modules/customer_accounts/lib/proxyRanges'

export class DomainMappingOrgScopeError extends Error {
  constructor(organizationId: string) {
    super(`[internal] organizationId ${organizationId} does not belong to the caller's tenant`)
    this.name = 'DomainMappingOrgScopeError'
  }
}

export class DomainMappingRegistrationConflict extends Error {}

export class DomainMappingUnavailableError extends Error {}

const DOMAIN_ROUTING_TAG = 'domain_routing'
const RESOLVE_KEY_PREFIX = 'domain_routing:resolve'
const ACTIVE_BY_ORG_KEY_PREFIX = 'domain_routing:active-by-org'
const RESOLVE_TTL_MS = 5 * 60_000
const TLS_HEALTH_CHECK_TIMEOUT_MS = 10_000
const TLS_HEALTH_CHECK_RETRY_DELAYS_MS = [1_000, 4_000, 16_000]
const DEFAULT_DNS_RECHECK_THRESHOLD_MS = 5 * 60_000
const DEFAULT_TLS_MAX_RETRIES = 6
const LOCK_MAPPING = { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true } as const

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
  resolveTxt?(hostname: string): Promise<string[][]>
}

type HealthCheckContract = (hostname: string, timeoutMs: number) => Promise<{
  ok: boolean
  originHeaderPresent: boolean
  reason?: string
}>

const defaultDnsResolver: DnsResolverContract = {
  async resolveTxt(hostname) {
    try {
      return await dnsPromises.resolveTxt(hostname)
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'ENODATA' || code === 'ENOTFOUND') return []
      throw err
    }
  },
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
    let req: ClientRequest | undefined
    let settled = false
    const failure = { ok: false, originHeaderPresent: false, reason: 'TLS health check failed' }
    const finish = (result: Awaited<ReturnType<HealthCheckContract>>) => {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      resolve(result)
    }
    const deadline = setTimeout(() => {
      finish(failure)
      req?.destroy()
    }, timeoutMs)

    void resolveSafeHostAddress(hostname).then(({ host }) => {
      if (settled) return
      const headerName = (process.env.CUSTOMER_DOMAIN_ORIGIN_HEADER ?? 'X-Open-Mercato-Origin').toLowerCase()
      req = httpsRequest(
        {
          host,
          servername: hostname,
          rejectUnauthorized: true,
          agent: false,
          port: 443,
          path: '/api/customer_accounts/domain-check',
          method: 'GET',
          headers: { Host: hostname, 'X-Domain-Check-Secret': process.env.DOMAIN_CHECK_SECRET ?? '' },
          timeout: timeoutMs,
        },
        (res) => {
          const headerValue = res.headers[headerName]
          const originHeader = Array.isArray(headerValue) ? headerValue[0] : headerValue
          const originHeaderPresent = typeof originHeader === 'string' && originHeader === '1'
          const status = res.statusCode ?? 0
          res.resume()
          finish({
            ok: status >= 200 && status < 400,
            originHeaderPresent,
            reason: status >= 200 && status < 400 ? undefined : `HTTP ${status}`,
          })
        },
      )
      req.on('timeout', () => {
        finish(failure)
        req?.destroy()
      })
      req.on('error', () => finish(failure))
      req.end()
    }).catch(() => {
      getTelemetryRuntime()?.reportError(new Error('[internal] Domain TLS health check failed'), {
        module: 'customer_accounts',
        code: 'customer_accounts.domain_health_check_failed',
      })
      finish(failure)
    })
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
    return this.em.findOne(DomainMapping, { id, ...liveDomainMappings(), ...(scope?.tenantId ? { tenantId: scope.tenantId } : {}) })
  }

  async findByOrganization(
    organizationId: string,
    scope?: { tenantId?: string },
  ): Promise<DomainMapping[]> {
    const where = { organizationId, ...liveDomainMappings(), ...(scope?.tenantId ? { tenantId: scope.tenantId } : {}) }
    return this.em.find(DomainMapping, where, { orderBy: { createdAt: 'asc' } })
  }

  async resolveByHostname(input: string): Promise<ResolveResult | null> {
    const hostname = tryNormalizeHostname(input)
    if (!hostname) return null
    if (platformDomains().includes(hostname)) return null

    const cacheKey = `${RESOLVE_KEY_PREFIX}:${hostname}`
    const cache = this.cache
    if (cache) {
      const cached = (await runWithCacheTenant(null, () => cache.get(cacheKey))) as ResolveResult | null | undefined
      if (cached !== undefined && cached !== null) return cached
    }

    const result = await this.lookupResolveResult(hostname)
    if (cache) {
      await runWithCacheTenant(null, () => cache.set(cacheKey, result, {
        ttl: RESOLVE_TTL_MS,
        tags: [DOMAIN_ROUTING_TAG, `${DOMAIN_ROUTING_TAG}:${hostname}`],
      }))
    }
    return result
  }

  async isAllowedForTls(input: string): Promise<{ organizationId: string; status: DomainStatus } | null> {
    const hostname = tryNormalizeHostname(input)
    if (!hostname) return null
    if (platformDomains().includes(hostname)) return null
    const row = await this.em.findOne(DomainMapping, {
      hostname,
      deletedAt: null,
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
      deletedAt: null,
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
    const rows = await this.em.find(DomainMapping, { status: 'active', deletedAt: null })
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
    const now = new Date()
    const cutoff = new Date(now.getTime() - olderThan)
    return this.em.find(
      DomainMapping,
      {
        deletedAt: null,
        status: { $in: UNVERIFIED_DOMAIN_STATUSES },
        createdAt: { $gt: domainVerificationCutoff(now) },
        $or: [{ lastDnsCheckAt: null }, { lastDnsCheckAt: { $lt: cutoff } }],
      } as never,
      { orderBy: { lastDnsCheckAt: 'asc' } },
    )
  }

  async pruneExpiredMappings(): Promise<void> {
    const now = new Date()
    await this.em.nativeDelete(DomainMapping, {
      $and: [
        { $or: [{ reservedUntil: null }, { reservedUntil: { $lte: now } }] },
        { $or: [
          { deletedAt: { $ne: null } },
          { status: { $in: UNVERIFIED_DOMAIN_STATUSES }, createdAt: { $lte: domainVerificationCutoff(now) } },
        ] },
      ],
    })
  }

  async findPendingTls(options?: { maxRetries?: number; batchSize?: number }): Promise<DomainMapping[]> {
    const maxRetries = options?.maxRetries ?? DEFAULT_TLS_MAX_RETRIES
    const limit = options?.batchSize ?? 50
    return this.em.find(
      DomainMapping,
      {
        deletedAt: null,
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
    if (hostname.length > MAX_VERIFIABLE_HOSTNAME_LENGTH) {
      throw new HostnameNormalizationError('[internal] Hostname is too long for a verification record')
    }
    const organization = await findOrganizationInTenant(this.em, input.organizationId, input.tenantId)
    if (!organization) throw new DomainMappingOrgScopeError(input.organizationId)

    const scope = { tenantId: input.tenantId, organizationId: input.organizationId }
    const entity = await this.em.transactional(async (tx) => {
      await tx.execute('select pg_advisory_xact_lock(hashtextextended(?, 0))', [
        `custom-domains:${scope.tenantId}:${scope.organizationId}`,
      ])
      const existing = await tx.findOne(DomainMapping, { hostname }, LOCK_MAPPING)
      const now = new Date()
      const reservedUntil = existing?.reservedUntil && existing.reservedUntil > now ? existing.reservedUntil : null
      if (existing) {
        const expired = UNVERIFIED_DOMAIN_STATUSES.includes(existing.status) && domainVerificationDeadline(existing.createdAt) <= now
        if ((!existing.deletedAt && !expired) || (reservedUntil && existing.tenantId !== scope.tenantId)) {
          throw new DomainMappingRegistrationConflict(DOMAIN_UNAVAILABLE_MESSAGE)
        }
      }
      const count = await tx.count(DomainMapping, { ...scope, ...liveDomainMappings(now) })
      if (count >= MAX_DOMAINS_PER_ORG) throw new DomainMappingRegistrationConflict(DOMAIN_LIMIT_MESSAGE)

      if (existing) {
        tx.remove(existing)
        await tx.flush()
      }

      let replacesDomain: DomainMapping | null = null
      if (input.replacesDomainId) {
        replacesDomain = await tx.findOne(DomainMapping, {
          ...scope, ...liveDomainMappings(now), id: input.replacesDomainId,
        })
        if (replacesDomain) {
          await tx.nativeUpdate(DomainMapping, {
            ...scope,
            replacesDomain: replacesDomain.id,
            status: { $in: UNVERIFIED_DOMAIN_STATUSES },
            createdAt: { $lte: domainVerificationCutoff(now) },
          }, { replacesDomain: null })
        }
      }

      const mapping = tx.create(DomainMapping, {
        id: randomUUID(),
        hostname,
        ...scope,
        replacesDomain,
        reservedUntil,
        provider: 'traefik',
        status: 'pending',
        tlsRetryCount: 0,
        createdAt: now,
      })
      tx.persist(mapping)
      return mapping
    })

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
    const mapping = await this.findById(id)
    if (!mapping) throw new DomainMappingUnavailableError('[internal] Domain mapping is unavailable')
    if (!UNVERIFIED_DOMAIN_STATUSES.includes(mapping.status)) return { domainMapping: mapping }

    const expectedCname = process.env.CUSTOM_DOMAIN_CNAME_TARGET ?? ''
    const expectedARecord = process.env.CUSTOM_DOMAIN_A_RECORD_TARGET ?? null
    const verification = await this.runDnsVerification(mapping, {
      expectedCname,
      expectedARecord,
    })

    const { entity, updated } = await this.em.transactional(async (tx) => {
      const entity = await tx.findOne(DomainMapping, { id, deletedAt: null }, LOCK_MAPPING)
      if (!entity) throw new DomainMappingUnavailableError('[internal] Domain mapping is unavailable')
      if (!UNVERIFIED_DOMAIN_STATUSES.includes(entity.status)) return { entity, updated: false }
      const now = new Date()
      if (domainVerificationDeadline(entity.createdAt) <= now) {
        throw new DomainMappingUnavailableError('[internal] Domain mapping is unavailable')
      }
      entity.lastDnsCheckAt = now
      if (verification.ok) {
        entity.status = 'verified'
        entity.verifiedAt = now
        entity.dnsFailureReason = null
        entity.tlsRetryCount = 0
        entity.tlsFailureReason = null
      } else {
        entity.status = 'dns_failed'
        entity.dnsFailureReason = verification.reason
      }
      return { entity, updated: true }
    })

    if (!updated) return { domainMapping: entity }
    if (verification.ok) {
      await emitCustomerAccountsEvent('customer_accounts.domain_mapping.verified', {
        id: entity.id,
        hostname: entity.hostname,
        organizationId: entity.organizationId,
        tenantId: entity.tenantId,
      } as never)
      await this.invalidateCacheFor(entity.hostname, entity.organizationId)
      return { domainMapping: entity }
    }

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
    const candidate = await this.findById(id)
    if (!candidate) throw new DomainMappingUnavailableError('[internal] Domain mapping is unavailable')
    if (candidate.status === 'active') return candidate

    const { entity, replaced, activated } = await this.em.transactional(async (tx) => {
      const previous = candidate.replacesDomain ? await tx.findOne(DomainMapping, {
        ...liveDomainMappings(),
        id: candidate.replacesDomain.id,
        tenantId: candidate.tenantId,
        organizationId: candidate.organizationId,
      }, LOCK_MAPPING) : null
      const entity = await tx.findOne(DomainMapping, { id, deletedAt: null }, LOCK_MAPPING)
      if (!entity) throw new DomainMappingUnavailableError('[internal] Domain mapping is unavailable')
      if (entity.status === 'active') return { entity, replaced: null, activated: false }
      if (entity.status !== 'verified' && entity.status !== 'tls_failed') {
        throw new Error(`[internal] Domain mapping cannot activate from ${entity.status}`)
      }

      const replaced = previous && entity.replacesDomain?.id === previous.id ? previous : null
      if (replaced) this.releaseMapping(replaced)

      entity.status = 'active'
      entity.tlsRetryCount = 0
      entity.tlsFailureReason = null
      return { entity, replaced, activated: true }
    })
    if (!activated) return entity

    await emitCustomerAccountsEvent('customer_accounts.domain_mapping.activated', {
      id: entity.id,
      hostname: entity.hostname,
      organizationId: entity.organizationId,
      tenantId: entity.tenantId,
    } as never)

    if (replaced) {
      await emitCustomerAccountsEvent('customer_accounts.domain_mapping.replaced', {
        id: entity.id,
        hostname: entity.hostname,
        organizationId: entity.organizationId,
        tenantId: entity.tenantId,
        replacedDomainId: replaced.id,
        replacedHostname: replaced.hostname,
      } as never)
      await this.emitReleased(replaced)
    }

    await this.invalidateCacheFor(entity.hostname, entity.organizationId)
    return entity
  }

  async remove(id: string, scope?: { tenantId?: string }): Promise<void> {
    const entity = await this.em.transactional(async (tx) => {
      const mapping = await tx.findOne(DomainMapping, {
        id, deletedAt: null, ...(scope?.tenantId ? { tenantId: scope.tenantId } : {}),
      }, LOCK_MAPPING)
      if (mapping) this.releaseMapping(mapping)
      return mapping
    })
    if (entity) await this.emitReleased(entity)
  }

  async healthCheck(id: string): Promise<DomainMapping> {
    const mapping = await this.findById(id)
    if (!mapping) throw new DomainMappingUnavailableError('[internal] Domain mapping is unavailable')
    if (mapping.status === 'active') return mapping
    if (mapping.status !== 'verified' && mapping.status !== 'tls_failed') {
      throw new Error(`[internal] Domain mapping cannot run health check from status ${mapping.status}`)
    }

    let lastReason: string | null = null
    for (let attempt = 0; attempt < TLS_HEALTH_CHECK_RETRY_DELAYS_MS.length; attempt++) {
      const result = await this.healthCheckImpl(mapping.hostname, TLS_HEALTH_CHECK_TIMEOUT_MS)
      if (result.ok) {
        return this.activate(mapping.id)
      }
      lastReason = result.reason ?? 'TLS health check failed'
      if (attempt + 1 < TLS_HEALTH_CHECK_RETRY_DELAYS_MS.length) {
        await delay(TLS_HEALTH_CHECK_RETRY_DELAYS_MS[attempt])
      }
    }

    const entity = await this.em.transactional(async (tx) => {
      const entity = await tx.findOne(DomainMapping, { id, deletedAt: null }, LOCK_MAPPING)
      if (!entity) throw new DomainMappingUnavailableError('[internal] Domain mapping is unavailable')
      if (entity.status !== 'verified' && entity.status !== 'tls_failed') return entity
      entity.status = 'tls_failed'
      entity.tlsFailureReason = lastReason ?? 'TLS health check failed'
      entity.tlsRetryCount = (entity.tlsRetryCount ?? 0) + 1
      return entity
    })
    if (entity.status !== 'tls_failed') return entity

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

  private releaseMapping(mapping: DomainMapping): void {
    const now = new Date()
    mapping.deletedAt = now
    mapping.replacesDomain = null
    if (!UNVERIFIED_DOMAIN_STATUSES.includes(mapping.status)) {
      mapping.reservedUntil = new Date(now.getTime() + DOMAIN_RESERVATION_MS)
    }
  }

  private async emitReleased(mapping: DomainMapping): Promise<void> {
    const { id, hostname, organizationId, tenantId } = mapping
    await emitCustomerAccountsEvent('customer_accounts.domain_mapping.deleted', {
      id, hostname, organizationId, tenantId,
    } as never)
    await this.invalidateCacheFor(hostname, organizationId)
  }

  private async lookupResolveResult(hostname: string): Promise<ResolveResult | null> {
    const row = await this.em.findOne(DomainMapping, { hostname, status: 'active', deletedAt: null })
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
    const cache = this.cache
    if (!cache) return
    const tags = [DOMAIN_ROUTING_TAG, `${DOMAIN_ROUTING_TAG}:${hostname}`]
    if (organizationId) tags.push(`${DOMAIN_ROUTING_TAG}:org:${organizationId}`)
    await Promise.allSettled([
      cache.deleteByTags(tags),
      runWithCacheTenant(null, () => cache.deleteByTags([`${DOMAIN_ROUTING_TAG}:${hostname}`])),
    ])
  }

  private async runDnsVerification(
    mapping: DomainMapping,
    expected: { expectedCname: string; expectedARecord: string | null },
  ): Promise<
    | {
        ok: true
        method: 'cname' | 'a-record' | 'reverse-resolve'
        diagnostics: DnsDiagnostics
      }
    | { ok: false; reason: string; diagnostics: DnsDiagnostics }
  > {
    const { hostname } = mapping
    const detectedRecords: DnsDiagnostics['detectedRecords'] = []
    const baseDiag = (overrides?: Partial<DnsDiagnostics>): DnsDiagnostics => ({
      expectedCnameTarget: expected.expectedCname,
      expectedARecordTarget: expected.expectedARecord,
      detectedRecords,
      suggestion: overrides?.suggestion ?? '',
      reverseResolve: overrides?.reverseResolve,
    })

    const ownership = domainOwnershipRecord(mapping)
    let txtRecords: string[][] = []
    try {
      if (hostname.length <= MAX_VERIFIABLE_HOSTNAME_LENGTH) {
        txtRecords = await this.dns.resolveTxt?.(ownership.name) ?? []
      }
    } catch {
      getTelemetryRuntime()?.reportError(new Error('[internal] Domain TXT lookup failed'), {
        module: 'customer_accounts',
        code: 'customer_accounts.domain_txt_lookup_failed',
      })
    }
    if (!txtRecords.some((record) => record.join('') === ownership.value)) {
      return {
        ok: false,
        reason: DOMAIN_OWNERSHIP_UNVERIFIED,
        diagnostics: baseDiag({ suggestion: DOMAIN_OWNERSHIP_UNVERIFIED }),
      }
    }

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
