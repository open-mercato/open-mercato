/** @jest-environment node */

// Regression coverage for #3036 / #3521: the order net total must keep
// recalculating on every return WITHOUT over-crediting genuinely free lines.
//
// A line persisted with a zeroed stored net total (but a valid gross) used to
// credit only the gross side of a return, freezing the net grand total while
// gross kept decreasing (#3036). `total_net_amount = 0` while `gross > 0` is not
// a representable priced state (gross = net * (1 + taxRate) ⇒ net = 0 ⇒ gross = 0),
// so the return reconstructs the missing net from the line's gross + tax rate via
// `deriveLineNetFromGross` rather than the discount-ignoring unit price. A truly
// free line (gross = 0, e.g. a 100% discount / comp) keeps net 0 and must NOT be
// refunded at the full catalog price (#3521).

import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { DefaultSalesCalculationService } from '../../services/salesCalculationService'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string) => key,
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

const state: { order: any; lines: any[]; adjustments: any[]; shipments: any[]; shipmentItems: any[] } = {
  order: null,
  lines: [],
  adjustments: [],
  shipments: [],
  shipmentItems: [],
}

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(async (_em: any, entity: any) => {
    if (entity?.name === 'SalesOrder') return state.order
    return null
  }),
  findWithDecryption: jest.fn(async (_em: any, entity: any) => {
    // Return copies so command-local mutation/persist never feeds back into the
    // already-resolved query results within the same command call.
    if (entity?.name === 'SalesOrderLine') return [...state.lines]
    if (entity?.name === 'SalesOrderAdjustment') return [...state.adjustments]
    // Returns now require the items to have been shipped first: the command caps
    // the available return quantity at the shipped quantity per line.
    if (entity?.name === 'SalesShipment') return [...state.shipments]
    if (entity?.name === 'SalesShipmentItem') return [...state.shipmentItems]
    return []
  }),
}))

jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({
  emitCrudSideEffects: jest.fn().mockResolvedValue(undefined),
}))

let mockReturnNumberCounter = 0
jest.mock('../../services/salesDocumentNumberGenerator', () => ({
  SalesDocumentNumberGenerator: class {
    async generate() {
      mockReturnNumberCounter += 1
      return { number: `RET-TEST-${mockReturnNumberCounter}` }
    }
  },
}))

const TEST_TENANT_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
const TEST_ORG_ID = 'bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb'
const TEST_ORDER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const LINE_A_ID = 'dddddddd-dddd-4ddd-9ddd-dddddddddddd'
const LINE_B_ID = 'eeeeeeee-eeee-4eee-aeee-eeeeeeeeeeee'

function num(value: any): number {
  return Number(value ?? 0)
}

function buildTx() {
  return {
    create: (_entity: any, data: Record<string, unknown>) => ({ ...data }),
    persist: (entity: any) => {
      // Return credit adjustments must survive into the next command call so a
      // second return sees the first return's adjustment.
      if (entity && entity.kind === 'return' && entity.scope === 'line') {
        state.adjustments.push(entity)
      }
    },
    remove: jest.fn(),
    flush: jest.fn().mockResolvedValue(undefined),
    getReference: (_entity: any, id: unknown) => ({ id }),
  }
}

function buildCtx() {
  const calc = new DefaultSalesCalculationService(null)
  const container = {
    resolve: (name: string) => {
      if (name === 'em') {
        return {
          fork: () => ({
            transactional: async (cb: (tx: any) => Promise<any>) => cb(buildTx()),
          }),
        }
      }
      if (name === 'salesCalculationService') return calc
      if (name === 'dataEngine') return {}
      return {}
    },
  }
  return {
    container,
    auth: { tenantId: TEST_TENANT_ID, orgId: TEST_ORG_ID },
    selectedOrganizationId: TEST_ORG_ID,
    organizationIds: [TEST_ORG_ID],
    request: null,
    organizationScope: null,
  }
}

function buildLine(overrides: Record<string, unknown>) {
  return {
    lineNumber: 1,
    kind: 'product',
    currencyCode: 'USD',
    discountAmount: '0',
    discountPercent: '0',
    taxRate: '10',
    returnedQuantity: '0',
    ...overrides,
  }
}

function seed(lines: any[], adjustments: any[] = []) {
  state.order = {
    id: TEST_ORDER_ID,
    tenantId: TEST_TENANT_ID,
    organizationId: TEST_ORG_ID,
    currencyCode: 'USD',
    shippingMethodSnapshot: null,
    paymentMethodSnapshot: null,
    paidTotalAmount: '0',
    refundedTotalAmount: '0',
    grandTotalNetAmount: '0',
    grandTotalGrossAmount: '0',
    updatedAt: new Date(),
  }
  state.lines = lines
  state.adjustments = adjustments
  // Fully ship every seeded line so the shipped-quantity gate allows the returns
  // under test (the returns flow caps the returnable quantity at shipped).
  state.shipments = [{ id: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }]
  state.shipmentItems = lines.map((line) => ({
    shipment: { id: 'ffffffff-ffff-4fff-8fff-ffffffffffff' },
    orderLine: { id: line.id },
    quantity: line.quantity,
  }))
}

