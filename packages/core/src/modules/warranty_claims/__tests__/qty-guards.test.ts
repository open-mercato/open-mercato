import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const CLAIM_ID = '33333333-3333-4333-8333-333333333333'
const OTHER_CLAIM_ID = '44444444-4444-4444-8444-444444444444'
const ORDER_LINE_ID = '55555555-5555-4555-8555-555555555555'
const LINE_ID = '66666666-6666-4666-8666-666666666666'
const OTHER_LINE_ID = '77777777-7777-4777-8777-777777777777'
const SCOPE = { tenantId: TENANT_ID, organizationId: ORG_ID }

const mockEntityRegistry: {
  sales?: { sales_order_line: string }
} = {
  sales: { sales_order_line: 'sales:sales_order_line' },
}
const mockFindWithDecryption = jest.fn<Promise<unknown[]>, [unknown, unknown, unknown, unknown?, unknown?]>()

jest.mock('#generated/entities.ids.generated', () => ({
  E: mockEntityRegistry,
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: (...args: [unknown, unknown, unknown, unknown?, unknown?]) => mockFindWithDecryption(...args),
}))

import { WarrantyClaim, WarrantyClaimLine } from '../data/entities'
import {
  assertClaimedQtyWithinSold,
  type ClaimedQuantityLine,
} from '../commands/claims'
import { evaluateClaimRisk } from '../lib/risk'

type SoldRow = {
  id: string
  quantity: string | number | null
}

type GuardHarness = {
  ctx: CommandRuntimeContext
  executeTakeFirst: jest.Mock<Promise<SoldRow | undefined>, []>
  resolve: jest.Mock<unknown, [string]>
  selectFrom: jest.Mock<unknown, [string]>
}

type WhereClause = {
  column: string
  op: string
  value: unknown
}

type RiskSoldRow = SoldRow & {
  tenantId: string
  organizationId: string
  deletedAt: Date | null
}

type RiskOtherLineRow = {
  orderLineId: string | null
  qtyClaimed: string | number | null
  claimNumber: string | null
  lineStatus: string
  claimStatus: string
  claimId: string
  tenantId: string
  organizationId: string
  deletedAt: Date | null
  claimDeletedAt: Date | null
}

type RiskQueryBuilder = {
  innerJoin: jest.Mock<RiskQueryBuilder, [string, string, string]>
  select: jest.Mock<RiskQueryBuilder, [unknown]>
  where: jest.Mock<RiskQueryBuilder, [string, string, unknown]>
  execute: jest.Mock<Promise<Array<Record<string, unknown>>>, []>
  executeTakeFirst: jest.Mock<Promise<Record<string, unknown> | undefined>, []>
}

function makeGuardHarness(salesRow?: SoldRow): GuardHarness {
  const executeTakeFirst = jest.fn<Promise<SoldRow | undefined>, []>().mockResolvedValue(salesRow)
  const builder: {
    select: jest.Mock
    where: jest.Mock
    executeTakeFirst: typeof executeTakeFirst
  } = {
    select: jest.fn(),
    where: jest.fn(),
    executeTakeFirst,
  }
  builder.select.mockReturnValue(builder)
  builder.where.mockReturnValue(builder)
  const selectFrom = jest.fn<unknown, [string]>(() => builder)
  const emHolder: {
    fork: jest.Mock
    getKysely: jest.Mock
  } = {
    fork: jest.fn(),
    getKysely: jest.fn(() => ({ selectFrom })),
  }
  emHolder.fork.mockReturnValue(emHolder)
  const resolve = jest.fn<unknown, [string]>((name) => {
    if (name === 'em') return emHolder as unknown as EntityManager
    throw new Error(`Unexpected dependency: ${name}`)
  })
  return {
    ctx: { container: { resolve } } as unknown as CommandRuntimeContext,
    executeTakeFirst,
    resolve,
    selectFrom,
  }
}

async function expectQuantityExceeded(action: Promise<void>): Promise<void> {
  await expect(action).rejects.toBeInstanceOf(CrudHttpError)
  await expect(action).rejects.toMatchObject({
    status: 400,
    body: { error: 'warranty_claims.errors.qtyExceedsOrdered' },
  })
}

function hasWhere(
  wheres: WhereClause[],
  column: string,
  op: string,
  value: unknown,
): boolean {
  return wheres.some((where) => where.column === column && where.op === op && where.value === value)
}

function includedIds(wheres: WhereClause[], column: string): string[] | null {
  const clause = wheres.find((where) => where.column === column && where.op === 'in')
  if (!clause || !Array.isArray(clause.value)) return null
  return clause.value.filter((value): value is string => typeof value === 'string')
}

