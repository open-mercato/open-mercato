/** @jest-environment node */
import type { AwilixContainer } from 'awilix'
import { Lease, LeaseProposal, LeaseVersion, Unit } from '../data/entities'
import { FakeEm } from './support/fakeEm'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string) => key,
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))
const reportError = jest.fn()

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({ getTelemetryRuntime: () => ({ reportError }) }))
jest.mock('@open-mercato/shared/lib/encryption/find', () => jest.requireActual('./support/fakeEm').encryptionFindMock())
jest.mock('@open-mercato/queue', () => ({ createModuleQueue: jest.fn(() => ({ enqueue: jest.fn() })) }))
jest.mock('../lib/leaseEvents', () => ({
  emitLeaseEvent: jest.fn(async () => undefined),
  markLeaseChanged: jest.fn(async () => undefined),
}))

import { LEASE_SWEEP_MAX_END_ATTEMPTS, leaseEndCursorKey, listSweepScopes, runLeaseSweep } from '../lib/leaseSweep'
import { emitLeaseEvent } from '../lib/leaseEvents'

const scope = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }
const TODAY = '2030-06-15'

function seedLease(em: FakeEm, id: string, overrides: Partial<Lease> = {}): Lease {
  em.seed(Unit, { id: `unit-${id}`, ...scope, buildingId: 'b1', floorId: 'f1', spaceId: 's1', name: id, deletedAt: null } as never)
  return em.seed(Lease, {
    id,
    ...scope,
    reference: `L-${id}`,
    buildingId: 'b1',
    unitId: `unit-${id}`,
    customerCompanyId: 'company-1',
    status: 'active',
    startsOn: '2030-01-01',
    termMonths: 5,
    endsOn: '2030-05-31',
    pendingChange: null,
    deletedAt: null,
    ...overrides,
  } as never) as unknown as Lease
}

function sweepDeps(em: FakeEm) {
  const execute = jest.fn(async () => ({ result: { changed: false, reminded: false } }))
  const container = {
    resolve: (name: string) => {
      if (name === 'commandBus') return { execute }
      throw new Error(`[internal] unexpected ${name}`)
    },
  } as unknown as AwilixContainer
  return { deps: { container, em: em as never, today: TODAY, enqueuer: jest.fn(async () => undefined) }, execute }
}

beforeEach(() => jest.clearAllMocks())

describe('lease_sweep ending leases past their term', () => {
  it('ends an active lease past its term', async () => {
    const em = new FakeEm()
    const lease = seedLease(em, 'lease-a')
    const { deps } = sweepDeps(em)
    expect((await runLeaseSweep(deps, scope)).ended).toBe(1)
    expect(lease.status).toBe('ended')
    expect(emitLeaseEvent).toHaveBeenCalledWith('property_management.lease.ended', lease)
  })

  it('leaves a lease alone while its direct extension order is pending', async () => {
    const em = new FakeEm()
    const lease = seedLease(em, 'lease-b')
    em.seed(LeaseVersion, { id: 'v2', ...scope, leaseId: lease.id, versionNo: 2, event: 'extended', state: 'pending', holdToken: 'token-ext' } as never)
    const { deps } = sweepDeps(em)
    expect((await runLeaseSweep(deps, scope)).ended).toBe(0)
    expect(lease.status).toBe('active')
    expect(emitLeaseEvent).not.toHaveBeenCalled()
  })

  it('leaves a lease alone while its extension proposal is open', async () => {
    const em = new FakeEm()
    const lease = seedLease(em, 'lease-c')
    em.seed(LeaseProposal, { id: 'p1', ...scope, leaseId: lease.id, kind: 'extension', status: 'sent', respondBy: '2030-06-15', remindedAt: new Date() } as never)
    const { deps } = sweepDeps(em)
    expect((await runLeaseSweep(deps, scope)).ended).toBe(0)
    expect(lease.status).toBe('active')
  })

  it('ends the lease once a pending extension was released', async () => {
    const em = new FakeEm()
    const lease = seedLease(em, 'lease-d')
    em.seed(LeaseVersion, { id: 'v3', ...scope, leaseId: lease.id, versionNo: 2, event: 'extended', state: 'reverted', holdToken: null } as never)
    const { deps } = sweepDeps(em)
    expect((await runLeaseSweep(deps, scope)).ended).toBe(1)
    expect(lease.status).toBe('ended')
  })

  it('leaves a lease with a pending billing change alone', async () => {
    const em = new FakeEm()
    const lease = seedLease(em, 'lease-e', { pendingChange: { kind: 'end', changeId: 'c1', previous: {}, operationIds: [] } as never })
    const { deps } = sweepDeps(em)
    expect((await runLeaseSweep(deps, scope)).ended).toBe(0)
    expect(lease.status).toBe('active')
  })
})

function leaseId(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
}

function memoryCache() {
  const store = new Map<string, unknown>()
  return {
    store,
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    set: jest.fn(async (key: string, value: unknown) => {
      store.set(key, value)
    }),
    delete: jest.fn(async (key: string) => store.delete(key)),
  }
}

