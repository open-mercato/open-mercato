/** @jest-environment node */

import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { emitWmsEvent } from '../../events'
import {
  InventoryBalance,
  InventoryMovement,
  Warehouse,
  WarehouseLocation,
} from '../../data/entities'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string) => key,
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

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

function createEm() {
  const em = {
    findOne: jest.fn(),
    create: jest.fn((_entity: unknown, payload: Record<string, unknown>) => ({
      id: 'balance-1',
      ...payload,
    })),
    persist: jest.fn(),
    flush: jest.fn(async () => undefined),
    getReference: jest.fn((_entity: unknown, id: string) => ({ id })),
    fork: jest.fn(),
    transactional: jest.fn(),
  }
  em.fork.mockReturnValue(em)
  em.transactional.mockImplementation(
    async (cb: (trx: typeof em) => Promise<unknown>) => cb(em),
  )
  return em
}

function createCtx(em: ReturnType<typeof createEm>) {
  return {
    container: {
      resolve: (name: string) => {
        if (name === 'em') return em
        if (name === 'dataEngine') return {}
        throw new Error(`Unexpected resolve: ${name}`)
      },
    },
    auth: { sub: USER_ID, tenantId: TENANT, orgId: ORG },
    organizationScope: null,
    selectedOrganizationId: ORG,
    organizationIds: [ORG],
  }
}

