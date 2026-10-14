/** @jest-environment node */

import { createContainer, asValue, InjectionMode } from 'awilix'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { DefaultSalesCalculationService } from '../../services/salesCalculationService'
import { registerSalesTotalsCalculator } from '../../lib/calculations'
import type { SalesDocumentCalculationResult } from '../../lib/types'
import { SalesOrder, SalesQuote } from '../../data/entities'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string, fallback?: string) => fallback ?? key,
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))
jest.mock('@open-mercato/shared/lib/crud/cache', () => ({ invalidateCrudCache: jest.fn() }))
jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({
  emitCrudSideEffects: jest.fn().mockResolvedValue(undefined),
}))

const organizationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const tenantId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const documentId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const editedLineId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const otherLineId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const firstAdjustmentId = '11111111-1111-4111-8111-111111111111'
const secondAdjustmentId = '22222222-2222-4222-8222-222222222222'

type StoredRecord = Record<string, unknown> & { id: string }
type TestWorld = {
  document: Record<string, unknown>
  lines: StoredRecord[]
  adjustments: StoredRecord[]
}
let mockWorld: TestWorld

const isLineEntity = (name: string | undefined) => name === 'SalesOrderLine' || name === 'SalesQuoteLine'
const isAdjustmentEntity = (name: string | undefined) =>
  name === 'SalesOrderAdjustment' || name === 'SalesQuoteAdjustment'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(async (_em: unknown, entityClass: unknown) => {
    if (entityClass === SalesOrder || entityClass === SalesQuote) return mockWorld.document
    return null
  }),
  findWithDecryption: jest.fn(async (_em: unknown, entityClass: { name?: string }) => {
    if (isLineEntity(entityClass.name)) return [...mockWorld.lines]
    if (isAdjustmentEntity(entityClass.name)) return [...mockWorld.adjustments]
    return []
  }),
}))

function buildLine(id: string, lineNumber: number, unitPrice: string): StoredRecord {
  return {
    id,
    lineNumber,
    kind: 'product',
    name: `Line ${lineNumber}`,
    currencyCode: 'USD',
    quantity: '1',
    unitPriceNet: unitPrice,
    unitPriceGross: unitPrice,
    taxRate: '0',
    taxAmount: '0',
    discountAmount: '0',
    discountPercent: '0',
    totalNetAmount: unitPrice,
    totalGrossAmount: unitPrice,
    updatedAt: new Date('2026-10-01T00:00:00Z'),
  }
}

function buildAdjustment(id: string, position: number, amount: string): StoredRecord {
  return {
    id,
    scope: 'order',
    kind: 'surcharge',
    label: `Surcharge ${position}`,
    currencyCode: 'USD',
    amountNet: amount,
    amountGross: amount,
    position,
  }
}

function setWorld(withAdjustments: boolean) {
  mockWorld = {
    document: {
      id: documentId,
      organizationId,
      tenantId,
      deletedAt: null,
      currencyCode: 'USD',
      paidTotalAmount: '0',
      refundedTotalAmount: '0',
      updatedAt: new Date('2026-10-01T00:00:00Z'),
    },
    lines: [buildLine(editedLineId, 1, '10'), buildLine(otherLineId, 2, '20')],
    adjustments: withAdjustments
      ? [buildAdjustment(firstAdjustmentId, 0, '1'), buildAdjustment(secondAdjustmentId, 1, '2')]
      : [],
  }
}

