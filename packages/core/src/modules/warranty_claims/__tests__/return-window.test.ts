import type { EntityManager } from '@mikro-orm/postgresql'
import { WarrantyClaim, WarrantyClaimSettings } from '../data/entities'
import { warrantyClaimSettingsUpdateSchema, type WarrantyClaimType } from '../data/validators'
import { evaluateClaimRisk } from '../lib/risk'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const CLAIM_ID = '33333333-3333-4333-8333-333333333333'
const ORDER_ID = '44444444-4444-4444-8444-444444444444'
const NOW = new Date('2026-07-16T12:00:00.000Z')
const MILLISECONDS_PER_DAY = 86_400_000

type OrderDateRow = {
  placedAt: Date | string | null
  createdAt: Date | string | null
}

type WhereClause = {
  column: string
  op: string
  value: unknown
}

type QueryBuilder = {
  select: jest.Mock<QueryBuilder, [unknown]>
  where: jest.Mock<QueryBuilder, [string, string, unknown]>
  execute: jest.Mock<Promise<Array<Record<string, unknown>>>, []>
  executeTakeFirst: jest.Mock<Promise<Record<string, unknown> | undefined>, []>
}

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * MILLISECONDS_PER_DAY)
}

function makeSettings(returnWindowDays: number | null): WarrantyClaimSettings {
  const settings = new WarrantyClaimSettings()
  settings.id = '55555555-5555-4555-8555-555555555555'
  settings.tenantId = TENANT_ID
  settings.organizationId = ORGANIZATION_ID
  settings.returnWindowDays = returnWindowDays
  return settings
}

function makeClaim(claimType: WarrantyClaimType = 'return'): WarrantyClaim {
  return {
    id: CLAIM_ID,
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    claimType,
    orderId: ORDER_ID,
    customerId: null,
    currencyCode: null,
  } as unknown as WarrantyClaim
}

function makeEntityManager(input: {
  returnWindowDays: number | null
  order?: OrderDateRow
  salesOrdersError?: unknown
}) {
  const findOne = jest.fn<Promise<WarrantyClaimSettings | null>, [unknown, unknown]>()
    .mockResolvedValue(makeSettings(input.returnWindowDays))
  const selectedTables: string[] = []
  const whereByTable = new Map<string, WhereClause[]>()
  const selectFrom = jest.fn((table: string) => {
    selectedTables.push(table)
    const wheres: WhereClause[] = []
    whereByTable.set(table, wheres)
    const builder = {} as QueryBuilder
    builder.select = jest.fn(() => builder)
    builder.where = jest.fn((column: string, op: string, value: unknown) => {
      wheres.push({ column, op, value })
      return builder
    })
    builder.execute = jest.fn(async () => {
      if (table === 'warranty_claims') return []
      if (table === 'sales_orders') {
        if (input.salesOrdersError) throw input.salesOrdersError
        return input.order ? [input.order] : []
      }
      throw new Error(`Unexpected table: ${table}`)
    })
    builder.executeTakeFirst = jest.fn(async () => (await builder.execute())[0])
    return builder
  })
  const em = {
    findOne,
    getKysely: () => ({ selectFrom }),
  } as unknown as EntityManager
  return { em, findOne, selectedTables, whereByTable }
}

async function assess(input: {
  returnWindowDays: number | null
  order?: OrderDateRow
  claimType?: WarrantyClaimType
  salesOrdersError?: unknown
}) {
  const harness = makeEntityManager(input)
  const result = await evaluateClaimRisk(harness.em, makeClaim(input.claimType), [], NOW)
  return { ...harness, result }
}

