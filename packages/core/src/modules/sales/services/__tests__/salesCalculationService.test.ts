import type { SalesLineSnapshot } from '../../lib/types'
import {
  registerSalesLineCalculator,
  registerSalesTotalsCalculator,
  salesCalculations,
} from '../../lib/calculations'
import { DefaultSalesCalculationService } from '../salesCalculationService'

describe('DefaultSalesCalculationService', () => {
  const context = { tenantId: 'tenant-1', organizationId: 'org-1', currencyCode: 'USD' }
  const baseLine: SalesLineSnapshot = {
    kind: 'product',
    quantity: 1,
    currencyCode: 'USD',
    unitPriceNet: 10,
  }

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('delegates line calculations to the registry and forwards the event bus', async () => {
    const calculateLineMock = jest
      .spyOn(salesCalculations, 'calculateLine')
      .mockResolvedValue({
        line: baseLine,
        netAmount: 10,
        grossAmount: 12,
        taxAmount: 2,
        discountAmount: 0,
        adjustments: [],
      })

    const eventBus = { emitEvent: jest.fn() }
    const service = new DefaultSalesCalculationService(eventBus as any)

    const result = await service.calculateLine({
      documentKind: 'order',
      line: baseLine,
      context,
    })

    expect(calculateLineMock).toHaveBeenCalledWith({
      documentKind: 'order',
      line: baseLine,
      context,
      eventBus,
    })
    expect(result.grossAmount).toBe(12)
  })

  it('delegates document totals calculation with adjustments and existing totals', async () => {
    const calculateDocumentMock = jest.spyOn(salesCalculations, 'calculateDocument').mockResolvedValue({
      kind: 'invoice',
      currencyCode: 'USD',
      lines: [],
      adjustments: [],
      metadata: {},
      totals: {
        subtotalNetAmount: 0,
        subtotalGrossAmount: 0,
        discountTotalAmount: 0,
        taxTotalAmount: 0,
        shippingNetAmount: 0,
        shippingGrossAmount: 0,
        surchargeTotalAmount: 0,
        grandTotalNetAmount: 0,
        grandTotalGrossAmount: 0,
        paidTotalAmount: 5,
        refundedTotalAmount: 0,
        outstandingAmount: 0,
      },
    })

    const eventBus = { emitEvent: jest.fn() }
    const service = new DefaultSalesCalculationService(eventBus as any)

    await service.calculateDocumentTotals({
      documentKind: 'invoice',
      lines: [],
      adjustments: [],
      existingTotals: { paidTotalAmount: 5, refundedTotalAmount: 1 },
      context,
    })

    expect(calculateDocumentMock).toHaveBeenCalledWith({
      documentKind: 'invoice',
      lines: [],
      adjustments: [],
      existingTotals: { paidTotalAmount: 5, refundedTotalAmount: 1 },
      context,
      eventBus,
    })
  })

  it('runs registered calculators and event bus hooks when calculating totals', async () => {
    const events: string[] = []
    const eventBus = {
      emitEvent: jest.fn(async (event: string, payload: any) => {
        events.push(event)
        if (event === 'sales.document.calculate.after') {
          payload.setResult({
            ...payload.result,
            totals: {
              ...payload.result.totals,
              grandTotalGrossAmount: payload.result.totals.grandTotalGrossAmount + 3,
              outstandingAmount: payload.result.totals.outstandingAmount + 3,
            },
          })
        }
      }),
    }
    const service = new DefaultSalesCalculationService(eventBus as any)

    const line: SalesLineSnapshot = {
      kind: 'product',
      quantity: 2,
      currencyCode: 'USD',
      unitPriceNet: 50,
      taxRate: 20,
    }
    const adjustments = [
      {
        scope: 'order' as const,
        kind: 'shipping' as const,
        amountNet: 10,
        amountGross: 12,
        currencyCode: 'USD',
        metadata: { taxRate: 20 },
      },
    ]

    const lineHook = jest.fn(({ current }) => ({
      ...current,
      netAmount: current.netAmount + 5,
      grossAmount: current.grossAmount + 6,
      taxAmount: current.taxAmount + 1,
    }))
    const totalsHook = jest.fn(({ current }) => ({
      ...current,
      totals: {
        ...current.totals,
        surchargeTotalAmount: current.totals.surchargeTotalAmount + 4,
        grandTotalNetAmount: current.totals.grandTotalNetAmount + 4,
        grandTotalGrossAmount: current.totals.grandTotalGrossAmount + 4,
        outstandingAmount: current.totals.outstandingAmount + 4,
      },
    }))

    const unregisterLine = registerSalesLineCalculator(lineHook, { prepend: true })
    const unregisterTotals = registerSalesTotalsCalculator(totalsHook, { prepend: true })

    const result = await service.calculateDocumentTotals({
      documentKind: 'order',
      lines: [line],
      adjustments,
      context,
    })

    unregisterLine()
    unregisterTotals()

    expect(lineHook).toHaveBeenCalled()
    expect(totalsHook).toHaveBeenCalled()
    expect(events).toEqual([
      'sales.line.calculate.before',
      'sales.line.calculate.after',
      'sales.document.calculate.before',
      'sales.document.calculate.after',
    ])
    expect(result.lines[0].netAmount).toBeCloseTo(105, 5)
    expect(result.lines[0].grossAmount).toBeCloseTo(126, 5)
    expect(result.lines[0].taxAmount).toBeCloseTo(21, 5)
    expect(result.totals.shippingGrossAmount).toBeCloseTo(12, 5)
    expect(result.totals.surchargeTotalAmount).toBeCloseTo(4, 5)
    expect(result.totals.taxTotalAmount).toBeCloseTo(23, 5)
    expect(result.totals.grandTotalNetAmount).toBeCloseTo(119, 5)
    expect(result.totals.grandTotalGrossAmount).toBeCloseTo(145, 5)
    expect(result.totals.outstandingAmount).toBeCloseTo(145, 5)
  })
})
