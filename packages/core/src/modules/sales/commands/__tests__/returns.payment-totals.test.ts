/** @jest-environment node */

// Regression coverage for #3756: creating a return must NOT reset the order's
// recorded payment totals. The return command only recalculates the line /
// adjustment math; `paidTotalAmount` / `refundedTotalAmount` live on the order
// and must be carried through every `calculateDocumentTotals` call via
// `existingTotals`. Without that, a full return of a fully-paid order zeroed the
// paid amount and the outstanding balance jumped to the residual shipping cost
// (implying the customer still owed money after already paying in full).

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
    auth: { tenantId: TEST_TENANT_ID, orgId: TEST_ORG_ID },
    selectedOrganizationId: TEST_ORG_ID,
    organizationIds: [TEST_ORG_ID],
    request: null,
    organizationScope: null,
  }
}

async function createReturn(lineId: string, quantity: number) {
  const execute = commandRegistry.get('sales.returns.create')?.execute as any
  expect(execute).toBeInstanceOf(Function)
  await execute(
    { tenantId: TEST_TENANT_ID, organizationId: TEST_ORG_ID, orderId: TEST_ORDER_ID, lines: [{ orderLineId: lineId, quantity }] },
    buildCtx(),
  )
}

describe('sales.returns.create — preserves order payment totals (#3756)', () => {
  beforeAll(async () => {
    commandRegistry.clear?.()
    await import('../returns')
  })

  it('keeps paid/refunded totals and a zero outstanding balance after a full return of a fully-paid order', async () => {
    // One product line (248.00 gross) plus a shipping adjustment (9.90 gross),
    // fully paid at the 257.90 grand total. A full return of the product line
    // leaves only the 9.90 shipping residual on the grand total.
    state.order = {
      id: TEST_ORDER_ID,
      tenantId: TEST_TENANT_ID,
      organizationId: TEST_ORG_ID,
      currencyCode: 'USD',
      shippingMethodSnapshot: null,
      paymentMethodSnapshot: null,
      // Customer already paid in full for the original 257.90 total.
      paidTotalAmount: '257.90',
      refundedTotalAmount: '0',
      grandTotalNetAmount: '0',
      grandTotalGrossAmount: '0',
      updatedAt: new Date(),
    }
    state.lines = [
      {
        id: LINE_A_ID,
        lineNumber: 1,
        kind: 'product',
        currencyCode: 'USD',
        discountAmount: '0',
        discountPercent: '0',
        taxRate: '0',
        returnedQuantity: '0',
        quantity: '1',
        unitPriceNet: '248',
        unitPriceGross: '248',
        totalNetAmount: '248',
        totalGrossAmount: '248',
      },
    ]
    state.adjustments = [
      {
        id: 'a0000000-0000-4000-8000-000000000001',
        scope: 'order',
        kind: 'shipping',
        rate: '0',
        amountNet: '9.90',
        amountGross: '9.90',
        currencyCode: 'USD',
        position: 1,
      },
    ]
    state.shipments = [{ id: SHIPMENT_ID }]
    state.shipmentItems = state.lines.map((line) => ({
      shipment: { id: SHIPMENT_ID },
      orderLine: { id: line.id },
      quantity: line.quantity,
    }))

    await createReturn(LINE_A_ID, 1)

    // The payment record was never touched, so paid/refunded must survive.
    expect(num(state.order.paidTotalAmount)).toBeCloseTo(257.9, 4)
    expect(num(state.order.refundedTotalAmount)).toBeCloseTo(0, 4)

    // Grand total dropped to the shipping residual, but the customer already
    // paid in full — outstanding must be 0, NOT the 9.90 shipping residual.
    expect(num(state.order.grandTotalGrossAmount)).toBeCloseTo(9.9, 4)
    expect(num(state.order.outstandingAmount)).toBeCloseTo(0, 4)
  })
})
