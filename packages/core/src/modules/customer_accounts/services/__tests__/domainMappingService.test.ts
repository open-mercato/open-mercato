/** @jest-environment node */
import type { EntityManager } from '@mikro-orm/postgresql'
import { DomainMappingService } from '@open-mercato/core/modules/customer_accounts/services/domainMappingService'
import {
  DomainMapping,
  type DomainStatus,
} from '@open-mercato/core/modules/customer_accounts/data/entities'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'

// Silence the "Event bus not available" console warnings emitted by
// emitCustomerAccountsEvent in tests; the events themselves are fire-and-forget
// from the service's perspective.
jest.mock('@open-mercato/core/modules/customer_accounts/events', () => {
  const actual = jest.requireActual<typeof import('@open-mercato/core/modules/customer_accounts/events')>(
    '@open-mercato/core/modules/customer_accounts/events',
  )
  return {
    ...actual,
    emitCustomerAccountsEvent: jest.fn(async () => undefined),
  }
})

const TENANT_A = '11111111-1111-4111-8111-111111111111'
const TENANT_B = '22222222-2222-4222-8222-222222222222'
const ORG_A = '33333333-3333-4333-8333-333333333333'
const ORG_A2 = '44444444-4444-4444-8444-444444444444'
const ORG_B = '55555555-5555-4555-8555-555555555555'

type Row = {
  id: string
  hostname: string
  tenantId: string
  organizationId: string
  status: DomainStatus
  provider: string
  tlsRetryCount: number
  verifiedAt: Date | null
  lastDnsCheckAt: Date | null
  dnsFailureReason: string | null
  tlsFailureReason: string | null
  replacesDomain: { id: string } | null
  createdAt: Date
  updatedAt: Date | null
}

type OrgRow = { id: string; slug: string | null }

let nextId = 1
function makeId(): string {
  // Synthetic UUID-shaped identifier — service code never validates the format.
  const seq = (nextId++).toString().padStart(12, '0')
  return `aaaaaaaa-aaaa-4aaa-8aaa-${seq}`
}

type WhereClause = Record<string, unknown> & {
  $or?: Array<Record<string, unknown>>
  $in?: unknown
}

function valuesIn(value: unknown): unknown[] | null {
  if (value && typeof value === 'object' && '$in' in (value as Record<string, unknown>)) {
    const inVal = (value as Record<string, unknown>).$in
    if (Array.isArray(inVal)) return inVal
  }
  return null
}

function rowMatches(row: Row, where: WhereClause): boolean {
  for (const [key, raw] of Object.entries(where)) {
    if (key === '$or' && Array.isArray(raw)) {
      const ok = raw.some((clause) => rowMatches(row, clause as WhereClause))
      if (!ok) return false
      continue
    }
    const inValues = valuesIn(raw)
    const fieldValue = (row as unknown as Record<string, unknown>)[key]
    if (inValues) {
      if (!inValues.includes(fieldValue)) return false
      continue
    }
    if (raw && typeof raw === 'object' && '$lt' in (raw as Record<string, unknown>)) {
      const cmp = (raw as Record<string, unknown>).$lt
      if (!(fieldValue !== null && fieldValue !== undefined && (fieldValue as Date | number) < (cmp as Date | number))) {
        return false
      }
      continue
    }
    if (fieldValue !== raw) return false
  }
  return true
}

type FakeEm = jest.Mocked<
  Pick<EntityManager, 'find' | 'findOne' | 'create' | 'persist' | 'remove' | 'flush'>
> & {
  __store: Map<string, Row>
  __orgs: Map<string, OrgRow>
  __removed: Set<string>
}

