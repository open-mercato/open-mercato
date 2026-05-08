/** @jest-environment node */
import type { MutationGuard, MutationGuardInput } from '@open-mercato/shared/lib/crud/mutation-guard-registry'

const TENANT_A = '11111111-1111-4111-8111-111111111111'
const TENANT_B = '22222222-2222-4222-8222-222222222222'
const ORG_A = '33333333-3333-4333-8333-333333333333'
const ORG_B = '55555555-5555-4555-8555-555555555555'

// ---------------------------------------------------------------------------
// In-memory DomainMappingService stand-in. The real guards resolve a
// `domainMappingService` from the request container via createRequestContainer
// — we mock that path so the guards run against an in-memory store and we can
// observe their decisions without booting the full DI graph.
// ---------------------------------------------------------------------------

type DomainRecord = {
  id: string
  hostname: string
  tenantId: string
  organizationId: string
  status: 'pending' | 'verified' | 'active' | 'dns_failed' | 'tls_failed'
}

type MockDomainService = {
  resolveByHostname: jest.Mock
  findByOrganization: jest.Mock
  findById: jest.Mock
}

const records: DomainRecord[] = []
let mockService: MockDomainService

function resetMockService() {
  records.length = 0
  mockService = {
    resolveByHostname: jest.fn(async (hostname: string) => {
      const found = records.find((r) => r.hostname === hostname && r.status === 'active')
      if (!found) return null
      return {
        domainMappingId: found.id,
        hostname: found.hostname,
        tenantId: found.tenantId,
        organizationId: found.organizationId,
        orgSlug: null,
        status: found.status,
      }
    }),
    findByOrganization: jest.fn(async (organizationId: string) =>
      records.filter((r) => r.organizationId === organizationId),
    ),
    findById: jest.fn(async (id: string, scope?: { tenantId?: string }) => {
      const found = records.find((r) => r.id === id)
      if (!found) return null
      if (scope?.tenantId && found.tenantId !== scope.tenantId) return null
      return found
    }),
  }
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (name: string) => {
      if (name === 'domainMappingService') return mockService
      throw new Error(`unknown service: ${name}`)
    },
  })),
}))

// Late import: jest.mock above must be hoisted before the guards module loads.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { guards } = require('@open-mercato/core/modules/customer_accounts/data/guards') as {
  guards: MutationGuard[]
}

function guardById(id: string): MutationGuard {
  const found = guards.find((g) => g.id === id)
  if (!found) throw new Error(`Guard ${id} not registered`)
  return found
}

function makeInput(overrides: Partial<MutationGuardInput> & { operation: 'create' | 'update' | 'delete' }): MutationGuardInput {
  // Use Object.hasOwn so explicit `null`/`undefined` overrides are honored —
  // `??` would silently fall through to the default for null inputs.
  const has = (key: keyof MutationGuardInput) => Object.prototype.hasOwnProperty.call(overrides, key)
  return {
    tenantId: has('tenantId') ? overrides.tenantId! : TENANT_A,
    organizationId: has('organizationId') ? overrides.organizationId! : ORG_A,
    userId: has('userId') ? overrides.userId! : 'user-1',
    resourceKind: has('resourceKind') ? overrides.resourceKind! : 'customer_accounts.domain_mapping',
    resourceId: has('resourceId') ? overrides.resourceId! : null,
    operation: overrides.operation,
    requestMethod: has('requestMethod') ? overrides.requestMethod! : 'POST',
    requestHeaders: has('requestHeaders') ? overrides.requestHeaders! : new Headers(),
    mutationPayload: has('mutationPayload') ? overrides.mutationPayload! : null,
  }
}

beforeEach(() => {
  resetMockService()
})

// ---------------------------------------------------------------------------
// hostnameFormat
// ---------------------------------------------------------------------------

