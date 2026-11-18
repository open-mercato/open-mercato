/** @jest-environment node */
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { Building, Lease, Unit } from '../data/entities'
import { FakeEm } from './support/fakeEm'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string) => key,
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => jest.requireActual('./support/fakeEm').encryptionFindMock())
jest.mock('@open-mercato/queue', () => ({ createModuleQueue: jest.fn(() => ({ enqueue: jest.fn() })) }))
jest.mock('@open-mercato/shared/lib/crud/optimistic-lock-command', () => ({ enforceCommandOptimisticLockWithGuards: jest.fn(async () => undefined) }))
jest.mock('../lib/buildingAccess', () => {
  const actual = jest.requireActual('../lib/buildingAccess')
  return { ...actual, permittedBuildingIds: jest.fn(async () => null) }
})
jest.mock('../lib/salesRecurrence', () => {
  const actual = jest.requireActual('../lib/salesRecurrence')
  return {
    ...actual,
    readRecurrence: jest.fn(async () => null),
    defaultCancelSettlement: jest.fn(async () => 'keep'),
    isRecurrenceCancelAvailable: jest.fn(async () => true),
  }
})
jest.mock('../lib/creditPermission', () => ({ hasCreditPermission: jest.fn(async () => true) }))
jest.mock('../lib/salesOperations', () => {
  const actual = jest.requireActual('../lib/salesOperations')
  return { ...actual, enqueueSalesOperations: jest.fn(async () => undefined) }
})
jest.mock('../lib/leaseEvents', () => {
  const actual = jest.requireActual('../lib/leaseEvents')
  return { ...actual, emitLeaseEvent: jest.fn(async () => undefined), emitProposalEvent: jest.fn(async () => undefined) }
})
jest.mock('../commands/shared', () => {
  const actual = jest.requireActual('../commands/shared')
  return { ...actual, emitSideEffects: jest.fn(async () => undefined) }
})

import '../commands'
import { lockLeaseRow } from '../lib/leaseRecords'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const scope = { tenantId: TENANT, organizationId: ORG }
const BUILDING = '71000000-0000-4000-8000-000000000001'
const UNIT = '71000000-0000-4000-8000-000000000002'
const LEASE = '71000000-0000-4000-8000-000000000003'

function seed(em: FakeEm, status: Lease['status']): Lease {
  em.seed(Building, { id: BUILDING, ...scope, name: 'Harbor Point', status: 'active', deletedAt: null } as never)
  em.seed(Unit, { id: UNIT, ...scope, buildingId: BUILDING, floorId: 'f1', spaceId: 's1', name: 'Studio 2B', deletedAt: new Date('2030-01-05T10:00:00Z') } as never)
  return em.seed(Lease, {
    id: LEASE,
    ...scope,
    reference: 'L-2030-001',
    buildingId: BUILDING,
    unitId: UNIT,
    customerCompanyId: 'company-1',
    primaryContactPersonId: null,
    currentVersionId: null,
    salesOrderId: null,
    status,
    startsOn: '2030-02-01',
    endsOn: '2030-07-31',
    termMonths: 6,
    pendingChange: null,
    billingAttention: false,
    lastBillingRefusal: null,
    holdToken: null,
    deletedAt: null,
  } as never) as unknown as Lease
}

function buildCtx(em: FakeEm): CommandRuntimeContext {
  return {
    container: {
      resolve: (name: string) => {
        if (name === 'em') return em
        throw new Error(`[internal] unexpected ${name}`)
      },
    } as never,
    auth: { sub: 'user-1', tenantId: TENANT, orgId: ORG } as never,
    organizationScope: null,
    selectedOrganizationId: ORG,
    organizationIds: [ORG],
  }
}

describe('a lease whose unit was deleted afterwards', () => {
  it('still locks the lease row through its deleted unit', async () => {
    const em = new FakeEm()
    seed(em, 'withdrawn')
    await expect(lockLeaseRow(em as never, scope, LEASE)).resolves.toMatchObject({ id: LEASE })
  })

  it.each(['withdrawn', 'expired'] as const)('can be deleted once %s', async (status) => {
    const em = new FakeEm()
    const lease = seed(em, status)
    const handler = commandRegistry.get('property_management.lease.delete')
    if (!handler) throw new Error('[internal] missing property_management.lease.delete')
    await expect(handler.execute({ ...scope, id: LEASE }, buildCtx(em))).resolves.toMatchObject({ leaseId: LEASE, pending: false })
    expect(lease.deletedAt).toBeInstanceOf(Date)
  })
})
