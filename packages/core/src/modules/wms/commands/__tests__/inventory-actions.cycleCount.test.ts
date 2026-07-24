/** @jest-environment node */

import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
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
  }
  em.fork.mockReturnValue(em)
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
})