describe('hostnameFormat guard', () => {
  const guard = () => guardById('customer_accounts.domain_mapping.hostname-format')

  it('declares operations: ["create"] only', () => {
    expect(guard().operations).toEqual(['create'])
  })

  it('rejects payloads with a missing hostname field', async () => {
    const result = await guard().validate(
      makeInput({ operation: 'create', mutationPayload: { organizationId: ORG_A } }),
    )
    expect(result).toMatchObject({ ok: false, status: 422 })
    expect(result.message).toMatch(/required/i)
  })

  it('rejects malformed hostnames (single label / leading dash / empty label)', async () => {
    for (const hostname of ['localhost', '-bad', 'shop..acme.com', '']) {
      const result = await guard().validate(
        makeInput({ operation: 'create', mutationPayload: { hostname, organizationId: ORG_A } }),
      )
      expect(result).toMatchObject({ ok: false, status: 422 })
    }
  })

  it('accepts valid hostnames and normalizes them in modifiedPayload', async () => {
    const result = await guard().validate(
      makeInput({
        operation: 'create',
        mutationPayload: { hostname: 'Shop.Example.com.', organizationId: ORG_A },
      }),
    )
    expect(result.ok).toBe(true)
    expect(result.modifiedPayload).toEqual({ hostname: 'shop.example.com' })
  })

  it('accepts IDN hostnames (Unicode → punycode in modifiedPayload)', async () => {
    const result = await guard().validate(
      makeInput({
        operation: 'create',
        mutationPayload: { hostname: 'shop.café.com', organizationId: ORG_A },
      }),
    )
    expect(result.ok).toBe(true)
    expect(result.modifiedPayload?.hostname).toBe('shop.xn--caf-dma.com')
  })
})

// ---------------------------------------------------------------------------
// hostnameUnique (cross-tenant attack)
// ---------------------------------------------------------------------------