describe('return-window risk signal', () => {
  test.each([
    { label: 'inside', elapsedDays: 29 },
    { label: 'at the boundary', elapsedDays: 30 },
  ])('does not signal when a claim is $label', async ({ elapsedDays }) => {
    const { result } = await assess({
      returnWindowDays: 30,
      order: { placedAt: daysAgo(elapsedDays), createdAt: daysAgo(40) },
    })

    expect(result).toEqual({ level: 'none', signals: [] })
  })

  test('emits a medium signal immediately outside the window', async () => {
    const { result, whereByTable } = await assess({
      returnWindowDays: 30,
      order: { placedAt: daysAgo(31), createdAt: daysAgo(60) },
    })

    expect(result).toEqual({
      level: 'medium',
      signals: [{
        id: 'outside_return_window',
        level: 'medium',
        messageKey: 'warranty_claims.risk.outsideReturnWindow',
        params: { days: 31, window: 30 },
      }],
    })
    expect(whereByTable.get('sales_orders')).toEqual(expect.arrayContaining([
      { column: 'id', op: '=', value: ORDER_ID },
      { column: 'tenant_id', op: '=', value: TENANT_ID },
      { column: 'organization_id', op: '=', value: ORGANIZATION_ID },
      { column: 'deleted_at', op: 'is', value: null },
    ]))
  })

  test('uses placed_at before created_at', async () => {
    const { result } = await assess({
      returnWindowDays: 30,
      order: { placedAt: daysAgo(31), createdAt: daysAgo(1) },
    })

    expect(result.signals).toContainEqual(expect.objectContaining({
      id: 'outside_return_window',
      params: { days: 31, window: 30 },
    }))
  })

  test('falls back to created_at when placed_at is missing', async () => {
    const { result } = await assess({
      returnWindowDays: 30,
      order: { placedAt: null, createdAt: daysAgo(31) },
    })

    expect(result.signals).toContainEqual(expect.objectContaining({
      id: 'outside_return_window',
      params: { days: 31, window: 30 },
    }))
  })

  test('escalates only after twice the configured window', async () => {
    const atTwice = await assess({
      returnWindowDays: 30,
      order: { placedAt: daysAgo(60), createdAt: daysAgo(60) },
    })
    const afterTwice = await assess({
      returnWindowDays: 30,
      order: { placedAt: daysAgo(61), createdAt: daysAgo(61) },
    })

    expect(atTwice.result.signals).toContainEqual(expect.objectContaining({
      id: 'outside_return_window',
      level: 'medium',
    }))
    expect(afterTwice.result.signals).toContainEqual(expect.objectContaining({
      id: 'outside_return_window',
      level: 'high',
    }))
  })

  test('does not signal when the order has no usable date', async () => {
    const { result } = await assess({
      returnWindowDays: 30,
      order: { placedAt: null, createdAt: null },
    })

    expect(result).toEqual({ level: 'none', signals: [] })
  })

  test('does not signal warranty claims', async () => {
    const { result, findOne, selectedTables } = await assess({
      returnWindowDays: 30,
      order: { placedAt: daysAgo(90), createdAt: daysAgo(90) },
      claimType: 'warranty',
    })

    expect(result).toEqual({ level: 'none', signals: [] })
    expect(findOne).not.toHaveBeenCalled()
    expect(selectedTables).not.toContain('sales_orders')
  })

  test('does not signal when the setting is null', async () => {
    const { result, selectedTables } = await assess({
      returnWindowDays: null,
      order: { placedAt: daysAgo(90), createdAt: daysAgo(90) },
    })

    expect(result).toEqual({ level: 'none', signals: [] })
    expect(selectedTables).not.toContain('sales_orders')
  })

  test('degrades to no signal when the optional sales table is missing', async () => {
    const { result } = await assess({
      returnWindowDays: 30,
      salesOrdersError: { code: '42P01', message: 'relation "sales_orders" does not exist' },
    })

    expect(result).toEqual({ level: 'none', signals: [] })
  })
})

describe('return-window settings validation', () => {
  test.each([null, 1, 3650])('accepts %p', (returnWindowDays) => {
    expect(warrantyClaimSettingsUpdateSchema.safeParse({ returnWindowDays }).success).toBe(true)
  })

  test.each([0, -1, 5000])('rejects %p', (returnWindowDays) => {
    expect(warrantyClaimSettingsUpdateSchema.safeParse({ returnWindowDays }).success).toBe(false)
  })
})
