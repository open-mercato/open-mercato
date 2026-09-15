/** @jest-environment node */

/**
 * Reordering a document's lines through `sales.<orders|quotes>.lines.upsert`.
 *
 * `lineNumber` is a destination position. Before the fix it was fed into the
 * sort that renumbers the whole set, so a move onto a position another line
 * already held tied with the incumbent, the stable sort kept the incumbent
 * first, and the renumbering undid the move — a caller reordering a document
 * line by line re-issued the same writes forever without the order ever
 * changing.
 */

import { createContainer, asValue, InjectionMode } from 'awilix'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { SalesOrder, SalesQuote } from '../../data/entities'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string, fallback?: string) => fallback ?? key,
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

jest.mock('@open-mercato/shared/lib/crud/cache', () => ({
  invalidateCrudCache: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(async (_em: unknown, entityClass: unknown) => {
    const world = (globalThis as any).__lineReorderWorld
    return entityClass === world.documentClass ? world.document : null
  }),
  findWithDecryption: jest.fn(async () => []),
}))

const ORG_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const TENANT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const DOCUMENT_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

const LINE_IDS: Record<string, string> = {
  A: '11111111-1111-4111-8111-111111111111',
  B: '22222222-2222-4222-8222-222222222222',
  C: '33333333-3333-4333-8333-333333333333',
  D: '44444444-4444-4444-8444-444444444444',
}

const UNIT_PRICE_NET = 100
const UNIT_PRICE_GROSS = 123
const TAX_RATE = 23
const QUANTITY = 1

type DocumentCase = {
  label: string
  commandId: string
  documentIdKey: 'orderId' | 'quoteId'
  documentClass: unknown
  lineEntityName: string
}

const DOCUMENT_CASES: DocumentCase[] = [
  {
    label: 'sales.orders.lines.upsert',
    commandId: 'sales.orders.lines.upsert',
    documentIdKey: 'orderId',
    documentClass: SalesOrder,
    lineEntityName: 'SalesOrderLine',
  },
  {
    label: 'sales.quotes.lines.upsert',
    commandId: 'sales.quotes.lines.upsert',
    documentIdKey: 'quoteId',
    documentClass: SalesQuote,
    lineEntityName: 'SalesQuoteLine',
  },
]

type FakeLine = {
  id: string
  name: string
  lineNumber: number
  [key: string]: unknown
}

function makeLine(name: string, lineNumber: number): FakeLine {
  return {
    id: LINE_IDS[name],
    name,
    lineNumber,
    kind: 'product',
    productId: null,
    productVariantId: null,
    quantity: String(QUANTITY),
    quantityUnit: null,
    normalizedQuantity: String(QUANTITY),
    normalizedUnit: null,
    uomSnapshot: null,
    currencyCode: 'USD',
    unitPriceNet: String(UNIT_PRICE_NET),
    unitPriceGross: String(UNIT_PRICE_GROSS),
    discountAmount: '0',
    discountPercent: '0',
    taxRate: String(TAX_RATE),
    taxAmount: null,
    totalNetAmount: String(UNIT_PRICE_NET),
    totalGrossAmount: String(UNIT_PRICE_GROSS),
    statusEntryId: null,
    catalogSnapshot: null,
    promotionSnapshot: null,
    updatedAt: new Date('2026-07-08T09:21:29.000Z'),
  }
}

/** Storage order mirrors `orderBy: { lineNumber: 'asc' }` on the real query. */
function setWorld(documentCase: DocumentCase, stored: Array<[string, number]>): void {
  const lines = stored
    .map(([name, lineNumber]) => makeLine(name, lineNumber))
    .sort((a, b) => a.lineNumber - b.lineNumber)
  ;(globalThis as any).__lineReorderWorld = {
    documentClass: documentCase.documentClass,
    lineEntityName: documentCase.lineEntityName,
    document: {
      id: DOCUMENT_ID,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      deletedAt: null,
      currencyCode: 'USD',
      status: 'open',
      fulfillmentStatus: 'pending',
      updatedAt: new Date('2026-07-08T09:21:29.000Z'),
    },
    lines,
  }
}

function makeEm() {
  const world = () => (globalThis as any).__lineReorderWorld
  const em: any = {
    fork: function () {
      return this
    },
    transactional: async (cb: (tx: unknown) => Promise<unknown>) => cb(em),
    begin: jest.fn(async () => {}),
    commit: jest.fn(async () => {}),
    rollback: jest.fn(async () => {}),
    find: jest.fn(async (entityClass: unknown) => {
      const entityName = (entityClass as { name?: string })?.name ?? ''
      if (entityName === world().lineEntityName) return world().lines
      return []
    }),
    findOne: jest.fn(async () => null),
    count: jest.fn(async () => 0),
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ ...data })),
    persist: jest.fn((entity: FakeLine) => {
      const lines = world().lines as FakeLine[]
      if (!lines.some((line) => line.id === entity.id)) lines.push(entity)
    }),
    remove: jest.fn((entity: FakeLine) => {
      const current = world()
      current.lines = (current.lines as FakeLine[]).filter((line) => line.id !== entity.id)
    }),
    flush: jest.fn(async () => {}),
    getReference: jest.fn((_entity: unknown, id: string) => ({ id })),
    getConnection: () => ({ execute: jest.fn(async () => [{ value: 1 }]) }),
  }
  return em
}

