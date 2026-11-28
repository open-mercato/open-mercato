/** @jest-environment node */

import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import {
  InventoryBalance,
  ProductInventoryProfile,
  Warehouse,
  WarehouseLocation,
} from '../../data/entities'

jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({
  emitCrudSideEffects: jest.fn(async () => undefined),
}))

jest.mock('../../events', () => ({
  emitWmsEvent: jest.fn(async () => undefined),
}))

const findOneWithDecryption = jest.fn()
const findWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryption(...args),
  findWithDecryption: (...args: unknown[]) => findWithDecryption(...args),
}))

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const WAREHOUSE_ID = '55555555-5555-4555-8555-555555555555'
const LOCATION_ID = '66666666-6666-4666-8666-666666666666'
const VARIANT_ID = '77777777-7777-4777-8777-777777777777'
const USER_ID = '99999999-9999-4999-8999-999999999999'
const REFERENCE_ID = '88888888-8888-4888-8888-888888888888'
const LOT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

type TrackingProfile = { trackLot: boolean; trackSerial: boolean } | null

function createEm() {
  const em = {
    create: jest.fn((_entity: unknown, payload: Record<string, unknown>) => ({ id: 'generated-id', ...payload })),
    persist: jest.fn(),
    flush: jest.fn(async () => undefined),
    execute: jest.fn(async () => undefined),
    getReference: jest.fn((_entity: unknown, id: string) => ({ id })),
    fork: jest.fn(),
    transactional: jest.fn(),
  }
  em.fork.mockReturnValue(em)
  em.transactional.mockImplementation(async (cb: (trx: typeof em) => Promise<unknown>) => cb(em))
  return em
}

function createCtx(em: ReturnType<typeof createEm>) {
  return {
    container: {
      resolve: (name: string) => {
        if (name === 'em') return em
        if (name === 'dataEngine') return {}
        if (name === 'rbacService') return { userHasAllFeatures: async () => true }
        throw new Error(`Unexpected resolve: ${name}`)
      },
    },
    auth: { sub: USER_ID, tenantId: TENANT, orgId: ORG },
    organizationScope: null,
    selectedOrganizationId: ORG,
    organizationIds: [ORG],
  }
}

function untrackedBucket(quantityOnHand: string) {
  return {
    id: 'balance-untracked',
    tenantId: TENANT,
    organizationId: ORG,
    warehouse: { id: WAREHOUSE_ID },
    location: { id: LOCATION_ID },
    catalogVariantId: VARIANT_ID,
    lot: null,
    serialNumber: null,
    quantityOnHand,
    quantityReserved: '0',
    quantityAllocated: '0',
  }
}

function mockLookups(profile: TrackingProfile, existingBucket: ReturnType<typeof untrackedBucket> | null) {
  findOneWithDecryption.mockImplementation(async (_em, entity) => {
    if (entity === Warehouse) return { id: WAREHOUSE_ID, tenantId: TENANT, organizationId: ORG }
    if (entity === WarehouseLocation) {
      return { id: LOCATION_ID, tenantId: TENANT, organizationId: ORG, warehouse: { id: WAREHOUSE_ID }, isActive: true }
    }
    if (entity === ProductInventoryProfile && profile) {
      return { id: 'profile-1', tenantId: TENANT, organizationId: ORG, catalogVariantId: VARIANT_ID, ...profile }
    }
    if (entity === InventoryBalance) return existingBucket
    return null
  })
}

const baseInput = {
  organizationId: ORG,
  tenantId: TENANT,
  warehouseId: WAREHOUSE_ID,
  locationId: LOCATION_ID,
  catalogVariantId: VARIANT_ID,
  referenceId: REFERENCE_ID,
  performedBy: USER_ID,
}
const adjust = { command: 'wms.inventory.adjust', input: { ...baseInput, delta: 20, reason: 'correction', referenceType: 'manual' } }
const cycleCount = {
  command: 'wms.inventory.cycleCount',
  input: { ...baseInput, countedQuantity: 20, autoAdjust: true, reason: 'cycle count' },
}
const lotTracked = { trackLot: true, trackSerial: false }
const serialTracked = { trackLot: false, trackSerial: true }

async function run(target: typeof adjust | typeof cycleCount, overrides: Record<string, unknown>, em: ReturnType<typeof createEm>) {
  return commandRegistry.get(target.command)!.execute({ ...target.input, ...overrides }, createCtx(em) as never)
}

function createdBalances(em: ReturnType<typeof createEm>) {
  return em.create.mock.calls.filter(([entity]) => entity === InventoryBalance)
}

describe('wms inventory adjust / cycle-count lot and serial tracking', () => {
  beforeAll(async () => {
    await import('../inventory-actions')
  })

  beforeEach(() => {
    findOneWithDecryption.mockReset()
    findWithDecryption.mockReset()
  })

  it.each([
    ['adjust', 'lot_required', adjust, lotTracked, {}],
    ['adjust', 'serial_required', adjust, serialTracked, {}],
    ['adjust with only a lot', 'serial_required', adjust, { trackLot: true, trackSerial: true }, { lotId: LOT_ID }],
    ['cycle count', 'lot_required', cycleCount, lotTracked, {}],
    ['cycle count of zero', 'lot_required', cycleCount, lotTracked, { countedQuantity: 0 }],
  ])('%s refuses with %s instead of creating an untracked bucket', async (_label, error, target, profile, overrides) => {
    const em = createEm()
    mockLookups(profile, null)

    await expect(run(target, overrides, em)).rejects.toMatchObject({ status: 422, body: { error } })
    expect(createdBalances(em)).toHaveLength(0)
    expect(em.flush).not.toHaveBeenCalled()
  })

  it.each([
    ['a lot-tracked variant gets its lot', lotTracked, { lotId: LOT_ID }],
    ['the variant has no tracking', null, {}],
  ])('adjust creates the bucket when %s', async (_label, profile, overrides) => {
    const em = createEm()
    mockLookups(profile, null)

    await run(adjust, overrides, em)
    expect(createdBalances(em)).toHaveLength(1)
  })

  it.each([
    ['adjust', adjust, { delta: -3 }],
    ['cycle count', cycleCount, { countedQuantity: 2 }],
  ])('%s still corrects an untracked bucket that already exists for a lot-tracked variant', async (_label, target, overrides) => {
    const em = createEm()
    const existing = untrackedBucket('5')
    mockLookups(lotTracked, existing)

    await run(target, overrides, em)
    expect(existing.quantityOnHand).toBe('2')
    expect(createdBalances(em)).toHaveLength(0)
  })
})