function makeRiskEntityManager(
  soldRows: RiskSoldRow[],
  otherRows: RiskOtherLineRow[],
): EntityManager {
  const selectFrom = jest.fn((table: string) => {
    const wheres: WhereClause[] = []
    const builder = {} as RiskQueryBuilder
    builder.innerJoin = jest.fn(() => builder)
    builder.select = jest.fn(() => builder)
    builder.where = jest.fn((column: string, op: string, value: unknown) => {
      wheres.push({ column, op, value })
      return builder
    })
    builder.execute = jest.fn(async () => {
      if (table === 'sales_order_lines') {
        const ids = includedIds(wheres, 'id')
        return soldRows
          .filter((row) => !ids || ids.includes(row.id))
          .filter((row) => !hasWhere(wheres, 'tenant_id', '=', TENANT_ID) || row.tenantId === TENANT_ID)
          .filter((row) => !hasWhere(wheres, 'organization_id', '=', ORG_ID) || row.organizationId === ORG_ID)
          .filter((row) => !hasWhere(wheres, 'deleted_at', 'is', null) || row.deletedAt === null)
          .map((row) => ({ id: row.id, quantity: row.quantity }))
      }
      if (table === 'warranty_claim_lines') {
        const ids = includedIds(wheres, 'warranty_claim_lines.order_line_id')
        return otherRows
          .filter((row) => !ids || (row.orderLineId !== null && ids.includes(row.orderLineId)))
          .filter((row) => !hasWhere(wheres, 'warranty_claim_lines.tenant_id', '=', TENANT_ID) || row.tenantId === TENANT_ID)
          .filter((row) => !hasWhere(wheres, 'warranty_claim_lines.organization_id', '=', ORG_ID) || row.organizationId === ORG_ID)
          .filter((row) => !hasWhere(wheres, 'warranty_claim_lines.deleted_at', 'is', null) || row.deletedAt === null)
          .filter((row) => !hasWhere(wheres, 'warranty_claim_lines.line_status', '!=', 'rejected') || row.lineStatus !== 'rejected')
          .filter((row) => !hasWhere(wheres, 'warranty_claims.tenant_id', '=', TENANT_ID) || row.tenantId === TENANT_ID)
          .filter((row) => !hasWhere(wheres, 'warranty_claims.organization_id', '=', ORG_ID) || row.organizationId === ORG_ID)
          .filter((row) => !hasWhere(wheres, 'warranty_claims.deleted_at', 'is', null) || row.claimDeletedAt === null)
          .filter((row) => !hasWhere(wheres, 'warranty_claims.id', '!=', CLAIM_ID) || row.claimId !== CLAIM_ID)
          .filter((row) => !hasWhere(wheres, 'warranty_claims.status', '!=', 'cancelled') || row.claimStatus !== 'cancelled')
          .map((row) => ({
            orderLineId: row.orderLineId,
            qtyClaimed: row.qtyClaimed,
            claimNumber: row.claimNumber,
          }))
      }
      throw new Error(`Unexpected table: ${table}`)
    })
    builder.executeTakeFirst = jest.fn(async () => (await builder.execute())[0])
    return builder
  })
  return {
    getKysely: () => ({ selectFrom }),
  } as unknown as EntityManager
}

function makeClaim(): WarrantyClaim {
  return {
    id: CLAIM_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    orderId: null,
    customerId: null,
    currencyCode: null,
  } as unknown as WarrantyClaim
}

function makeRiskLine(overrides: Partial<WarrantyClaimLine> = {}): WarrantyClaimLine {
  return {
    id: LINE_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    orderLineId: ORDER_LINE_ID,
    qtyClaimed: '0.5000',
    lineStatus: 'pending',
    serialNumber: null,
    deletedAt: null,
    ...overrides,
  } as unknown as WarrantyClaimLine
}

function makeSoldRow(quantity = '1.0000'): RiskSoldRow {
  return {
    id: ORDER_LINE_ID,
    quantity,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    deletedAt: null,
  }
}

function makeOtherRiskRow(overrides: Partial<RiskOtherLineRow> = {}): RiskOtherLineRow {
  return {
    orderLineId: ORDER_LINE_ID,
    qtyClaimed: '0.5000',
    claimNumber: 'WTY-000002',
    lineStatus: 'pending',
    claimStatus: 'in_review',
    claimId: OTHER_CLAIM_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    deletedAt: null,
    claimDeletedAt: null,
    ...overrides,
  }
}

