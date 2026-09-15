/** @jest-environment node */

/**
 * The return flows and the line `discount_amount` contract — spec
 * `.ai/specs/2026-08-07-sales-line-discount-amount-contract.md`, issue #3757.
 *
 * `commands/returns.ts` used to carry its own byte-for-byte copy of
 * `mapOrderLineEntityToSnapshot`. Three of that copy's consumers — return
 * create (twice, plain and transactional) and return delete — call
 * `applyOrderTotals` and then persist the order, so **creating or deleting a
 * return on an order with any percentage-discounted line wrote inflated header
 * totals**, no matter how those lines were originally created. That path needs
 * no unusual integration shape to hit, which is what made it the more dangerous
 * of the two.
 *
 * The duplicate is gone and both command files now import one shared mapper.
 * These tests pin the behaviour that made the duplicate matter.
 *
 * Scope note, deliberately stated rather than implied: this file drives
 * `sales.returns.create`, the flow the existing harness in
 * `returns.net-total.test.ts` already covers reliably. The full create → delete
 * round trip of acceptance criterion 6 is covered by the integration spec
 * `__integration__/TC-SALES-5019-line-discount-idempotency.spec.ts` against a
 * real database, because faking the delete path's return-snapshot loading here
 * would assert the shape of the mock rather than the behaviour of the code.
 */

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

const state: {
  order: any
  lines: any[]
  adjustments: any[]
  shipments: any[]
  shipmentItems: any[]
} = { order: null, lines: [], adjustments: [], shipments: [], shipmentItems: [] }

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(async (_em: any, entity: any) => {
    if (entity?.name === 'SalesOrder') return state.order
    return null
  }),
  findWithDecryption: jest.fn(async (_em: any, entity: any) => {
    if (entity?.name === 'SalesOrderLine') return [...state.lines]
    if (entity?.name === 'SalesOrderAdjustment') return [...state.adjustments]
    if (entity?.name === 'SalesShipment') return [...state.shipments]
    if (entity?.name === 'SalesShipmentItem') return [...state.shipmentItems]
    return []
  }),
}))

jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({
  emitCrudSideEffects: jest.fn().mockResolvedValue(undefined),
}))

let returnNumberCounter = 0
jest.mock('../../services/salesDocumentNumberGenerator', () => ({
  SalesDocumentNumberGenerator: class {
    async generate() {
      returnNumberCounter += 1
      return { number: `RET-DISCOUNT-${returnNumberCounter}` }
    }
  },
}))

const TENANT_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
const ORG_ID = 'bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb'
const ORDER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const DISCOUNTED_LINE_ID = 'dddddddd-dddd-4ddd-9ddd-dddddddddddd'
const PLAIN_LINE_ID = 'eeeeeeee-eeee-4eee-aeee-eeeeeeeeeeee'
const SHIPMENT_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff'

function num(value: any): number {
  return Number(value ?? 0)
}

