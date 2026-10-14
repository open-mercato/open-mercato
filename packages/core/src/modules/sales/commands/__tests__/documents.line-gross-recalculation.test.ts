/** @jest-environment node */

import { createContainer, asValue, InjectionMode } from 'awilix'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { DefaultSalesCalculationService } from '../../services/salesCalculationService'
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
const untouchedLineId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

type PersistedLine = Record<string, unknown> & {
  id: string
  quantity: string
  unitPriceNet: string
  unitPriceGross: string
  taxRate: string
  taxAmount: string | null
  totalNetAmount: string
  totalGrossAmount: string
}
type TestWorld = {
  document: Record<string, unknown>
  lines: PersistedLine[]
}
let mockWorld: TestWorld

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(async (_em: unknown, entityClass: unknown) => {
    if (entityClass === SalesOrder || entityClass === SalesQuote) return mockWorld.document
    return null
  }),
  findWithDecryption: jest.fn(async (_em: unknown, entityClass: { name?: string }) => {
    if (entityClass.name === 'SalesOrderLine' || entityClass.name === 'SalesQuoteLine') {
      return [...mockWorld.lines]
    }
    return []
  }),
}))

function buildLine(overrides: Partial<PersistedLine> = {}): PersistedLine {
  return {
    id: editedLineId,
    lineNumber: 1,
    kind: 'product',
    name: 'Line',
    currencyCode: 'USD',
    quantity: '2',
    unitPriceNet: '10',
    unitPriceGross: '12',
    taxRate: '20',
    taxAmount: '4',
    discountAmount: '0',
    discountPercent: '0',
    totalNetAmount: '20',
    totalGrossAmount: '24',
    updatedAt: new Date('2026-09-17T00:00:00Z'),
    ...overrides,
  }
}

function setWorld(lines: PersistedLine[]) {
  mockWorld = {
    document: {
      id: documentId,
      organizationId,
      tenantId,
      deletedAt: null,
      currencyCode: 'USD',
      paidTotalAmount: '0',
      refundedTotalAmount: '0',
      updatedAt: new Date('2026-09-17T00:00:00Z'),
    },
    lines,
  }
}

