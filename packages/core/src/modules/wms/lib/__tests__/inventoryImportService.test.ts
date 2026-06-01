/** @jest-environment node */

import {
  InventoryBalance,
  InventoryLot,
  Warehouse,
  WarehouseLocation,
} from '../../data/entities'
import {
  applyInventoryImport,
  validateInventoryImport,
} from '../inventoryImportService'

const findOneWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryption(...args),
}))

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const WAREHOUSE_ID = '55555555-5555-4555-8555-555555555555'
const LOCATION_ID = '66666666-6666-4666-8666-666666666666'
const VARIANT_ID = '77777777-7777-4777-8777-777777777777'
const USER_ID = '99999999-9999-4999-8999-999999999999'

const queryEngine = {
  query: jest.fn(),
}

function createCtx() {
  return {
    container: {
      resolve: (name: string) => {
        if (name === 'em') return {}
        if (name === 'queryEngine') return queryEngine
        if (name === 'commandBus') {
          return {
            execute: jest.fn(async () => ({ result: { movementId: 'movement-1' } })),
          }
        }
        throw new Error(`Unexpected resolve: ${name}`)
      },
    },
    auth: { sub: USER_ID, tenantId: TENANT, orgId: ORG },
    organizationScope: null,
    selectedOrganizationId: ORG,
    organizationIds: [ORG],
  }
}

function mockWarehouseLocationVariant(currentOnHand = 0) {
  findOneWithDecryption.mockImplementation(async (_em, entity) => {
    if (entity === Warehouse) {
      return { id: WAREHOUSE_ID, code: 'WH-MAIN' }
    }
    if (entity === WarehouseLocation) {
      return { id: LOCATION_ID, code: 'BIN-1', warehouse: WAREHOUSE_ID }
    }
    if (entity === InventoryBalance) {
      if (currentOnHand <= 0) return null
      return { quantityOnHand: String(currentOnHand) }
    }
    if (entity === InventoryLot) return null
    return null
  })
  queryEngine.query.mockResolvedValue({
    items: [{ id: VARIANT_ID, sku: 'SKU-001' }],
  })
}

describe('validateInventoryImport', () => {
  beforeEach(() => {
    findOneWithDecryption.mockReset()
    queryEngine.query.mockReset()
  })

  it('marks duplicate rows as errors by default', async () => {
    mockWarehouseLocationVariant(0)
    const ctx = createCtx()
    const result = await validateInventoryImport(ctx, {
      tenantId: TENANT,
      organizationId: ORG,
      rows: [
        {
          warehouseCode: 'WH-MAIN',
          locationCode: 'BIN-1',
          sku: 'SKU-001',
          quantity: '10',
        },
        {
          warehouseCode: 'WH-MAIN',
          locationCode: 'BIN-1',
          sku: 'SKU-001',
          quantity: '20',
        },
      ],
    })

    expect(result.summary.errorRows).toBe(1)
    expect(result.rows[1]?.status).toBe('error')
    expect(result.rows[1]?.errors).toContain('duplicate_row')
  })

  it('skips duplicate rows when skipDuplicates is enabled', async () => {
    mockWarehouseLocationVariant(0)
    const ctx = createCtx()
    const result = await validateInventoryImport(ctx, {
      tenantId: TENANT,
      organizationId: ORG,
      skipDuplicates: true,
      rows: [
        {
          warehouseCode: 'WH-MAIN',
          locationCode: 'BIN-1',
          sku: 'SKU-001',
          quantity: '10',
        },
        {
          warehouseCode: 'WH-MAIN',
          locationCode: 'BIN-1',
          sku: 'SKU-001',
          quantity: '20',
        },
      ],
    })

    expect(result.summary.errorRows).toBe(0)
    expect(result.summary.skipRows).toBe(1)
    expect(result.rows[1]?.status).toBe('skip')
    expect(result.rows[1]?.warnings).toContain('duplicate_row')
  })

  it('reports sku_not_found when catalog lookup is empty', async () => {
    mockWarehouseLocationVariant(0)
    queryEngine.query.mockResolvedValue({ items: [] })
    const ctx = createCtx()
    const result = await validateInventoryImport(ctx, {
      tenantId: TENANT,
      organizationId: ORG,
      rows: [
        {
          warehouseCode: 'WH-MAIN',
          locationCode: 'BIN-1',
          sku: 'MISSING-SKU',
          quantity: '5',
        },
      ],
    })

    expect(result.rows[0]?.status).toBe('error')
    expect(result.rows[0]?.errors).toContain('sku_not_found')
  })

  it('calculates delta from current on-hand balance', async () => {
    mockWarehouseLocationVariant(4)
    const ctx = createCtx()
    const result = await validateInventoryImport(ctx, {
      tenantId: TENANT,
      organizationId: ORG,
      rows: [
        {
          warehouseCode: 'WH-MAIN',
          locationCode: 'BIN-1',
          sku: 'SKU-001',
          quantity: '10',
        },
      ],
    })

    expect(result.rows[0]?.resolved?.currentOnHand).toBe(4)
    expect(result.rows[0]?.resolved?.delta).toBe(6)
  })
})

describe('applyInventoryImport', () => {
  beforeEach(() => {
    findOneWithDecryption.mockReset()
    queryEngine.query.mockReset()
  })

  it('rejects tampered delta values before applying', async () => {
    mockWarehouseLocationVariant(0)
    const ctx = createCtx()

    await expect(
      applyInventoryImport(ctx, {
        tenantId: TENANT,
        organizationId: ORG,
        importBatchId: '88888888-8888-4888-8888-888888888888',
        performedBy: USER_ID,
        rows: [
          {
            rowNumber: 1,
            warehouseId: WAREHOUSE_ID,
            locationId: LOCATION_ID,
            catalogVariantId: VARIANT_ID,
            quantity: 10,
            delta: 999,
          },
        ],
      }),
    ).rejects.toMatchObject({
      status: 400,
      body: { error: 'import_delta_tampering', rowNumber: 1 },
    })
  })
})