describe('warranty claim sold quantity guards', () => {
  beforeEach(() => {
    mockEntityRegistry.sales = { sales_order_line: 'sales:sales_order_line' }
    mockFindWithDecryption.mockReset()
  })

  test('rejects a single line claiming more than the sold quantity', async () => {
    const harness = makeGuardHarness({ id: ORDER_LINE_ID, quantity: '1.0000' })

    await expectQuantityExceeded(assertClaimedQtyWithinSold(harness.ctx, SCOPE, [], {
      orderLineId: ORDER_LINE_ID,
      qtyClaimed: '1.0001',
    }))
  })

  test('rejects pending lines on the same claim that cumulatively exceed sold quantity', async () => {
    const harness = makeGuardHarness({ id: ORDER_LINE_ID, quantity: '1.0000' })
    const pendingLines: ClaimedQuantityLine[] = [{
      id: LINE_ID,
      orderLineId: ORDER_LINE_ID,
      qtyClaimed: '0.6000',
    }]

    await expectQuantityExceeded(assertClaimedQtyWithinSold(harness.ctx, SCOPE, pendingLines, {
      id: OTHER_LINE_ID,
      orderLineId: ORDER_LINE_ID,
      qtyClaimed: '0.5000',
    }))
  })

  test('sums id-less pending lines from the inline create path instead of self-excluding them', async () => {
    const harness = makeGuardHarness({ id: ORDER_LINE_ID, quantity: '2.0000' })
    const pendingLines: ClaimedQuantityLine[] = [{
      orderLineId: ORDER_LINE_ID,
      qtyClaimed: '1.0000',
    }]

    await expectQuantityExceeded(assertClaimedQtyWithinSold(harness.ctx, SCOPE, pendingLines, {
      orderLineId: ORDER_LINE_ID,
      qtyClaimed: '2.0000',
    }))
  })

  test('rejects persisted lines on the same claim that cumulatively exceed sold quantity', async () => {
    const harness = makeGuardHarness({ id: ORDER_LINE_ID, quantity: '1.0000' })
    mockFindWithDecryption.mockResolvedValue([{
      id: LINE_ID,
      orderLineId: ORDER_LINE_ID,
      qtyClaimed: '0.6000',
      deletedAt: null,
    }])

    await expectQuantityExceeded(assertClaimedQtyWithinSold(harness.ctx, SCOPE, CLAIM_ID, {
      id: OTHER_LINE_ID,
      orderLineId: ORDER_LINE_ID,
      qtyClaimed: '0.5000',
    }))

    expect(mockFindWithDecryption).toHaveBeenCalledWith(
      expect.anything(),
      WarrantyClaimLine,
      {
        claim: CLAIM_ID,
        orderLineId: ORDER_LINE_ID,
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
        deletedAt: null,
      },
      {},
      SCOPE,
    )
  })

  test('excludes the candidate previous row when validating an update', async () => {
    const harness = makeGuardHarness({ id: ORDER_LINE_ID, quantity: '1.0000' })
    mockFindWithDecryption.mockResolvedValue([
      { id: LINE_ID, orderLineId: ORDER_LINE_ID, qtyClaimed: '0.8000', deletedAt: null },
      { id: OTHER_LINE_ID, orderLineId: ORDER_LINE_ID, qtyClaimed: '0.1000', deletedAt: null },
    ])

    await expect(assertClaimedQtyWithinSold(harness.ctx, SCOPE, CLAIM_ID, {
      id: LINE_ID,
      orderLineId: ORDER_LINE_ID,
      qtyClaimed: '0.9000',
    })).resolves.toBeUndefined()
  })

  test('skips validation and database access without an order line reference', async () => {
    const harness = makeGuardHarness({ id: ORDER_LINE_ID, quantity: '1.0000' })

    await expect(assertClaimedQtyWithinSold(harness.ctx, SCOPE, [], {
      orderLineId: null,
      qtyClaimed: '999.0000',
    })).resolves.toBeUndefined()

    expect(harness.resolve).not.toHaveBeenCalled()
    expect(harness.selectFrom).not.toHaveBeenCalled()
  })

  test('skips validation and database access when the sales module is absent', async () => {
    mockEntityRegistry.sales = undefined
    const harness = makeGuardHarness({ id: ORDER_LINE_ID, quantity: '1.0000' })

    await expect(assertClaimedQtyWithinSold(harness.ctx, SCOPE, [], {
      orderLineId: ORDER_LINE_ID,
      qtyClaimed: '999.0000',
    })).resolves.toBeUndefined()

    expect(harness.resolve).not.toHaveBeenCalled()
    expect(harness.selectFrom).not.toHaveBeenCalled()
  })

  test.each([
    ['missing row', undefined],
    ['null sold quantity', { id: ORDER_LINE_ID, quantity: null }],
  ] as const)('skips validation for a %s', async (_label, salesRow) => {
    const harness = makeGuardHarness(salesRow)

    await expect(assertClaimedQtyWithinSold(harness.ctx, SCOPE, [], {
      orderLineId: ORDER_LINE_ID,
      qtyClaimed: '999.0000',
    })).resolves.toBeUndefined()

    expect(harness.executeTakeFirst).toHaveBeenCalledTimes(1)
    expect(mockFindWithDecryption).not.toHaveBeenCalled()
  })

  test('uses exact numeric scale when the difference is one ten-thousandth', async () => {
    const harness = makeGuardHarness({ id: ORDER_LINE_ID, quantity: '1.0000' })

    await expectQuantityExceeded(assertClaimedQtyWithinSold(harness.ctx, SCOPE, [], {
      orderLineId: ORDER_LINE_ID,
      qtyClaimed: '1.0001',
    }))
  })

  test('allows exact cumulative equality at numeric scale', async () => {
    const harness = makeGuardHarness({ id: ORDER_LINE_ID, quantity: '1.0000' })

    await expect(assertClaimedQtyWithinSold(harness.ctx, SCOPE, [{
      id: LINE_ID,
      orderLineId: ORDER_LINE_ID,
      qtyClaimed: '0.5000',
    }], {
      id: OTHER_LINE_ID,
      orderLineId: ORDER_LINE_ID,
      qtyClaimed: '0.5000',
    })).resolves.toBeUndefined()
  })

  test('accepts exponent input while preserving numeric scale comparison', async () => {
    const harness = makeGuardHarness({ id: ORDER_LINE_ID, quantity: '1e0' })

    await expect(assertClaimedQtyWithinSold(harness.ctx, SCOPE, [{
      id: LINE_ID,
      orderLineId: ORDER_LINE_ID,
      qtyClaimed: '5e-1',
    }], {
      id: OTHER_LINE_ID,
      orderLineId: ORDER_LINE_ID,
      qtyClaimed: '5e-1',
    })).resolves.toBeUndefined()
  })
})