describe('hostnameUnique guard', () => {
  const guard = () => guardById('customer_accounts.domain_mapping.hostname-unique')

  it('declares operations: ["create"] only', () => {
    expect(guard().operations).toEqual(['create'])
  })

  it('passes when no existing active mapping holds the hostname', async () => {
    const result = await guard().validate(
      makeInput({
        operation: 'create',
        mutationPayload: { hostname: 'shop.example.com', organizationId: ORG_A },
      }),
    )
    expect(result.ok).toBe(true)
  })

  it('blocks when another tenant already owns the hostname (cross-tenant attack)', async () => {
    records.push({
      id: 'foreign-1',
      hostname: 'shop.example.com',
      tenantId: TENANT_B,
      organizationId: ORG_B,
      status: 'active',
    })

    const result = await guard().validate(
      makeInput({
        operation: 'create',
        tenantId: TENANT_A,
        mutationPayload: { hostname: 'shop.example.com', organizationId: ORG_A },
      }),
    )
    expect(result).toMatchObject({ ok: false, status: 409 })
    expect(result.message).toMatch(/another organization/i)
  })

  it('blocks within the same tenant when another organization holds the hostname', async () => {
    records.push({
      id: 'same-tenant-other-org',
      hostname: 'shop.example.com',
      tenantId: TENANT_A,
      organizationId: ORG_B, // different org, same tenant
      status: 'active',
    })

    const result = await guard().validate(
      makeInput({
        operation: 'create',
        tenantId: TENANT_A,
        mutationPayload: { hostname: 'shop.example.com', organizationId: ORG_A },
      }),
    )
    expect(result).toMatchObject({ ok: false, status: 409 })
    expect(result.message).toMatch(/your tenant/i)
  })

  it('passes silently when payload omits hostname (defers to hostnameFormat)', async () => {
    const result = await guard().validate(
      makeInput({ operation: 'create', mutationPayload: { organizationId: ORG_A } }),
    )
    expect(result.ok).toBe(true)
  })

  it('passes silently when hostname is malformed (defers to hostnameFormat)', async () => {
    const result = await guard().validate(
      makeInput({ operation: 'create', mutationPayload: { hostname: '-bad', organizationId: ORG_A } }),
    )
    expect(result.ok).toBe(true)
  })

  it('normalizes hostname before lookup (punycode/lowercase/trailing-dot)', async () => {
    records.push({
      id: 'idn-1',
      hostname: 'shop.xn--caf-dma.com',
      tenantId: TENANT_B,
      organizationId: ORG_B,
      status: 'active',
    })

    const result = await guard().validate(
      makeInput({
        operation: 'create',
        tenantId: TENANT_A,
        mutationPayload: { hostname: 'Shop.café.com.', organizationId: ORG_A },
      }),
    )
    expect(result).toMatchObject({ ok: false, status: 409 })
  })

  it('does NOT block when only a non-active mapping (verified/pending) holds the hostname', async () => {
    // Only active mappings should be considered "in use" by the unique guard's
    // resolveByHostname call (which is active-only). A verified mapping by
    // another tenant should not block — the unique constraint is enforced at
    // the DB level for full uniqueness anyway.
    records.push({
      id: 'verified-by-other',
      hostname: 'shop.example.com',
      tenantId: TENANT_B,
      organizationId: ORG_B,
      status: 'verified',
    })

    const result = await guard().validate(
      makeInput({
        operation: 'create',
        tenantId: TENANT_A,
        mutationPayload: { hostname: 'shop.example.com', organizationId: ORG_A },
      }),
    )
    expect(result.ok).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// orgLimit
// ---------------------------------------------------------------------------

describe('orgLimit guard', () => {
  const guard = () => guardById('customer_accounts.domain_mapping.org-limit')

  it('declares operations: ["create"] only', () => {
    expect(guard().operations).toEqual(['create'])
  })

  it('passes when the organization has no existing domains', async () => {
    const result = await guard().validate(
      makeInput({ operation: 'create', mutationPayload: { hostname: 'a.example.com', organizationId: ORG_A } }),
    )
    expect(result.ok).toBe(true)
  })

  it('passes when the organization has exactly one existing domain (one slot left)', async () => {
    records.push({
      id: 'one',
      hostname: 'a.example.com',
      tenantId: TENANT_A,
      organizationId: ORG_A,
      status: 'active',
    })

    const result = await guard().validate(
      makeInput({ operation: 'create', mutationPayload: { hostname: 'b.example.com', organizationId: ORG_A } }),
    )
    expect(result.ok).toBe(true)
  })

  it('blocks when the organization already has the maximum (2) domains', async () => {
    records.push(
      { id: 'one', hostname: 'a.example.com', tenantId: TENANT_A, organizationId: ORG_A, status: 'active' },
      { id: 'two', hostname: 'b.example.com', tenantId: TENANT_A, organizationId: ORG_A, status: 'pending' },
    )

    const result = await guard().validate(
      makeInput({ operation: 'create', mutationPayload: { hostname: 'c.example.com', organizationId: ORG_A } }),
    )
    expect(result).toMatchObject({ ok: false, status: 409 })
    expect(result.message).toMatch(/at most 2/)
  })

  it('rejects payloads with no organizationId in either payload or input', async () => {
    const result = await guard().validate(
      makeInput({
        operation: 'create',
        organizationId: null as unknown as string,
        mutationPayload: { hostname: 'a.example.com' },
      }),
    )
    expect(result).toMatchObject({ ok: false, status: 422 })
  })

  it('falls back to input.organizationId when payload omits it', async () => {
    const result = await guard().validate(
      makeInput({
        operation: 'create',
        organizationId: ORG_A,
        mutationPayload: { hostname: 'a.example.com' },
      }),
    )
    expect(result.ok).toBe(true)
    expect(mockService.findByOrganization).toHaveBeenCalledWith(ORG_A)
  })

  it('counts only the organization in the payload, not unrelated organizations', async () => {
    // Tenant-isolated counting: domains in another organization (even same
    // tenant) must not contribute to ORG_A's quota.
    records.push(
      { id: 'b1', hostname: 'b1.example.com', tenantId: TENANT_A, organizationId: ORG_B, status: 'active' },
      { id: 'b2', hostname: 'b2.example.com', tenantId: TENANT_A, organizationId: ORG_B, status: 'pending' },
    )

    const result = await guard().validate(
      makeInput({ operation: 'create', mutationPayload: { hostname: 'a.example.com', organizationId: ORG_A } }),
    )
    expect(result.ok).toBe(true)
  })

  it('reads organization_id (snake_case) as a fallback for legacy payloads', async () => {
    const result = await guard().validate(
      makeInput({
        operation: 'create',
        organizationId: null as unknown as string,
        mutationPayload: { hostname: 'a.example.com', organization_id: ORG_A },
      }),
    )
    expect(result.ok).toBe(true)
    expect(mockService.findByOrganization).toHaveBeenCalledWith(ORG_A)
  })
})

// ---------------------------------------------------------------------------
// recordScope (H1 fix)
// ---------------------------------------------------------------------------

describe('recordScope guard', () => {
  const guard = () => guardById('customer_accounts.domain_mapping.record-scope')

  it('declares operations: ["update", "delete"]', () => {
    expect(guard().operations).toEqual(['update', 'delete'])
  })

  it('passes when the record exists and belongs to the caller tenant (update)', async () => {
    records.push({
      id: 'rec-1',
      hostname: 'shop.example.com',
      tenantId: TENANT_A,
      organizationId: ORG_A,
      status: 'pending',
    })

    const result = await guard().validate(
      makeInput({ operation: 'update', tenantId: TENANT_A, resourceId: 'rec-1' }),
    )
    expect(result.ok).toBe(true)
  })

  it('passes when the record exists and belongs to the caller tenant (delete)', async () => {
    records.push({
      id: 'rec-1',
      hostname: 'shop.example.com',
      tenantId: TENANT_A,
      organizationId: ORG_A,
      status: 'active',
    })

    const result = await guard().validate(
      makeInput({ operation: 'delete', tenantId: TENANT_A, resourceId: 'rec-1' }),
    )
    expect(result.ok).toBe(true)
  })

  it('returns 404 when the record does not exist', async () => {
    const result = await guard().validate(
      makeInput({ operation: 'update', tenantId: TENANT_A, resourceId: 'missing-id' }),
    )
    expect(result).toMatchObject({ ok: false, status: 404 })
  })

  it('returns 404 (not 403) when the record belongs to another tenant — cross-tenant attack', async () => {
    records.push({
      id: 'rec-1',
      hostname: 'shop.example.com',
      tenantId: TENANT_B,
      organizationId: ORG_B,
      status: 'active',
    })

    const result = await guard().validate(
      makeInput({ operation: 'update', tenantId: TENANT_A, resourceId: 'rec-1' }),
    )
    expect(result).toMatchObject({ ok: false, status: 404 })
    expect(mockService.findById).toHaveBeenCalledWith('rec-1', { tenantId: TENANT_A })
  })

  it('returns 422 when resourceId is missing', async () => {
    const result = await guard().validate(
      makeInput({ operation: 'update', tenantId: TENANT_A, resourceId: null }),
    )
    expect(result).toMatchObject({ ok: false, status: 422 })
  })

  it('cross-tenant delete blocked: tenant A cannot delete tenant B record', async () => {
    records.push({
      id: 'rec-1',
      hostname: 'shop.example.com',
      tenantId: TENANT_B,
      organizationId: ORG_B,
      status: 'active',
    })

    const result = await guard().validate(
      makeInput({ operation: 'delete', tenantId: TENANT_A, resourceId: 'rec-1' }),
    )
    expect(result).toMatchObject({ ok: false, status: 404 })
  })
})

// ---------------------------------------------------------------------------
// Registry integrity
// ---------------------------------------------------------------------------

describe('guards registry', () => {
  it('exports exactly the four expected guards', () => {
    const ids = guards.map((g) => g.id).sort()
    expect(ids).toEqual([
      'customer_accounts.domain_mapping.hostname-format',
      'customer_accounts.domain_mapping.hostname-unique',
      'customer_accounts.domain_mapping.org-limit',
      'customer_accounts.domain_mapping.record-scope',
    ])
  })

  it('targets all four guards at the same entity', () => {
    for (const guard of guards) {
      expect(guard.targetEntity).toBe('customer_accounts.domain_mapping')
    }
  })

  it('orders create-time guards by ascending priority (format < unique < limit)', () => {
    const formatPriority = guards.find((g) => g.id.endsWith('hostname-format'))?.priority ?? 0
    const uniquePriority = guards.find((g) => g.id.endsWith('hostname-unique'))?.priority ?? 0
    const limitPriority = guards.find((g) => g.id.endsWith('org-limit'))?.priority ?? 0
    expect(formatPriority).toBeLessThan(uniquePriority)
    expect(uniquePriority).toBeLessThan(limitPriority)
  })
})