function buildTx() {
  return {
    create: (_entity: any, data: Record<string, unknown>) => ({ ...data }),
    persist: (entity: any) => {
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
    auth: { tenantId: TENANT_ID, orgId: ORG_ID },
    selectedOrganizationId: ORG_ID,
    organizationIds: [ORG_ID],
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
    taxRate: '0',
    returnedQuantity: '0',
    ...overrides,
  }
}

function seed(lines: any[]) {
  state.order = {
    id: ORDER_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    currencyCode: 'USD',
    shippingMethodSnapshot: null,
    paymentMethodSnapshot: null,
    paidTotalAmount: '0',
    refundedTotalAmount: '0',
    grandTotalNetAmount: '0',
    grandTotalGrossAmount: '0',
    discountTotalAmount: '0',
    updatedAt: new Date(),
  }
  state.lines = lines
  state.adjustments = []
  state.shipments = [{ id: SHIPMENT_ID }]
  state.shipmentItems = lines.map((line) => ({
    shipment: { id: SHIPMENT_ID },
    orderLine: { id: line.id },
    quantity: line.quantity,
  }))
}

async function createReturn(lineId: string, quantity: number) {
  const execute = commandRegistry.get('sales.returns.create')?.execute as any
  expect(execute).toBeInstanceOf(Function)
  await execute(
    {
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      orderId: ORDER_ID,
      lines: [{ orderLineId: lineId, quantity }],
    },
    buildCtx(),
  )
  return {
    net: num(state.order.grandTotalNetAmount),
    gross: num(state.order.grandTotalGrossAmount),
    discountTotal: num(state.order.discountTotalAmount),
  }
}

// 3 x 85.00 at 5% — the reproduction shape from #3757. The line-total discount
// is 12.75 and the line net is 242.25.
function discountedLine(overrides: Record<string, unknown> = {}) {
  return buildLine({
    id: DISCOUNTED_LINE_ID,
    lineNumber: 1,
    quantity: '3',
    unitPriceNet: '85',
    unitPriceGross: '85',
    discountAmount: '12.75',
    discountPercent: '5',
    totalNetAmount: '242.25',
    totalGrossAmount: '242.25',
    ...overrides,
  })
}

// The same line without a percentage. This is the shape that actually exercises
// the stored-row origin: with a percentage present, percentage-first precedence
// re-derives the discount and masks a mis-tagged amount entirely, so a test
// built only on percentage lines passes against the un-deduplicated mapper.
function amountOnlyDiscountedLine(overrides: Record<string, unknown> = {}) {
  return discountedLine({ discountPercent: '0', ...overrides })
}

describe('sales.returns.create — order header totals with a discounted line (#3757)', () => {
  beforeAll(async () => {
    commandRegistry.clear?.()
    await import('../returns')
  })

  it('recomputes the order discount total as a line total, not once per unit', async () => {
    // Before the fix, the returns-local mapper handed the stored 12.75 back as
    // a per-unit rate, so the recomputed discount became 38.25 — three times
    // over — and the order's net collapsed accordingly.
    seed([
      amountOnlyDiscountedLine(),
      buildLine({
        id: PLAIN_LINE_ID,
        lineNumber: 2,
        quantity: '1',
        unitPriceNet: '100',
        unitPriceGross: '100',
        totalNetAmount: '100',
        totalGrossAmount: '100',
      }),
    ])

    const afterReturn = await createReturn(PLAIN_LINE_ID, 1)

    // The discounted line was not returned, so its discount must still be its
    // line total. Anything above 12.75 is the re-inflation this fixes — the
    // un-deduplicated mapper produced 38.25 here.
    expect(afterReturn.discountTotal).toBeCloseTo(12.75, 4)
  })

  it('leaves the discounted line net intact when an unrelated line is returned', async () => {
    seed([
      amountOnlyDiscountedLine(),
      buildLine({
        id: PLAIN_LINE_ID,
        lineNumber: 2,
        quantity: '1',
        unitPriceNet: '100',
        unitPriceGross: '100',
        totalNetAmount: '100',
        totalGrossAmount: '100',
      }),
    ])

    const afterReturn = await createReturn(PLAIN_LINE_ID, 1)

    // 242.25 (the discounted line, untouched) + 100 - 100 (the returned line).
    expect(afterReturn.net).toBeCloseTo(242.25, 4)
  })

  it('does not drift the discount total across repeated returns on the same order', async () => {
    // Stability across successive returns, not the compounding runaway itself:
    // this harness does not write the recomputed discount back onto the line
    // between passes, so it cannot observe compounding. The multi-pass runaway
    // is covered by the engine test in `lib/__tests__/calculations.test.ts` and
    // end to end by the integration spec.
    seed([
      amountOnlyDiscountedLine({ quantity: '4', discountAmount: '17', totalNetAmount: '323' }),
      buildLine({
        id: PLAIN_LINE_ID,
        lineNumber: 2,
        quantity: '2',
        unitPriceNet: '100',
        unitPriceGross: '100',
        totalNetAmount: '200',
        totalGrossAmount: '200',
      }),
    ])

    const first = await createReturn(PLAIN_LINE_ID, 1)
    const second = await createReturn(PLAIN_LINE_ID, 1)

    // The discounted line is never returned, so its contribution to the order
    // discount total must be identical on both passes.
    expect(second.discountTotal).toBeCloseTo(first.discountTotal, 4)
  })

  it('heals an order whose stored line discount the old engine had re-inflated', async () => {
    // The row as #3757 reports it: discount_amount = 255 on a 3 x 85 line,
    // which equals the whole line subtotal, so the line's net had gone to 0.
    // The percentage is still in the row, so the next recalculation restores it.
    seed([discountedLine({ discountAmount: '255', totalNetAmount: '0' })])

    const afterReturn = await createReturn(DISCOUNTED_LINE_ID, 1)

    expect(afterReturn.discountTotal).toBeCloseTo(12.75, 4)
    expect(afterReturn.net).toBeGreaterThan(0)
  })
})