describe('warranty claim over quantity risk', () => {
  test('emits a medium signal with related claims when cumulative quantity exceeds sold', async () => {
    const em = makeRiskEntityManager([makeSoldRow()], [
      makeOtherRiskRow({ qtyClaimed: '0.3000', claimNumber: 'WTY-000003' }),
      makeOtherRiskRow({ qtyClaimed: '0.2000', claimNumber: 'WTY-000002' }),
    ])

    const result = await evaluateClaimRisk(em, makeClaim(), [makeRiskLine({ qtyClaimed: '0.6000' })])

    expect(result).toEqual({
      level: 'medium',
      signals: [{
        id: 'over_quantity_claim',
        level: 'medium',
        messageKey: 'warranty_claims.risk.overQuantityClaim',
        params: { count: 1.1, sold: 1 },
        relatedClaimNumbers: ['WTY-000002', 'WTY-000003'],
      }],
    })
  })

  test('escalates the signal to high at twice the sold quantity', async () => {
    const em = makeRiskEntityManager([makeSoldRow()], [
      makeOtherRiskRow({ qtyClaimed: '1.2500' }),
    ])

    const result = await evaluateClaimRisk(em, makeClaim(), [makeRiskLine({ qtyClaimed: '0.7500' })])

    expect(result.level).toBe('high')
    expect(result.signals).toContainEqual(expect.objectContaining({
      id: 'over_quantity_claim',
      level: 'high',
      params: { count: 2, sold: 1 },
      relatedClaimNumbers: ['WTY-000002'],
    }))
  })

  test('excludes rejected lines and lines on cancelled claims', async () => {
    const em = makeRiskEntityManager([makeSoldRow()], [
      makeOtherRiskRow({ qtyClaimed: '0.7500', lineStatus: 'rejected', claimNumber: 'WTY-REJECTED' }),
      makeOtherRiskRow({ qtyClaimed: '0.7500', claimStatus: 'cancelled', claimNumber: 'WTY-CANCELLED' }),
    ])
    const lines = [
      makeRiskLine({ qtyClaimed: '0.5000' }),
      makeRiskLine({ id: OTHER_LINE_ID, qtyClaimed: '0.7500', lineStatus: 'rejected' }),
    ]

    const result = await evaluateClaimRisk(em, makeClaim(), lines)

    expect(result).toEqual({ level: 'none', signals: [] })
  })

  test('does not emit a cross-claim signal for only current claim quantities within sold', async () => {
    const em = makeRiskEntityManager([makeSoldRow()], [])
    const lines = [
      makeRiskLine({ qtyClaimed: '0.5000' }),
      makeRiskLine({ id: OTHER_LINE_ID, qtyClaimed: '0.5000' }),
    ]

    const result = await evaluateClaimRisk(em, makeClaim(), lines)

    expect(result).toEqual({ level: 'none', signals: [] })
  })
})