async function createReturn(lineId: string, quantity: number) {
  const execute = commandRegistry.get('sales.returns.create')?.execute as any
  expect(execute).toBeInstanceOf(Function)
  await execute(
    { tenantId: TEST_TENANT_ID, organizationId: TEST_ORG_ID, orderId: TEST_ORDER_ID, lines: [{ orderLineId: lineId, quantity }] },
    buildCtx(),
  )
  return {
    net: num(state.order.grandTotalNetAmount),
    gross: num(state.order.grandTotalGrossAmount),
  }
}

function lastReturnAdjustment() {
  const returns = state.adjustments.filter((adj) => adj.kind === 'return' && adj.scope === 'line')
  return returns[returns.length - 1]
}

describe('sales.returns.create — net total recalculation across returns (#3036 / #3521)', () => {
  beforeAll(async () => {
    commandRegistry.clear?.()
    await import('../returns')
  })

  it('credits the net total on a second return even when the line has a zeroed stored net total', async () => {
    seed([
      buildLine({ id: LINE_A_ID, quantity: '1', unitPriceNet: '100', unitPriceGross: '110', totalNetAmount: '100', totalGrossAmount: '110' }),
      // Line persisted without a computed net total: total_net_amount defaults to
      // '0' while the gross side is populated. Returning it must still credit net,
      // reconstructed from gross (220) and taxRate (10%) → 200.
      buildLine({ id: LINE_B_ID, quantity: '1', unitPriceNet: '200', unitPriceGross: '220', totalNetAmount: '0', totalGrossAmount: '220' }),
    ])

    const afterFirst = await createReturn(LINE_A_ID, 1)
    expect(afterFirst.net).toBeLessThan(num('200') + num('100')) // sanity: net dropped from full
    expect(afterFirst.net).toBeGreaterThan(0)

    const afterSecond = await createReturn(LINE_B_ID, 1)

    // The second return must reduce BOTH net and gross, not freeze the net total.
    expect(afterSecond.gross).toBeLessThan(afterFirst.gross)
    expect(afterSecond.net).toBeLessThan(afterFirst.net)

    // The second return's credit adjustment must carry a non-zero net amount,
    // reconstructed from gross / taxRate (220 / 1.1 = 200), not the raw 0.
    const secondReturn = lastReturnAdjustment()
    expect(num(secondReturn.amountNet)).toBeCloseTo(-200, 4)
    expect(num(secondReturn.amountGross)).toBeCloseTo(-220, 4)
  })

  it('does not over-credit a genuinely free line (gross = 0, 100% discount / comp)', async () => {
    // A fully discounted line is legitimately zero on BOTH sides. The earlier
    // unit-price fallback would have refunded the full catalog price (200 / 220),
    // exceeding what the customer was ever charged. The reconstruction must keep a
    // gross = 0 line at net 0, so the return credits nothing (#3521).
    seed([
      buildLine({
        id: LINE_A_ID,
        quantity: '1',
        unitPriceNet: '200',
        unitPriceGross: '220',
        discountPercent: '100',
        discountAmount: '200',
        totalNetAmount: '0',
        totalGrossAmount: '0',
      }),
    ])

    const afterReturn = await createReturn(LINE_A_ID, 1)

    // No money moves: a free line credits nothing on either side.
    expect(afterReturn.net).toBe(0)
    expect(afterReturn.gross).toBe(0)

    const credit = lastReturnAdjustment()
    expect(num(credit.amountNet)).toBe(0)
    expect(num(credit.amountGross)).toBe(0)
  })

  it('reduces both net and gross totals on each sequential return for normally-priced lines', async () => {
    seed([
      buildLine({ id: LINE_A_ID, lineNumber: 1, quantity: '1', unitPriceNet: '640', unitPriceGross: '704', totalNetAmount: '640', totalGrossAmount: '704' }),
      buildLine({ id: LINE_B_ID, lineNumber: 2, quantity: '3', unitPriceNet: '85', unitPriceGross: '93.5', discountAmount: '4.25', discountPercent: '5', totalNetAmount: '242.25', totalGrossAmount: '266.475' }),
    ])

    const afterFirst = await createReturn(LINE_A_ID, 1)
    const afterSecond = await createReturn(LINE_B_ID, 3)

    expect(afterSecond.net).toBeLessThan(afterFirst.net)
    expect(afterSecond.gross).toBeLessThan(afterFirst.gross)
  })
})
