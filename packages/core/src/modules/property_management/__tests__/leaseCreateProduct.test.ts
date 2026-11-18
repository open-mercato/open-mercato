/** @jest-environment node */
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CatalogProduct } from '@open-mercato/core/modules/catalog/data/entities'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import {
  Building,
  Lease,
  LeaseReferenceCounter,
  PropertyManagementSettings,
  Unit,
  UnitProductPeriod,
} from '../data/entities'
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
jest.mock('../lib/leaseRecords', () => {
  const actual = jest.requireActual('../lib/leaseRecords')
  return { ...actual, lockUnitRow: jest.fn(actual.lockUnitRow) }
})
jest.mock('../lib/salesOperations', () => {
  const actual = jest.requireActual('../lib/salesOperations')
  return { ...actual, enqueueSalesOperations: jest.fn(async () => undefined) }
})
jest.mock('../commands/shared', () => {
  const actual = jest.requireActual('../commands/shared')
  return { ...actual, emitSideEffects: jest.fn(async () => undefined) }
})

import '../commands'
import { lockUnitRow } from '../lib/leaseRecords'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const scope = { tenantId: TENANT, organizationId: ORG }
const BUILDING = '50000000-0000-4000-8000-000000000001'
const UNIT = '50000000-0000-4000-8000-000000000002'
const PRODUCT = '50000000-0000-4000-8000-000000000003'
const OTHER_PRODUCT = '50000000-0000-4000-8000-000000000004'
const COMPANY = '50000000-0000-4000-8000-000000000005'
const CHANNEL = '50000000-0000-4000-8000-000000000006'

const actualLockUnitRow = jest.requireActual('../lib/leaseRecords').lockUnitRow as typeof lockUnitRow

function nextMonthStart(): string {
  const date = new Date()
  return `${date.getFullYear() + 1}-${String(date.getMonth() + 1).padStart(2, '0')}-01`
}

function seed(): FakeEm {
  const em = new FakeEm()
  em.seed(Building, { id: BUILDING, ...scope, name: 'Harbor Point', status: 'active', deletedAt: null } as never)
  em.seed(Unit, { id: UNIT, ...scope, buildingId: BUILDING, floorId: 'f1', spaceId: 's1', name: 'Studio 2B', catalogProductId: PRODUCT, deletedAt: null } as never)
  em.seed(UnitProductPeriod, {
    id: 'period-1',
    ...scope,
    unitId: UNIT,
    catalogProductId: PRODUCT,
    productName: 'Private office',
    use: 'leasable',
    billingUnit: 'month',
    priceAmount: '1200.0000',
    currencyCode: 'PLN',
    validTo: null,
  } as never)
  em.seed(CatalogProduct, { id: PRODUCT, ...scope, title: 'Private office', deletedAt: null } as never)
  em.seed(CustomerEntity, { id: COMPANY, ...scope, kind: 'company', displayName: 'Solstice Analytics', deletedAt: null } as never)
  em.seed(PropertyManagementSettings, { id: 'settings-1', ...scope, billingChannelId: CHANNEL } as never)
  em.seed(LeaseReferenceCounter, { id: 'counter-1', ...scope, year: new Date().getFullYear(), lastNumber: 0 } as never)
  return em
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

async function createLease(em: FakeEm): Promise<{ leaseId: string }> {
  const handler = commandRegistry.get('property_management.lease.create')
  if (!handler) throw new Error('[internal] missing property_management.lease.create')
  return handler.execute(
    { ...scope, unitId: UNIT, customerCompanyId: COMPANY, startsOn: nextMonthStart(), termMonths: 12, monthlyRate: 1200 },
    buildCtx(em),
  ) as Promise<{ leaseId: string }>
}

async function expectConflict(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise
  } catch (err) {
    expect(err).toBeInstanceOf(CrudHttpError)
    expect((err as CrudHttpError).status).toBe(409)
    expect((err as CrudHttpError).body).toMatchObject({ code })
    return
  }
  throw new Error('[internal] expected the command to fail')
}

function switchPeriodWhileLocking(em: FakeEm, next: Partial<Record<'catalogProductId' | 'use' | 'billingUnit', string>>): void {
  jest.mocked(lockUnitRow).mockImplementationOnce(async (trx, lockScope, unitId) => {
    const current = em.rows(UnitProductPeriod)[0] as unknown as UnitProductPeriod
    const switchedAt = new Date()
    current.validTo = switchedAt
    em.seed(UnitProductPeriod, {
      id: 'period-2',
      ...scope,
      unitId: current.unitId,
      catalogProductId: current.catalogProductId,
      productName: current.productName,
      use: current.use,
      billingUnit: current.billingUnit,
      priceAmount: null,
      currencyCode: null,
      validFrom: switchedAt,
      validTo: null,
      ...next,
    } as never)
    return actualLockUnitRow(trx, lockScope, unitId)
  })
}

beforeEach(() => jest.clearAllMocks())

describe('property_management.lease.create product serialisation', () => {
  it('creates the lease when the unit product is unchanged under the lock', async () => {
    const em = seed()
    const result = await createLease(em)
    expect(lockUnitRow).toHaveBeenCalledWith(expect.anything(), scope, UNIT)
    expect(em.rows(Lease)).toHaveLength(1)
    expect(result.leaseId).toBe(em.rows(Lease)[0].id)
  })

  it('refuses the lease when a product change commits between the pre-check and the unit lock', async () => {
    const em = seed()
    switchPeriodWhileLocking(em, { catalogProductId: OTHER_PRODUCT })
    await expectConflict(createLease(em), 'lease_product_changed')
    expect(em.rows(Lease)).toHaveLength(0)
  })

  it('refuses the lease when the unit product becomes bookable before the unit lock', async () => {
    const em = seed()
    switchPeriodWhileLocking(em, { use: 'bookable', billingUnit: 'hour' })
    await expectConflict(createLease(em), 'lease_product_changed')
    expect(em.rows(Lease)).toHaveLength(0)
  })

  it('refuses the lease when the unit moved away and back to the same product before the unit lock', async () => {
    const em = seed()
    switchPeriodWhileLocking(em, {})
    await expectConflict(createLease(em), 'lease_product_changed')
    expect(em.rows(Lease)).toHaveLength(0)
    expect((em.rows(UnitProductPeriod) as unknown as UnitProductPeriod[]).find((period) => period.id === 'period-2')?.priceAmount).toBeNull()
  })
})