describe('lease_sweep paging through leases past their term', () => {
  it('resumes after the leases it could not end instead of re-reading the same first page', async () => {
    const em = new FakeEm()
    const blockedCount = LEASE_SWEEP_MAX_END_ATTEMPTS
    for (let index = 1; index <= blockedCount; index += 1) {
      const id = leaseId(index)
      seedLease(em, id, { endsOn: '2030-01-31' })
      em.seed(LeaseVersion, { id: `pending-${id}`, ...scope, leaseId: id, versionNo: 2, event: 'extended', state: 'pending', holdToken: 'token-ext' } as never)
    }
    const starved = seedLease(em, leaseId(blockedCount + 1), { endsOn: '2030-05-31' })
    const cache = memoryCache()
    const execute = jest.fn(async () => ({ result: { changed: false, reminded: false } }))
    const container = {
      resolve: (name: string) => {
        if (name === 'commandBus') return { execute }
        if (name === 'cache') return cache
        throw new Error(`[internal] unexpected ${name}`)
      },
    } as unknown as AwilixContainer
    const deps = { container, em: em as never, today: TODAY, enqueuer: jest.fn(async () => undefined) }

    expect((await runLeaseSweep(deps, scope)).ended).toBe(0)
    expect(starved.status).toBe('active')
    expect(cache.store.get(leaseEndCursorKey(scope))).toEqual({ endsOn: '2030-01-31', id: leaseId(blockedCount) })

    expect((await runLeaseSweep(deps, scope)).ended).toBe(1)
    expect(starved.status).toBe('ended')
  })

  it('clears the cursor once a run reaches every lease past its term', async () => {
    const em = new FakeEm()
    const lease = seedLease(em, leaseId(1))
    const cache = memoryCache()
    cache.store.set(leaseEndCursorKey(scope), { endsOn: '2030-05-31', id: leaseId(1) })
    const container = {
      resolve: (name: string) => {
        if (name === 'commandBus') return { execute: jest.fn(async () => ({ result: {} })) }
        if (name === 'cache') return cache
        throw new Error(`[internal] unexpected ${name}`)
      },
    } as unknown as AwilixContainer
    expect((await runLeaseSweep({ container, em: em as never, today: TODAY, enqueuer: jest.fn(async () => undefined) }, scope)).ended).toBe(1)
    expect(lease.status).toBe('ended')
    expect(cache.store.has(leaseEndCursorKey(scope))).toBe(false)
  })
})

describe('lease_sweep proposals', () => {
  it('leaves a sent proposal inside the reminder window unreminded while no portal notification is sent', async () => {
    const em = new FakeEm()
    const proposal = em.seed(LeaseProposal, { id: 'p3', ...scope, leaseId: 'other', kind: 'new', status: 'sent', respondBy: '2030-06-17', remindedAt: null } as never) as unknown as LeaseProposal
    const { deps, execute } = sweepDeps(em)
    const summary = await runLeaseSweep(deps, scope)
    expect(summary.reminded).toBe(0)
    expect(proposal.remindedAt).toBeNull()
    expect(execute).not.toHaveBeenCalled()
  })

  it('expires a proposal past its respond-by date', async () => {
    const em = new FakeEm()
    em.seed(LeaseProposal, { id: 'p4', ...scope, leaseId: 'other', kind: 'new', status: 'sent', respondBy: '2030-06-14', remindedAt: null } as never)
    const { deps, execute } = sweepDeps(em)
    execute.mockResolvedValueOnce({ result: { changed: true, reminded: false } })
    expect((await runLeaseSweep(deps, scope)).expired).toBe(1)
    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute).toHaveBeenCalledWith('property_management.lease_proposal.expire', expect.objectContaining({ input: { id: 'p4', ...scope } }))
  })
})

describe('lease_sweep step isolation', () => {
  it('still ends leases and re-enqueues operations when the proposal step fails', async () => {
    const em = new FakeEm()
    const lease = seedLease(em, 'lease-f')
    const container = {
      resolve: (name: string) => {
        throw new Error(`[internal] unexpected ${name}`)
      },
    } as unknown as AwilixContainer
    em.seed(LeaseProposal, { id: 'p2', ...scope, leaseId: 'other', kind: 'new', status: 'sent', respondBy: '2030-06-01', remindedAt: null } as never)
    const summary = await runLeaseSweep({ container, em: em as never, today: TODAY, enqueuer: jest.fn(async () => undefined) }, scope)
    expect(summary).toMatchObject({ ended: 1, expired: 0, reminded: 0 })
    expect(lease.status).toBe('ended')
    expect(reportError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ code: 'property_management.lease_sweep_step_failed', attributes: { step: 'proposals' } }),
    )
  })
})

describe('lease_sweep scopes', () => {
  it('lists every organization that ever had a building from the indexed buildings table instead of scanning leases, bookings and operations', async () => {
    const em = new FakeEm()
    em.respond = () => [
      { organization_id: scope.organizationId, tenant_id: scope.tenantId },
      { organization_id: 'org-2', tenant_id: 'tenant-2' },
    ]
    expect(await listSweepScopes(em as never)).toEqual([scope, { organizationId: 'org-2', tenantId: 'tenant-2' }])
    expect(em.executed).toHaveLength(1)
    const [{ sql, params }] = em.executed
    expect(sql).toBe('select distinct organization_id, tenant_id from property_management_buildings')
    expect(sql).not.toMatch(/deleted_at|property_management_leases|property_management_bookings|property_management_sales_operations/)
    expect(params).toEqual([])
  })
})