describe('wms inventory cycle count command', () => {
  beforeAll(async () => {
    await import('../inventory-actions')
  })

  beforeEach(() => {
    findOneWithDecryption.mockReset()
    findWithDecryption.mockReset()
    ;(emitWmsEvent as jest.Mock).mockClear()
    ;(emitCrudSideEffects as jest.Mock).mockClear()
  })

  it('rejects variance commits when autoAdjust is false', async () => {
    const em = createEm()
    const balance = {
      id: 'balance-1',
      tenantId: TENANT,
      organizationId: ORG,
      warehouse: { id: WAREHOUSE_ID },
      location: { id: LOCATION_ID },
      catalogVariantId: VARIANT_ID,
      lot: null,
      serialNumber: null,
      quantityOnHand: '5',
    }

    findOneWithDecryption.mockImplementation((_em, entity) => {
      if (entity === Warehouse) {
        return {
          id: WAREHOUSE_ID,
          tenantId: TENANT,
          organizationId: ORG,
        }
      }
      if (entity === WarehouseLocation) {
        return {
          id: LOCATION_ID,
          tenantId: TENANT,
          organizationId: ORG,
          warehouse: { id: WAREHOUSE_ID },
        }
      }
      if (entity === InventoryBalance) {
        return balance
      }
      if (entity === InventoryMovement) {
        return null
      }
      return null
    })

    const handler = commandRegistry.get('wms.inventory.cycleCount')
    await expect(
      handler!.execute!(
        {
          organizationId: ORG,
          tenantId: TENANT,
          warehouseId: WAREHOUSE_ID,
          locationId: LOCATION_ID,
          catalogVariantId: VARIANT_ID,
          countedQuantity: 3,
          autoAdjust: false,
          reason: 'cycle_count',
          referenceId: REFERENCE_ID,
          performedBy: USER_ID,
        },
        createCtx(em),
      ),
    ).rejects.toMatchObject({
      status: 422,
      body: { error: 'auto_adjust_required' },
    } satisfies Partial<CrudHttpError>)
  })

  describe('counted stock versus reserved + allocated stock', () => {
    type BalanceFixture = {
      id: string
      tenantId: string
      organizationId: string
      warehouse: { id: string }
      location: { id: string }
      catalogVariantId: string
      lot: null
      serialNumber: null
      quantityOnHand: string
      quantityReserved: string
      quantityAllocated: string
    }

    function buildBalance(onHand: string, reserved: string, allocated = '0'): BalanceFixture {
      return {
        id: 'balance-1',
        tenantId: TENANT,
        organizationId: ORG,
        warehouse: { id: WAREHOUSE_ID },
        location: { id: LOCATION_ID },
        catalogVariantId: VARIANT_ID,
        lot: null,
        serialNumber: null,
        quantityOnHand: onHand,
        quantityReserved: reserved,
        quantityAllocated: allocated,
      }
    }

    function mockLookups(balance: BalanceFixture) {
      findOneWithDecryption.mockImplementation((_em, entity) => {
        if (entity === Warehouse) return { id: WAREHOUSE_ID, tenantId: TENANT, organizationId: ORG }
        if (entity === WarehouseLocation) {
          return { id: LOCATION_ID, tenantId: TENANT, organizationId: ORG, warehouse: { id: WAREHOUSE_ID } }
        }
        if (entity === InventoryBalance) return balance
        return null
      })
    }

    async function runCycleCount(em: ReturnType<typeof createEm>, countedQuantity: number) {
      const handler = commandRegistry.get('wms.inventory.cycleCount')
      return handler!.execute!(
        {
          organizationId: ORG,
          tenantId: TENANT,
          warehouseId: WAREHOUSE_ID,
          locationId: LOCATION_ID,
          catalogVariantId: VARIANT_ID,
          countedQuantity,
          autoAdjust: true,
          reason: 'cycle_count',
          referenceId: REFERENCE_ID,
          performedBy: USER_ID,
        },
        createCtx(em),
      ) as Promise<{ adjustmentDelta: string; movementId: string | null }>
    }

    function availableOf(balance: BalanceFixture): number {
      return Number(balance.quantityOnHand) - Number(balance.quantityReserved) - Number(balance.quantityAllocated)
    }

    function persistedMovements(em: ReturnType<typeof createEm>) {
      return em.create.mock.calls.filter(([entity]) => entity === InventoryMovement)
    }

    it.each([
      { counted: 9, label: 'count 9 against 10 reserved' },
      { counted: 8, label: 'count 8 against 10 reserved' },
      { counted: 0, label: 'count 0 against 10 reserved' },
    ])('rejects $label and leaves the balance, ledger and reservations untouched', async ({ counted }) => {
      const em = createEm()
      const balance = buildBalance('102', '10')
      mockLookups(balance)

      await expect(runCycleCount(em, counted)).rejects.toMatchObject({
        status: 409,
        body: { error: 'insufficient_stock', countedQuantity: String(counted), committedQuantity: '10' },
      } satisfies Partial<CrudHttpError>)

      expect(balance.quantityOnHand).toBe('102')
      expect(balance.quantityReserved).toBe('10')
      expect(availableOf(balance)).toBe(92)
      expect(persistedMovements(em)).toHaveLength(0)
      expect(em.flush).not.toHaveBeenCalled()
      expect(em.transactional).toHaveBeenCalledTimes(1)
      expect(emitWmsEvent).not.toHaveBeenCalled()
      expect(emitCrudSideEffects).not.toHaveBeenCalled()
    })

    it('counts allocated stock as committed, not only reserved stock', async () => {
      const em = createEm()
      const balance = buildBalance('102', '6', '4')
      mockLookups(balance)

      await expect(runCycleCount(em, 9)).rejects.toMatchObject({
        status: 409,
        body: { error: 'insufficient_stock', committedQuantity: '10' },
      } satisfies Partial<CrudHttpError>)
      expect(balance.quantityOnHand).toBe('102')
      expect(persistedMovements(em)).toHaveLength(0)
    })

    it.each([
      { reserved: '10', allocated: '0' },
      { reserved: '6', allocated: '4' },
      { reserved: '0', allocated: '10' },
    ])('accepts a count exactly equal to committed stock (reserved $reserved, allocated $allocated)', async ({ reserved, allocated }) => {
      const em = createEm()
      const balance = buildBalance('102', reserved, allocated)
      mockLookups(balance)

      const result = await runCycleCount(em, 10)

      expect(result.adjustmentDelta).toBe('-92')
      expect(result.movementId).toBeTruthy()
      expect(balance.quantityOnHand).toBe('10')
      expect(balance.quantityReserved).toBe(reserved)
      expect(balance.quantityAllocated).toBe(allocated)
      expect(availableOf(balance)).toBe(0)
      const movements = persistedMovements(em)
      expect(movements).toHaveLength(1)
      expect(movements[0][1]).toMatchObject({ type: 'cycle_count', quantity: '-92' })
      expect(em.flush).toHaveBeenCalled()
      expect(emitWmsEvent).toHaveBeenCalledWith(
        'wms.inventory.reconciled',
        expect.objectContaining({ adjustmentDelta: '-92' }),
      )
    })

    it('accepts a normal shrinkage count that stays above committed stock', async () => {
      const em = createEm()
      const balance = buildBalance('102', '10')
      mockLookups(balance)

      const result = await runCycleCount(em, 95)

      expect(result.adjustmentDelta).toBe('-7')
      expect(balance.quantityOnHand).toBe('95')
      expect(availableOf(balance)).toBe(85)
      expect(persistedMovements(em)).toHaveLength(1)
    })

    it('accepts shrinkage down to zero when nothing is reserved or allocated', async () => {
      const em = createEm()
      const balance = buildBalance('102', '0')
      mockLookups(balance)

      const result = await runCycleCount(em, 0)

      expect(result.adjustmentDelta).toBe('-102')
      expect(balance.quantityOnHand).toBe('0')
      expect(persistedMovements(em)).toHaveLength(1)
    })

    it('accepts an overage count on a balance with reservations', async () => {
      const em = createEm()
      const balance = buildBalance('102', '10')
      mockLookups(balance)

      const result = await runCycleCount(em, 110)

      expect(result.adjustmentDelta).toBe('8')
      expect(balance.quantityOnHand).toBe('110')
      expect(availableOf(balance)).toBe(100)
    })

    it('still lets a count raise on-hand on an already overcommitted balance', async () => {
      const em = createEm()
      const balance = buildBalance('5', '10')
      mockLookups(balance)

      const result = await runCycleCount(em, 7)

      expect(result.adjustmentDelta).toBe('2')
      expect(balance.quantityOnHand).toBe('7')
    })

    it('treats a count matching on-hand as a no-op without writing a movement', async () => {
      const em = createEm()
      const balance = buildBalance('102', '10')
      mockLookups(balance)

      const result = await runCycleCount(em, 102)

      expect(result).toEqual({ adjustmentDelta: '0', movementId: null })
      expect(persistedMovements(em)).toHaveLength(0)
      expect(emitWmsEvent).not.toHaveBeenCalled()
    })

    it('applies the same availability bound as an ordinary negative adjustment', async () => {
      const handler = commandRegistry.get('wms.inventory.adjust')
      const adjust = async (delta: number) => {
        const em = createEm()
        const balance = buildBalance('102', '10')
        mockLookups(balance)
        const outcome = await handler!.execute!(
          {
            organizationId: ORG,
            tenantId: TENANT,
            warehouseId: WAREHOUSE_ID,
            locationId: LOCATION_ID,
            catalogVariantId: VARIANT_ID,
            delta,
            reason: 'damage',
            referenceId: REFERENCE_ID,
            performedBy: USER_ID,
          },
          createCtx(em),
        ).then(() => 'ok', (error: CrudHttpError) => error.body?.error)
        return { outcome, balance }
      }

      const overcommitted = await adjust(-93)
      expect(overcommitted.outcome).toBe('insufficient_stock')
      expect(overcommitted.balance.quantityOnHand).toBe('102')

      const exact = await adjust(-92)
      expect(exact.outcome).toBe('ok')
      expect(exact.balance.quantityOnHand).toBe('10')
    })
  })
})