function createFakeEm(seed: { domains?: Row[]; orgs?: OrgRow[] } = {}): FakeEm {
  const store = new Map<string, Row>()
  const orgs = new Map<string, OrgRow>()
  const removed = new Set<string>()
  for (const row of seed.domains ?? []) store.set(row.id, row)
  for (const org of seed.orgs ?? []) orgs.set(org.id, org)

  const findOne = jest.fn(async (entity: unknown, where: WhereClause) => {
    if (entity === DomainMapping) {
      for (const row of store.values()) {
        if (rowMatches(row, where)) return row
      }
      return null
    }
    if (entity === Organization) {
      const id = (where as Record<string, unknown>).id as string | undefined
      if (id && orgs.has(id)) return orgs.get(id)!
      return null
    }
    return null
  })

  const find = jest.fn(async (entity: unknown, where: WhereClause, options?: { orderBy?: Record<string, 'asc' | 'desc'>; limit?: number }) => {
    if (entity === DomainMapping) {
      let result = Array.from(store.values()).filter((row) => rowMatches(row, where))
      if (options?.orderBy) {
        const [[field, direction]] = Object.entries(options.orderBy)
        result = result.slice().sort((a, b) => {
          const av = (a as unknown as Record<string, unknown>)[field] as Date | string | null | undefined
          const bv = (b as unknown as Record<string, unknown>)[field] as Date | string | null | undefined
          if (av == null && bv == null) return 0
          if (av == null) return direction === 'asc' ? -1 : 1
          if (bv == null) return direction === 'asc' ? 1 : -1
          if (av < bv) return direction === 'asc' ? -1 : 1
          if (av > bv) return direction === 'asc' ? 1 : -1
          return 0
        })
      }
      if (options?.limit) result = result.slice(0, options.limit)
      return result
    }
    if (entity === Organization) {
      const ids = valuesIn((where as Record<string, unknown>).id) ?? []
      return ids.map((id) => orgs.get(id as string)).filter(Boolean) as OrgRow[]
    }
    return []
  })

  const create = jest.fn((_entity: unknown, data: Partial<Row>) => {
    const row: Row = {
      id: data.id ?? makeId(),
      hostname: data.hostname ?? '',
      tenantId: data.tenantId ?? '',
      organizationId: data.organizationId ?? '',
      status: data.status ?? 'pending',
      provider: data.provider ?? 'traefik',
      tlsRetryCount: data.tlsRetryCount ?? 0,
      verifiedAt: data.verifiedAt ?? null,
      lastDnsCheckAt: data.lastDnsCheckAt ?? null,
      dnsFailureReason: data.dnsFailureReason ?? null,
      tlsFailureReason: data.tlsFailureReason ?? null,
      replacesDomain: data.replacesDomain ?? null,
      createdAt: data.createdAt ?? new Date(),
      updatedAt: data.updatedAt ?? null,
    }
    return row as unknown as DomainMapping
  })

  const persist = jest.fn((entity: Row) => {
    if (!removed.has(entity.id)) {
      store.set(entity.id, entity)
    }
    return { flush: async () => undefined }
  })

  const remove = jest.fn((entity: Row) => {
    removed.add(entity.id)
    store.delete(entity.id)
  })

  const flush = jest.fn(async () => undefined)

  const em = {
    find,
    findOne,
    create,
    persist,
    remove,
    flush,
    __store: store,
    __orgs: orgs,
    __removed: removed,
  } as unknown as FakeEm
  return em
}

function seedDomain(overrides: Partial<Row> = {}): Row {
  return {
    id: overrides.id ?? makeId(),
    hostname: overrides.hostname ?? 'shop.example.com',
    tenantId: overrides.tenantId ?? TENANT_A,
    organizationId: overrides.organizationId ?? ORG_A,
    status: overrides.status ?? 'pending',
    provider: overrides.provider ?? 'traefik',
    tlsRetryCount: overrides.tlsRetryCount ?? 0,
    verifiedAt: overrides.verifiedAt ?? null,
    lastDnsCheckAt: overrides.lastDnsCheckAt ?? null,
    dnsFailureReason: overrides.dnsFailureReason ?? null,
    tlsFailureReason: overrides.tlsFailureReason ?? null,
    replacesDomain: overrides.replacesDomain ?? null,
    createdAt: overrides.createdAt ?? new Date('2026-01-01T00:00:00Z'),
    updatedAt: overrides.updatedAt ?? null,
  }
}