function makeContext(documentKind: 'order' | 'quote') {
  const em = {
    fork() { return this },
    find: jest.fn(async (entityClass: { name?: string }) =>
      entityClass.name === 'SalesOrderLine' || entityClass.name === 'SalesQuoteLine'
        ? [...mockWorld.lines]
        : [],
    ),
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
  const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
  container.register({
    em: asValue(em),
    dataEngine: asValue({ markOrmEntityChange: jest.fn() }),
    salesCalculationService: asValue(new DefaultSalesCalculationService(null)),
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

async function upsert(documentKind: 'order' | 'quote', changes: Record<string, unknown>) {
  const handler = commandRegistry.get(`sales.${documentKind}s.lines.upsert`)!
  await handler.execute({ body: {
    id: editedLineId,
    [`${documentKind}Id`]: documentId,
    organizationId,
    tenantId,
    currencyCode: 'USD',
    quantity: 2,
    ...changes,
  } } as never, makeContext(documentKind) as never)
}

function expectAmounts(net: number, gross: number, tax: number, extraGross = 0) {
  const edited = mockWorld.lines.find((line) => line.id === editedLineId)!
  expect(Number(edited.totalNetAmount)).toBeCloseTo(net, 4)
  expect(Number(edited.totalGrossAmount)).toBeCloseTo(gross, 4)
  expect(Number(edited.taxAmount)).toBeCloseTo(tax, 4)
  expect(Number(mockWorld.document.grandTotalGrossAmount)).toBeCloseTo(gross + extraGross, 4)
}

beforeAll(async () => {
  commandRegistry.clear?.()
  await import('../documents')
})

describe.each(['order', 'quote'] as const)('%s line derived totals (#6459)', (documentKind) => {

  it('recalculates line and document net/gross for the zero-tax quantity reproduction', async () => {
    setWorld([buildLine({ unitPriceGross: '10', taxRate: '0', taxAmount: '0', totalGrossAmount: '20' })])
    await upsert(documentKind, { quantity: 5, unitPriceNet: 10, unitPriceGross: 10, taxRate: 0 })
    expectAmounts(50, 50, 0)
    expect(Number(mockWorld.document.grandTotalNetAmount)).toBe(50)
  })

  it.each<[Record<string, unknown>, number, number, number]>([
    [{ quantity: 5 }, 50, 60, 10],
    [{ quantity: 1 }, 10, 12, 2],
    [{ quantity: 0 }, 0, 0, 0],
    [{ unitPriceNet: 20, unitPriceGross: 24 }, 40, 48, 8],
    [{ discountPercent: 10 }, 18, 21.6, 3.6],
    [{ discountAmount: 1 }, 18, 21.6, 3.6],
    [{ discountAmount: 1, discountAmountBasis: 'line' }, 19, 22.8, 3.8],
    [{ taxRate: 10 }, 20, 22, 2],
    [{ taxRate: 0 }, 20, 20, 0],
  ])('recalculates omitted tax/gross when pricing changes: %j', async (changes, net, gross, tax) => {
    setWorld([buildLine()])
    await upsert(documentKind, changes)
    expectAmounts(net, gross, tax)
    expect(Number(mockWorld.document.grandTotalNetAmount)).toBeCloseTo(net, 4)
    expect(Number(mockWorld.document.taxTotalAmount)).toBeCloseTo(tax, 4)
  })

  it('preserves explicit gross without net and derives tax when the supplied rate is zero', async () => {
    setWorld([buildLine()])
    await upsert(documentKind, { quantity: 5, taxRate: 0, totalGrossAmount: 61.5 })
    expectAmounts(50, 61.5, 11.5)
  })

  it('uses explicitly supplied tax when gross is omitted', async () => {
    setWorld([buildLine()])
    await upsert(documentKind, { quantity: 5, taxAmount: 7 })
    expectAmounts(50, 57, 7)
  })

  it('preserves explicitly supplied zero tax and gross', async () => {
    setWorld([buildLine()])
    await upsert(documentKind, { quantity: 5, taxAmount: 0, totalGrossAmount: 0 })
    expectAmounts(50, 0, 0)
  })

  it('invalidates stored gross when only the caller tax changes', async () => {
    setWorld([buildLine()])
    await upsert(documentKind, { taxAmount: 7 })
    expectAmounts(20, 27, 7)
  })

  it('invalidates stored tax when only explicit gross changes on a missing-rate row', async () => {
    setWorld([buildLine({ taxRate: '0' })])
    await upsert(documentKind, { totalGrossAmount: 25 })
    expectAmounts(20, 25, 5)
  })

  it('keeps untouched missing-rate gross and tax when another line changes', async () => {
    const untouched = buildLine({
      id: untouchedLineId, lineNumber: 2, quantity: '1',
      unitPriceNet: '100', unitPriceGross: '123',
      taxRate: '0', taxAmount: '23', totalNetAmount: '100', totalGrossAmount: '123',
    })
    setWorld([buildLine(), untouched])
    await upsert(documentKind, { quantity: 5 })
    expectAmounts(50, 60, 10, 123)
    expect(Number(untouched.totalNetAmount)).toBe(100)
    expect(Number(untouched.totalGrossAmount)).toBe(123)
    expect(Number(untouched.taxAmount)).toBe(23)
    expect(Number(mockWorld.document.grandTotalNetAmount)).toBe(150)
    expect(Number(mockWorld.document.taxTotalAmount)).toBe(33)
  })

  it('preserves stored gross/tax for unchanged pricing on missing-rate rows', async () => {
    setWorld([buildLine({ taxRate: '0' })])
    await upsert(documentKind, { description: 'Updated description' })
    expectAmounts(20, 24, 4)
    await upsert(documentKind, { unitPriceNet: 10, unitPriceGross: 12 })
    expectAmounts(20, 24, 4)
  })

  it('keeps repeated recalculations stable after a quantity edit', async () => {
    setWorld([buildLine()])
    await upsert(documentKind, { quantity: 5 })
    await upsert(documentKind, { quantity: 5 })
    expectAmounts(50, 60, 10)
  })

  it('leaves persisted amounts unchanged on a refused update, then accepts a valid retry', async () => {
    setWorld([buildLine()])
    const before = JSON.stringify(mockWorld)
    await expect(upsert(documentKind, { quantity: -1 })).rejects.toThrow()
    expect(JSON.stringify(mockWorld)).toBe(before)
    await upsert(documentKind, { quantity: 5 })
    expectAmounts(50, 60, 10)
  })

  it('recalculates when a carried discount is resubmitted with per-unit meaning', async () => {
    setWorld([buildLine({ discountAmount: '2', totalNetAmount: '18', totalGrossAmount: '21.6', taxAmount: '3.6' })])
    await upsert(documentKind, { discountAmount: 2 })
    expectAmounts(16, 19.2, 3.2)
  })

  it('preserves missing-rate totals when a line-total discount is unchanged', async () => {
    setWorld([buildLine({ taxRate: '0', discountAmount: '2', totalNetAmount: '18', totalGrossAmount: '21.6', taxAmount: '3.6' })])
    await upsert(documentKind, { discountAmount: 2, discountAmountBasis: 'line' })
    expectAmounts(18, 21.6, 3.6)
  })

  it('preserves missing-rate totals when the caller resends the equivalent per-unit discount', async () => {
    setWorld([buildLine({ taxRate: '0', discountAmount: '2', totalNetAmount: '18', totalGrossAmount: '21.6', taxAmount: '3.6' })])
    await upsert(documentKind, { discountAmount: 1 })
    expectAmounts(18, 21.6, 3.6)
  })

  it('preserves missing-rate totals despite floating-point noise in equivalent discounts', async () => {
    setWorld([buildLine({ quantity: '3', taxRate: '0', discountAmount: '0.3', totalNetAmount: '29.7', totalGrossAmount: '35.64', taxAmount: '5.94' })])
    await upsert(documentKind, { quantity: 3, discountAmount: 0.1 })
    expectAmounts(29.7, 35.64, 5.94)
  })

  it('uses calculator rounding for equivalent discounts on fractional quantities', async () => {
    setWorld([buildLine({ quantity: '0.5', taxRate: '0', discountAmount: '1.6667', totalNetAmount: '3.3334', totalGrossAmount: '4.0001', taxAmount: '0.6667' })])
    await upsert(documentKind, { quantity: 0.5, discountAmount: 3.3333 })
    expectAmounts(3.3334, 4.0001, 0.6667)
  })

  it('preserves missing-rate totals when unit/line discount meaning is equivalent at quantity one', async () => {
    setWorld([buildLine({ quantity: '1', taxRate: '0', discountAmount: '1', totalNetAmount: '9', totalGrossAmount: '10.8', taxAmount: '1.8' })])
    await upsert(documentKind, { quantity: 1, discountAmount: 1 })
    expectAmounts(9, 10.8, 1.8)
  })

  it('preserves missing-rate totals when an unchanged percentage outranks the supplied amount', async () => {
    setWorld([buildLine({ taxRate: '0', discountAmount: '2', discountPercent: '10', totalNetAmount: '18', totalGrossAmount: '21.6', taxAmount: '3.6' })])
    await upsert(documentKind, { discountAmount: 3 })
    expectAmounts(18, 21.6, 3.6)
  })
})
