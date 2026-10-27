import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { SalesOrder } from '../../data/entities'
import { createSalesPaymentOrderTotalResolver, resolveOrderAmountDue } from '../paymentOrderTotalResolver'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
}))

const findOneMock = findOneWithDecryption as jest.MockedFunction<typeof findOneWithDecryption>

const ORDER_ID = '11111111-1111-4111-8111-111111111111'
const scope = { organizationId: 'org_1', tenantId: 'tenant_1' }

type OrderRow = {
  currencyCode: string
  outstandingAmount: string
  paidTotalAmount: string
  refundedTotalAmount: string
  grandTotalGrossAmount: string
}

function buildResolver(rows: Array<{ where: Record<string, unknown>; row: OrderRow }>) {
  findOneMock.mockReset()
  findOneMock.mockImplementation(async (_em, entity, where) => {
    if (entity !== SalesOrder) return null
    const criteria = where as Record<string, unknown>
    const match = rows.find((candidate) => (
      Object.entries(candidate.where).every(([key, value]) => criteria[key] === value)
    ))
    return (match ? match.row : null) as never
  })
  const em = {} as never
  const resolver = createSalesPaymentOrderTotalResolver({ em })
  return { resolver, findOne: findOneMock, em }
}

const unpaidOrder: OrderRow = {
  currencyCode: 'EUR',
  outstandingAmount: '150.0000',
  paidTotalAmount: '0.0000',
  refundedTotalAmount: '0.0000',
  grandTotalGrossAmount: '150.0000',
}

describe('sales payment order total resolver (#4488)', () => {
  it('returns the outstanding amount for an in-scope order', async () => {
    const { resolver, findOne, em } = buildResolver([{ where: { id: ORDER_ID, ...scope }, row: unpaidOrder }])

    await expect(resolver.resolveOrderTotal(ORDER_ID, scope)).resolves.toEqual({
      orderId: ORDER_ID,
      currencyCode: 'EUR',
      amountDue: 150,
    })
    expect(findOne).toHaveBeenCalledWith(
      em,
      SalesOrder,
      expect.objectContaining({
        id: ORDER_ID,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
      }),
      expect.anything(),
      scope,
    )
  })

  it('returns null for an order owned by another tenant or organization', async () => {
    const { resolver } = buildResolver([{
      where: { id: ORDER_ID, tenantId: 'tenant_other', organizationId: 'org_other' },
      row: unpaidOrder,
    }])

    await expect(resolver.resolveOrderTotal(ORDER_ID, scope)).resolves.toBeNull()
  })

  it('returns null for an unknown order', async () => {
    const { resolver } = buildResolver([])

    await expect(resolver.resolveOrderTotal(ORDER_ID, scope)).resolves.toBeNull()
  })

  it('never queries with a malformed order id', async () => {
    const { resolver, findOne } = buildResolver([])

    await expect(resolver.resolveOrderTotal('not-a-uuid', scope)).resolves.toBeNull()
    expect(findOne).not.toHaveBeenCalled()
  })

  it('never queries without a complete scope', async () => {
    const { resolver, findOne } = buildResolver([])

    await expect(resolver.resolveOrderTotal(ORDER_ID, { organizationId: '', tenantId: 'tenant_1' }))
      .resolves.toBeNull()
    expect(findOne).not.toHaveBeenCalled()
  })
})

describe('resolveOrderAmountDue', () => {
  it('uses the outstanding amount once a payment exists', () => {
    expect(resolveOrderAmountDue({
      outstandingAmount: '40.0000',
      paidTotalAmount: '60.0000',
      refundedTotalAmount: '0.0000',
      grandTotalGrossAmount: '100.0000',
    } as never)).toBe(40)
  })

  it('leaves nothing due once the order is fully paid', () => {
    expect(resolveOrderAmountDue({
      outstandingAmount: '0.0000',
      paidTotalAmount: '100.0000',
      refundedTotalAmount: '0.0000',
      grandTotalGrossAmount: '100.0000',
    } as never)).toBe(0)
  })

  it('falls back to the grand total when no payment or refund was ever recorded', () => {
    expect(resolveOrderAmountDue({
      outstandingAmount: '0.0000',
      paidTotalAmount: '0.0000',
      refundedTotalAmount: '0.0000',
      grandTotalGrossAmount: '100.0000',
    } as never)).toBe(100)
  })
})