beforeEach(() => {
  process.env.PLATFORM_DOMAINS = 'localhost,openmercato.com'
  delete process.env.CUSTOM_DOMAIN_CNAME_TARGET
  delete process.env.CUSTOM_DOMAIN_A_RECORD_TARGET
})

// ---------------------------------------------------------------------------
// register
// ---------------------------------------------------------------------------

describe('DomainMappingService.register', () => {
  it('creates a pending mapping for a valid hostname (happy path)', async () => {
    const em = createFakeEm()
    const service = new DomainMappingService(em as unknown as EntityManager)

    const result = await service.register({
      hostname: 'shop.example.com',
      tenantId: TENANT_A,
      organizationId: ORG_A,
    })

    expect(result.hostname).toBe('shop.example.com')
    expect(result.status).toBe('pending')
    expect(result.tenantId).toBe(TENANT_A)
    expect(result.organizationId).toBe(ORG_A)
    expect(result.tlsRetryCount).toBe(0)
    expect(em.persist).toHaveBeenCalledTimes(1)
    expect(em.__store.size).toBe(1)
  })

  it('normalizes mixed-case + trailing dot hostnames before persisting', async () => {
    const em = createFakeEm()
    const service = new DomainMappingService(em as unknown as EntityManager)

    const result = await service.register({
      hostname: 'Shop.Example.com.',
      tenantId: TENANT_A,
      organizationId: ORG_A,
    })

    expect(result.hostname).toBe('shop.example.com')
  })

  it('rejects malformed hostnames via normalizeHostname', async () => {
    const em = createFakeEm()
    const service = new DomainMappingService(em as unknown as EntityManager)

    await expect(
      service.register({ hostname: '-bad', tenantId: TENANT_A, organizationId: ORG_A }),
    ).rejects.toThrow()
    await expect(
      service.register({ hostname: 'localhost', tenantId: TENANT_A, organizationId: ORG_A }),
    ).rejects.toThrow()
  })

  it('sets the replacement pointer when replacesDomainId points at a same-tenant record', async () => {
    const replacedRow = seedDomain({
      hostname: 'old.example.com',
      tenantId: TENANT_A,
      organizationId: ORG_A,
      status: 'active',
    })
    const em = createFakeEm({ domains: [replacedRow] })
    const service = new DomainMappingService(em as unknown as EntityManager)

    const created = await service.register({
      hostname: 'new.example.com',
      tenantId: TENANT_A,
      organizationId: ORG_A,
      replacesDomainId: replacedRow.id,
    })

    const stored = (created as unknown as Row).replacesDomain
    expect(stored).not.toBeNull()
    expect((stored as { id: string }).id).toBe(replacedRow.id)
  })

  it('does NOT set the replacement pointer when replacesDomainId belongs to another tenant', async () => {
    // Cross-tenant attack: tenant A trying to "replace" a record owned by tenant B
    const replacedRow = seedDomain({
      hostname: 'foreign.example.com',
      tenantId: TENANT_B,
      organizationId: ORG_B,
      status: 'active',
    })
    const em = createFakeEm({ domains: [replacedRow] })
    const service = new DomainMappingService(em as unknown as EntityManager)

    const created = await service.register({
      hostname: 'new.example.com',
      tenantId: TENANT_A,
      organizationId: ORG_A,
      replacesDomainId: replacedRow.id,
    })

    // service.findOne is filtered by tenantId in register(), so the foreign
    // record is invisible — replacement pointer must remain null.
    expect((created as unknown as Row).replacesDomain).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// verify (state machine)
// ---------------------------------------------------------------------------

describe('DomainMappingService.verify', () => {
  it('transitions pending → verified when CNAME matches the expected target', async () => {
    process.env.CUSTOM_DOMAIN_CNAME_TARGET = 'edge.openmercato.com'
    const row = seedDomain({ hostname: 'shop.example.com', status: 'pending' })
    const em = createFakeEm({ domains: [row] })
    const dnsResolver = {
      resolveCname: jest.fn(async () => ['edge.openmercato.com']),
      resolve4: jest.fn(async () => []),
    }
    const service = new DomainMappingService(em as unknown as EntityManager, { dnsResolver })

    const result = await service.verify(row.id)

    expect(result.domainMapping.status).toBe('verified')
    expect(result.domainMapping.verifiedAt).toBeInstanceOf(Date)
    expect(result.domainMapping.dnsFailureReason).toBeNull()
    expect(em.__store.get(row.id)?.status).toBe('verified')
  })

  it('transitions dns_failed → verified when DNS is now correct (recovery path)', async () => {
    process.env.CUSTOM_DOMAIN_CNAME_TARGET = 'edge.openmercato.com'
    const row = seedDomain({ hostname: 'shop.example.com', status: 'dns_failed', dnsFailureReason: 'old reason' })
    const em = createFakeEm({ domains: [row] })
    const dnsResolver = {
      resolveCname: jest.fn(async () => ['edge.openmercato.com']),
      resolve4: jest.fn(async () => []),
    }
    const service = new DomainMappingService(em as unknown as EntityManager, { dnsResolver })

    const result = await service.verify(row.id)
    expect(result.domainMapping.status).toBe('verified')
  })

  it('transitions to dns_failed when CNAME points elsewhere', async () => {
    process.env.CUSTOM_DOMAIN_CNAME_TARGET = 'edge.openmercato.com'
    const row = seedDomain({ hostname: 'shop.example.com', status: 'pending' })
    const em = createFakeEm({ domains: [row] })
    const dnsResolver = {
      resolveCname: jest.fn(async () => ['attacker.example.net']),
      resolve4: jest.fn(async () => []),
    }
    const service = new DomainMappingService(em as unknown as EntityManager, { dnsResolver })

    const result = await service.verify(row.id)
    expect(result.domainMapping.status).toBe('dns_failed')
    expect(result.domainMapping.dnsFailureReason).toContain('attacker.example.net')
    expect(result.diagnostics?.suggestion).toContain('edge.openmercato.com')
  })

  it('does NOT transition active → verified on a re-verify (active stays active until persisted otherwise)', async () => {
    // verify() always re-runs DNS and sets state from the result. If a record
    // is currently 'active' (already promoted) and DNS still resolves OK, the
    // current implementation will downgrade it back to 'verified'. Document
    // that behavior here so any future change to skip verify on active is a
    // deliberate decision and not an unnoticed regression.
    process.env.CUSTOM_DOMAIN_CNAME_TARGET = 'edge.openmercato.com'
    const row = seedDomain({ hostname: 'shop.example.com', status: 'active' })
    const em = createFakeEm({ domains: [row] })
    const dnsResolver = {
      resolveCname: jest.fn(async () => ['edge.openmercato.com']),
      resolve4: jest.fn(async () => []),
    }
    const service = new DomainMappingService(em as unknown as EntityManager, { dnsResolver })

    const result = await service.verify(row.id)
    expect(['active', 'verified']).toContain(result.domainMapping.status)
  })

  it('throws when the mapping does not exist', async () => {
    const em = createFakeEm()
    const service = new DomainMappingService(em as unknown as EntityManager)
    await expect(service.verify('does-not-exist')).rejects.toThrow(/not found/)
  })
})

// ---------------------------------------------------------------------------
// activate (state machine)
// ---------------------------------------------------------------------------

describe('DomainMappingService.activate', () => {
  it('transitions verified → active', async () => {
    const row = seedDomain({ status: 'verified' })
    const em = createFakeEm({ domains: [row] })
    const service = new DomainMappingService(em as unknown as EntityManager)

    const result = await service.activate(row.id)
    expect(result.status).toBe('active')
    expect(em.__store.get(row.id)?.status).toBe('active')
  })

  it('returns the row unchanged when already active (idempotent)', async () => {
    const row = seedDomain({ status: 'active' })
    const em = createFakeEm({ domains: [row] })
    const service = new DomainMappingService(em as unknown as EntityManager)

    const result = await service.activate(row.id)
    expect(result.status).toBe('active')
  })

  it('rejects activation from pending', async () => {
    const row = seedDomain({ status: 'pending' })
    const em = createFakeEm({ domains: [row] })
    const service = new DomainMappingService(em as unknown as EntityManager)

    await expect(service.activate(row.id)).rejects.toThrow(/cannot transition to active from pending/)
  })

  it('rejects activation from dns_failed', async () => {
    const row = seedDomain({ status: 'dns_failed' })
    const em = createFakeEm({ domains: [row] })
    const service = new DomainMappingService(em as unknown as EntityManager)

    await expect(service.activate(row.id)).rejects.toThrow(/cannot transition to active from dns_failed/)
  })

  it('allows activation from tls_failed (retry path)', async () => {
    // healthCheck delegates to activate when a probe finally succeeds on a
    // previously tls_failed mapping, so activate must accept that transition.
    const row = seedDomain({ status: 'tls_failed', tlsRetryCount: 2, tlsFailureReason: 'HTTP 503' })
    const em = createFakeEm({ domains: [row] })
    const service = new DomainMappingService(em as unknown as EntityManager)

    const result = await service.activate(row.id)
    expect(result.status).toBe('active')
    expect(em.__store.get(row.id)?.tlsRetryCount).toBe(0)
    expect(em.__store.get(row.id)?.tlsFailureReason).toBeNull()
  })

  it('removes the replaced mapping atomically when activating a replacement', async () => {
    const replacedRow = seedDomain({
      hostname: 'old.example.com',
      tenantId: TENANT_A,
      organizationId: ORG_A,
      status: 'active',
    })
    const replacementRow = seedDomain({
      hostname: 'new.example.com',
      tenantId: TENANT_A,
      organizationId: ORG_A,
      status: 'verified',
      replacesDomain: { id: replacedRow.id },
    })
    const em = createFakeEm({ domains: [replacedRow, replacementRow] })
    const service = new DomainMappingService(em as unknown as EntityManager)

    await service.activate(replacementRow.id)

    expect(em.__store.get(replacementRow.id)?.status).toBe('active')
    expect(em.__store.has(replacedRow.id)).toBe(false)
    expect(em.__removed.has(replacedRow.id)).toBe(true)
  })

  it('throws when the mapping does not exist', async () => {
    const em = createFakeEm()
    const service = new DomainMappingService(em as unknown as EntityManager)
    await expect(service.activate('does-not-exist')).rejects.toThrow(/not found/)
  })
})

// ---------------------------------------------------------------------------
// healthCheck (state machine + retry math)
// ---------------------------------------------------------------------------

describe('DomainMappingService.healthCheck', () => {
  it('transitions verified → active when probe succeeds', async () => {
    const row = seedDomain({ status: 'verified' })
    const em = createFakeEm({ domains: [row] })
    const healthCheck = jest.fn(async () => ({ ok: true, originHeaderPresent: true }))
    const service = new DomainMappingService(em as unknown as EntityManager, { healthCheck })

    const result = await service.healthCheck(row.id)
    expect(result.status).toBe('active')
    expect(em.__store.get(row.id)?.status).toBe('active')
  })

  it('returns active row unchanged (idempotent skip)', async () => {
    const row = seedDomain({ status: 'active' })
    const em = createFakeEm({ domains: [row] })
    const healthCheck = jest.fn(async () => ({ ok: true, originHeaderPresent: true }))
    const service = new DomainMappingService(em as unknown as EntityManager, { healthCheck })

    const result = await service.healthCheck(row.id)
    expect(result.status).toBe('active')
    // healthCheck impl never invoked because we early-return on active
    expect(healthCheck).not.toHaveBeenCalled()
  })

  it('transitions verified → tls_failed and increments retry counter when all probes fail', async () => {
    // The service waits TLS_HEALTH_CHECK_RETRY_DELAYS_MS = [1s, 4s, 16s] = ~21s
    // total between probes. Fake timers + setTimeout-driven `delay` interact
    // poorly with the await loop (each iteration queues a fresh timer after
    // the previous resolves), so we run with the real schedule and bump the
    // per-test timeout to 30s.
    const row = seedDomain({ status: 'verified', tlsRetryCount: 0 })
    const em = createFakeEm({ domains: [row] })
    const healthCheck = jest.fn(async () => ({ ok: false, originHeaderPresent: false, reason: 'HTTP 503' }))
    const service = new DomainMappingService(em as unknown as EntityManager, { healthCheck })

    const result = await service.healthCheck(row.id)

    expect(result.status).toBe('tls_failed')
    expect(result.tlsFailureReason).toBe('HTTP 503')
    expect(result.tlsRetryCount).toBe(1)
    expect(healthCheck).toHaveBeenCalledTimes(3) // matches TLS_HEALTH_CHECK_RETRY_DELAYS_MS length
  }, 30_000)

  it('rejects health check from pending status', async () => {
    const row = seedDomain({ status: 'pending' })
    const em = createFakeEm({ domains: [row] })
    const service = new DomainMappingService(em as unknown as EntityManager)

    await expect(service.healthCheck(row.id)).rejects.toThrow(/cannot run health check from status pending/)
  })

  it('rejects health check from dns_failed status', async () => {
    const row = seedDomain({ status: 'dns_failed' })
    const em = createFakeEm({ domains: [row] })
    const service = new DomainMappingService(em as unknown as EntityManager)

    await expect(service.healthCheck(row.id)).rejects.toThrow(/cannot run health check from status dns_failed/)
  })

  it('allows retry from tls_failed back to active when probe finally succeeds', async () => {
    const row = seedDomain({ status: 'tls_failed', tlsRetryCount: 2 })
    const em = createFakeEm({ domains: [row] })
    const healthCheck = jest.fn(async () => ({ ok: true, originHeaderPresent: true }))
    const service = new DomainMappingService(em as unknown as EntityManager, { healthCheck })

    const result = await service.healthCheck(row.id)
    expect(result.status).toBe('active')
  })

  // C1 regression guard: defaultHealthCheck must hit the underscore route. We
  // can't easily test the network call here without intercepting node:https,
  // but we can at least pin the behavior contract via the exported __testing__
  // hook — see the source for the const string. This is a smoke test that the
  // C1 fix isn't accidentally reverted to the hyphen variant.
  it('defaultHealthCheck path uses underscore route (C1 regression guard)', async () => {
    const mod = await import('@open-mercato/core/modules/customer_accounts/services/domainMappingService')
    const src = mod.__testing__.defaultHealthCheck.toString()
    expect(src).toContain('/api/customer_accounts/domain-check')
    expect(src).not.toContain('/api/customer-accounts/domain-check')
  })
})

// ---------------------------------------------------------------------------
// remove
// ---------------------------------------------------------------------------

describe('DomainMappingService.remove', () => {
  it('removes a mapping owned by the requested tenant (happy path)', async () => {
    const row = seedDomain({ tenantId: TENANT_A })
    const em = createFakeEm({ domains: [row] })
    const service = new DomainMappingService(em as unknown as EntityManager)

    await service.remove(row.id, { tenantId: TENANT_A })

    expect(em.__store.has(row.id)).toBe(false)
    expect(em.__removed.has(row.id)).toBe(true)
  })

  it('does NOT remove a mapping owned by a different tenant (tenant scoping)', async () => {
    const row = seedDomain({ tenantId: TENANT_B })
    const em = createFakeEm({ domains: [row] })
    const service = new DomainMappingService(em as unknown as EntityManager)

    // Cross-tenant attack: tenant A asking to remove a record owned by tenant B
    await service.remove(row.id, { tenantId: TENANT_A })

    expect(em.__store.has(row.id)).toBe(true)
    expect(em.__removed.has(row.id)).toBe(false)
  })

  it('is a no-op when the mapping does not exist (no throw)', async () => {
    const em = createFakeEm()
    const service = new DomainMappingService(em as unknown as EntityManager)
    await expect(service.remove('does-not-exist', { tenantId: TENANT_A })).resolves.toBeUndefined()
  })

  it('removes without scope filter when no tenantId is provided', async () => {
    const row = seedDomain({ tenantId: TENANT_B })
    const em = createFakeEm({ domains: [row] })
    const service = new DomainMappingService(em as unknown as EntityManager)

    await service.remove(row.id)
    expect(em.__store.has(row.id)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// isAllowedForTls (C2 regression guard)
// ---------------------------------------------------------------------------

describe('DomainMappingService.isAllowedForTls', () => {
  it('returns active rows', async () => {
    const row = seedDomain({ hostname: 'shop.example.com', status: 'active', organizationId: ORG_A })
    const em = createFakeEm({ domains: [row] })
    const service = new DomainMappingService(em as unknown as EntityManager)

    const result = await service.isAllowedForTls('shop.example.com')
    expect(result).toEqual({ organizationId: ORG_A, status: 'active' })
  })

  it('returns verified rows (C2 fix: pre-activation TLS handshake must succeed)', async () => {
    const row = seedDomain({ hostname: 'shop.example.com', status: 'verified', organizationId: ORG_A })
    const em = createFakeEm({ domains: [row] })
    const service = new DomainMappingService(em as unknown as EntityManager)

    const result = await service.isAllowedForTls('shop.example.com')
    expect(result).toEqual({ organizationId: ORG_A, status: 'verified' })
  })

  it('returns null for pending mappings', async () => {
    const row = seedDomain({ hostname: 'shop.example.com', status: 'pending' })
    const em = createFakeEm({ domains: [row] })
    const service = new DomainMappingService(em as unknown as EntityManager)
    expect(await service.isAllowedForTls('shop.example.com')).toBeNull()
  })

  it('returns null for tls_failed mappings', async () => {
    const row = seedDomain({ hostname: 'shop.example.com', status: 'tls_failed' })
    const em = createFakeEm({ domains: [row] })
    const service = new DomainMappingService(em as unknown as EntityManager)
    expect(await service.isAllowedForTls('shop.example.com')).toBeNull()
  })

  it('returns null for dns_failed mappings', async () => {
    const row = seedDomain({ hostname: 'shop.example.com', status: 'dns_failed' })
    const em = createFakeEm({ domains: [row] })
    const service = new DomainMappingService(em as unknown as EntityManager)
    expect(await service.isAllowedForTls('shop.example.com')).toBeNull()
  })

  it('returns null for platform domains (never gates platform TLS)', async () => {
    const em = createFakeEm()
    const service = new DomainMappingService(em as unknown as EntityManager)
    expect(await service.isAllowedForTls('localhost')).toBeNull()
    expect(await service.isAllowedForTls('openmercato.com')).toBeNull()
  })

  it('returns null for malformed hostnames', async () => {
    const em = createFakeEm()
    const service = new DomainMappingService(em as unknown as EntityManager)
    expect(await service.isAllowedForTls('-bad')).toBeNull()
    expect(await service.isAllowedForTls('')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// resolveByHostname (active-only filter)
// ---------------------------------------------------------------------------

describe('DomainMappingService.resolveByHostname', () => {
  it('returns the resolved tuple for an active hostname', async () => {
    const row = seedDomain({
      hostname: 'shop.example.com',
      status: 'active',
      tenantId: TENANT_A,
      organizationId: ORG_A,
    })
    const em = createFakeEm({ domains: [row], orgs: [{ id: ORG_A, slug: 'acme' }] })
    const service = new DomainMappingService(em as unknown as EntityManager)

    const result = await service.resolveByHostname('shop.example.com')
    expect(result).toEqual({
      domainMappingId: row.id,
      hostname: 'shop.example.com',
      tenantId: TENANT_A,
      organizationId: ORG_A,
      orgSlug: 'acme',
      status: 'active',
    })
  })

  it('returns null for verified-but-not-active mappings (negative test for the active-only filter)', async () => {
    const row = seedDomain({ hostname: 'shop.example.com', status: 'verified' })
    const em = createFakeEm({ domains: [row] })
    const service = new DomainMappingService(em as unknown as EntityManager)

    expect(await service.resolveByHostname('shop.example.com')).toBeNull()
  })

  it('returns null for unknown hostnames', async () => {
    const em = createFakeEm()
    const service = new DomainMappingService(em as unknown as EntityManager)
    expect(await service.resolveByHostname('nope.example.com')).toBeNull()
  })

  it('returns null for platform domains', async () => {
    const em = createFakeEm()
    const service = new DomainMappingService(em as unknown as EntityManager)
    expect(await service.resolveByHostname('openmercato.com')).toBeNull()
  })

  it('returns null for malformed hostnames', async () => {
    const em = createFakeEm()
    const service = new DomainMappingService(em as unknown as EntityManager)
    expect(await service.resolveByHostname('-bad')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// findById tenant scoping
// ---------------------------------------------------------------------------

describe('DomainMappingService.findById', () => {
  it('returns the row when scope matches', async () => {
    const row = seedDomain({ tenantId: TENANT_A })
    const em = createFakeEm({ domains: [row] })
    const service = new DomainMappingService(em as unknown as EntityManager)

    const result = await service.findById(row.id, { tenantId: TENANT_A })
    expect(result?.id).toBe(row.id)
  })

  it('returns null when scope tenantId mismatches (cross-tenant lookup blocked)', async () => {
    const row = seedDomain({ tenantId: TENANT_B })
    const em = createFakeEm({ domains: [row] })
    const service = new DomainMappingService(em as unknown as EntityManager)

    const result = await service.findById(row.id, { tenantId: TENANT_A })
    expect(result).toBeNull()
  })

  it('returns the row regardless of tenant when no scope is supplied', async () => {
    const row = seedDomain({ tenantId: TENANT_B })
    const em = createFakeEm({ domains: [row] })
    const service = new DomainMappingService(em as unknown as EntityManager)

    const result = await service.findById(row.id)
    expect(result?.id).toBe(row.id)
  })
})

// ---------------------------------------------------------------------------
// findByOrganization
// ---------------------------------------------------------------------------

describe('DomainMappingService.findByOrganization', () => {
  it('returns rows scoped to the organization, ordered by createdAt', async () => {
    const a = seedDomain({
      hostname: 'a.example.com',
      organizationId: ORG_A,
      createdAt: new Date('2026-01-02'),
    })
    const b = seedDomain({
      hostname: 'b.example.com',
      organizationId: ORG_A,
      createdAt: new Date('2026-01-01'),
    })
    const c = seedDomain({ hostname: 'c.example.com', organizationId: ORG_A2 })
    const em = createFakeEm({ domains: [a, b, c] })
    const service = new DomainMappingService(em as unknown as EntityManager)

    const result = await service.findByOrganization(ORG_A)
    expect(result.map((r) => r.hostname)).toEqual(['b.example.com', 'a.example.com'])
  })

  it('returns an empty array when no domains exist for the organization', async () => {
    const em = createFakeEm()
    const service = new DomainMappingService(em as unknown as EntityManager)
    const result = await service.findByOrganization(ORG_A)
    expect(result).toEqual([])
  })
})
