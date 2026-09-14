/** @jest-environment node */

// A return against an order whose amounts came from an external book of record
// records itself — the return document, the line-level `return` adjustments and
// `returned_quantity` — and leaves the header alone. The source system issues its
// own credit document and pushes the corrected totals; core moving a legally
// filed total because it computed a credit would be worse than leaving it.

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

let returnNumberCounter = 0
jest.mock('../../services/salesDocumentNumberGenerator', () => ({
  SalesDocumentNumberGenerator: class {
    async generate() {
      returnNumberCounter += 1
      return { number: `RET-TEST-${returnNumberCounter}` }
    }
  },
}))

const TENANT_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
const ORG_ID = 'bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb'
const ORDER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const LINE_ID = 'dddddddd-dddd-4ddd-9ddd-dddddddddddd'
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
        return { fork: () => ({ transactional: async (cb: (tx: any) => Promise<any>) => cb(buildTx()) }) }
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

function seedOrder(totalsMode: 'computed' | 'external') {
  state.order = {
    id: ORDER_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    currencyCode: 'USD',
    shippingMethodSnapshot: null,
    paymentMethodSnapshot: null,
    totalsMode,
    paidTotalAmount: '0',
    refundedTotalAmount: '0',
    subtotalNetAmount: '25.95',
    subtotalGrossAmount: '31.92',
    discountTotalAmount: '0.03',
    taxTotalAmount: '5.97',
    shippingNetAmount: '0',
    shippingGrossAmount: '0',
    surchargeTotalAmount: '0',
    grandTotalNetAmount: '25.95',
    grandTotalGrossAmount: '31.92',
    outstandingAmount: '31.92',
    lineItemCount: 1,
    updatedAt: new Date(),
  }
  state.lines = [
    {
      id: LINE_ID,
      lineNumber: 1,
      kind: 'product',
      currencyCode: 'USD',
      discountAmount: '0.01',
      discountPercent: '0',
      taxRate: '23',
      taxAmount: '2.99',
      returnedQuantity: '0',
      quantity: '3',
      unitPriceNet: '4.33',
      unitPriceGross: '5.33',
      totalNetAmount: '12.98',
      totalGrossAmount: '15.97',
      amountsMode: totalsMode,
    },
  ]
  state.adjustments = []
  state.shipments = [{ id: SHIPMENT_ID }]
  state.shipmentItems = [{ shipment: { id: SHIPMENT_ID }, orderLine: { id: LINE_ID }, quantity: '3' }]
}

async function createReturn(quantity: number) {
  const execute = commandRegistry.get('sales.returns.create')?.execute as any
  expect(execute).toBeInstanceOf(Function)
  await execute(
    {
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      orderId: ORDER_ID,
      lines: [{ orderLineId: LINE_ID, quantity }],
    },
    buildCtx(),
  )
}

describe('sales.returns.create — external orders', () => {
  beforeAll(async () => {
    commandRegistry.clear?.()
    await import('../returns')
  })

  it('records the return and leaves the source-owned header byte-identical', async () => {
    seedOrder('external')
    const headerBefore = {
      subtotalNetAmount: state.order.subtotalNetAmount,
      grandTotalNetAmount: state.order.grandTotalNetAmount,
      grandTotalGrossAmount: state.order.grandTotalGrossAmount,
      taxTotalAmount: state.order.taxTotalAmount,
      discountTotalAmount: state.order.discountTotalAmount,
      totalsSnapshot: state.order.totalsSnapshot,
    }

    await createReturn(3)

    expect(state.order.subtotalNetAmount).toBe(headerBefore.subtotalNetAmount)
    expect(state.order.grandTotalNetAmount).toBe(headerBefore.grandTotalNetAmount)
    expect(state.order.grandTotalGrossAmount).toBe(headerBefore.grandTotalGrossAmount)
    expect(state.order.taxTotalAmount).toBe(headerBefore.taxTotalAmount)
    expect(state.order.discountTotalAmount).toBe(headerBefore.discountTotalAmount)
    expect(state.order.totalsSnapshot).toBe(headerBefore.totalsSnapshot)

    // The non-monetary effects still happen.
    expect(num(state.lines[0].returnedQuantity)).toBeCloseTo(3, 4)
    expect(state.adjustments.some((adj) => adj.kind === 'return')).toBe(true)
  })

  it('still rewrites the header of a computed order', async () => {
    seedOrder('computed')

    await createReturn(3)

    // A full return of the only line takes the computed grand total to zero.
    expect(num(state.order.grandTotalGrossAmount)).toBeCloseTo(0, 4)
  })
})