function makeCtx(em: unknown) {
  const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
  container.register({
    em: asValue(em),
    dataEngine: asValue({ markOrmEntityChange: jest.fn() }),
    salesCalculationService: asValue({
      calculateDocumentTotals: jest.fn(
        async ({ lines }: { lines: Array<Record<string, unknown>> }) => ({
          totals: {},
          lines: lines.map((line) => ({ line })),
        }),
      ),
    }),
  })
  return {
    container,
    auth: { tenantId: TENANT_ID, orgId: ORG_ID, sub: 'user-1' },
    selectedOrganizationId: ORG_ID,
    organizationScope: null,
    organizationIds: null,
    request: new Request('https://example.test/api/sales/document-lines', { method: 'PUT' }),
  }
}

async function upsertLine(
  documentCase: DocumentCase,
  overrides: Record<string, unknown>,
): Promise<void> {
  const handler = commandRegistry.get(documentCase.commandId)!
  const input = {
    body: {
      [documentCase.documentIdKey]: DOCUMENT_ID,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      currencyCode: 'USD',
      kind: 'product',
      quantity: QUANTITY,
      unitPriceNet: UNIT_PRICE_NET,
      unitPriceGross: UNIT_PRICE_GROSS,
      taxRate: TAX_RATE,
      ...overrides,
    },
  }
  await handler.execute(input as never, makeCtx(makeEm()) as never)
}

const storedOrder = (): string =>
  ((globalThis as any).__lineReorderWorld.lines as FakeLine[])
    .slice()
    .sort((a, b) => a.lineNumber - b.lineNumber)
    .map((line) => `${line.name}=${line.lineNumber}`)
    .join(',')

beforeAll(async () => {
  commandRegistry.clear?.()
  await import('../documents')
})

describe.each(DOCUMENT_CASES)('$label line reordering', (documentCase) => {
  afterEach(() => {
    delete (globalThis as any).__lineReorderWorld
  })

  it('reaches the target order in one pass over the lines', async () => {
    setWorld(documentCase, [['A', 1], ['C', 2], ['B', 3], ['D', 4]])
    for (const [name, lineNumber] of [['A', 1], ['B', 2], ['C', 3], ['D', 4]] as const) {
      await upsertLine(documentCase, { id: LINE_IDS[name], name, lineNumber })
    }
    expect(storedOrder()).toBe('A=1,B=2,C=3,D=4')
  })

  it('moves a line later to exactly the requested position', async () => {
    setWorld(documentCase, [['A', 1], ['B', 2], ['C', 3], ['D', 4]])
    await upsertLine(documentCase, { id: LINE_IDS.B, name: 'B', lineNumber: 4 })
    expect(storedOrder()).toBe('A=1,C=2,D=3,B=4')
  })

  it('moves a line earlier to exactly the requested position', async () => {
    setWorld(documentCase, [['A', 1], ['B', 2], ['C', 3], ['D', 4]])
    await upsertLine(documentCase, { id: LINE_IDS.D, name: 'D', lineNumber: 2 })
    expect(storedOrder()).toBe('A=1,D=2,B=3,C=4')
  })

  it('leaves the order alone when the requested position is the one the line holds', async () => {
    setWorld(documentCase, [['A', 1], ['B', 2], ['C', 3], ['D', 4]])
    await upsertLine(documentCase, { id: LINE_IDS.C, name: 'C', lineNumber: 3 })
    expect(storedOrder()).toBe('A=1,B=2,C=3,D=4')
  })

  it('clamps a position below the first line to the first position', async () => {
    setWorld(documentCase, [['A', 1], ['B', 2], ['C', 3]])
    await upsertLine(documentCase, { id: LINE_IDS.C, name: 'C', lineNumber: 0 })
    expect(storedOrder()).toBe('C=1,A=2,B=3')
  })

  it('clamps a position past the last line to the last position', async () => {
    setWorld(documentCase, [['A', 1], ['B', 2], ['C', 3]])
    await upsertLine(documentCase, { id: LINE_IDS.A, name: 'A', lineNumber: 8 })
    expect(storedOrder()).toBe('B=1,C=2,A=3')
  })

  it('inserts a new line at the requested position', async () => {
    setWorld(documentCase, [['A', 1], ['B', 2], ['C', 3]])
    await upsertLine(documentCase, { name: 'D', lineNumber: 2 })
    expect(storedOrder()).toBe('A=1,D=2,B=3,C=4')
  })

  it('appends a new line when no position is requested', async () => {
    setWorld(documentCase, [['A', 1], ['B', 2], ['C', 3]])
    await upsertLine(documentCase, { name: 'D' })
    expect(storedOrder()).toBe('A=1,B=2,C=3,D=4')
  })

  it('leaves the order alone when an edit requests no position', async () => {
    setWorld(documentCase, [['A', 1], ['C', 2], ['B', 3], ['D', 4]])
    await upsertLine(documentCase, { id: LINE_IDS.B, name: 'B', quantity: 5 })
    expect(storedOrder()).toBe('A=1,C=2,B=3,D=4')
  })
})