function makeContext(documentKind: 'order' | 'quote', results: SalesDocumentCalculationResult[]) {
  const em = {
    fork() { return this },
    find: jest.fn(async (entityClass: { name?: string }) => {
      if (isLineEntity(entityClass.name)) return [...mockWorld.lines]
      if (isAdjustmentEntity(entityClass.name)) return [...mockWorld.adjustments]
      return []
    }),
    findOne: jest.fn(async () => null),
    count: jest.fn(async () => 0),
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => data),
    persist: jest.fn(),
    remove: jest.fn(),
    flush: jest.fn(async () => {}),
    begin: jest.fn(async () => {}),
    commit: jest.fn(async () => {}),
    rollback: jest.fn(async () => {}),
    isInTransaction: jest.fn(() => false),
    getUnitOfWork: () => ({ getChangeSets: () => [], computeChangeSets: () => {} }),
    getReference: jest.fn((_entity: unknown, id: string) => ({ id })),
    getConnection: () => ({ execute: jest.fn(async () => [{ value: 1 }]) }),
  }
  const calculationService = new DefaultSalesCalculationService(null)
  const calculateDocumentTotals = calculationService.calculateDocumentTotals.bind(calculationService)
  calculationService.calculateDocumentTotals = async (opts) => {
    const result = await calculateDocumentTotals(opts)
    results.push(result)
    return result
  }
  const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
  container.register({
    em: asValue(em),
    dataEngine: asValue({ markOrmEntityChange: jest.fn() }),
    salesCalculationService: asValue(calculationService),
  })
  return {
    container,
    auth: { tenantId, orgId: organizationId, sub: 'user-1' },
    selectedOrganizationId: organizationId,
    organizationScope: null,
    organizationIds: null,
    request: new Request(`https://example.test/api/sales/${documentKind}-lines`, { method: 'PUT' }),
  }
}

async function upsertEditedLine(documentKind: 'order' | 'quote'): Promise<SalesDocumentCalculationResult> {
  const results: SalesDocumentCalculationResult[] = []
  const handler = commandRegistry.get(`sales.${documentKind}s.lines.upsert`)!
  await handler.execute({ body: {
    id: editedLineId,
    [`${documentKind}Id`]: documentId,
    organizationId,
    tenantId,
    currencyCode: 'USD',
    quantity: 1,
    name: 'Renamed line',
  } } as never, makeContext(documentKind, results) as never)
  expect(results).toHaveLength(1)
  return results[0]
}

function lineAmounts(result: SalesDocumentCalculationResult) {
  return result.lines.map((line) => ({
    id: line.line.id,
    netAmount: line.netAmount,
    netAmountExact: line.netAmountExact,
  }))
}

function adjustmentAmounts(result: SalesDocumentCalculationResult) {
  return result.adjustments.map((adjustment) => ({
    id: adjustment.id,
    amountNet: adjustment.amountNet,
    amountNetExact: adjustment.amountNetExact,
  }))
}

beforeAll(async () => {
  commandRegistry.clear?.()
  await import('../documents')
})

describe.each(['order', 'quote'] as const)('%s line upsert pairs hook amounts by id', (documentKind) => {
  let unregister: (() => void) | null = null

  afterEach(() => {
    unregister?.()
    unregister = null
  })

  it('keeps a legacy number a reordering totals hook set on a line', async () => {
    setWorld(false)
    unregister = registerSalesTotalsCalculator(({ current }) => {
      const reversed = [...current.lines].reverse()
      reversed[0] = { ...reversed[0], netAmount: 30 }
      return { ...current, lines: reversed }
    })

    const result = await upsertEditedLine(documentKind)

    expect(lineAmounts(result)).toEqual([
      { id: otherLineId, netAmount: 30, netAmountExact: '30' },
      { id: editedLineId, netAmount: 10, netAmountExact: '10' },
    ])
  })

  it('keeps a legacy number a reordering totals hook set on an adjustment', async () => {
    setWorld(true)
    unregister = registerSalesTotalsCalculator(({ current }) => {
      const reversed = [...current.adjustments].reverse()
      reversed[0] = { ...reversed[0], amountNet: 5 }
      return { ...current, adjustments: reversed }
    })

    const result = await upsertEditedLine(documentKind)

    expect(adjustmentAmounts(result)).toEqual([
      { id: secondAdjustmentId, amountNet: 5, amountNetExact: '5' },
      { id: firstAdjustmentId, amountNet: 1, amountNetExact: '1' },
    ])
  })

  it('keeps an exact amount an in-place totals hook changed on a line', async () => {
    setWorld(false)
    unregister = registerSalesTotalsCalculator(({ current }) => ({
      ...current,
      lines: current.lines.map((line, index) =>
        index === 1 ? { ...line, netAmountExact: '20.000000000000000001' } : line,
      ),
    }))

    const result = await upsertEditedLine(documentKind)

    expect(lineAmounts(result)[1]).toEqual({
      id: otherLineId,
      netAmount: 20,
      netAmountExact: '20.000000000000000001',
    })
  })
})
