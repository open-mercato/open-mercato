/** @jest-environment node */

import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string) => key,
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

const isSalesOrderCancelledMock = jest.fn()
const reserveInventoryForConfirmedOrderMock = jest.fn(async () => undefined)

jest.mock('../../lib/salesOrderInventoryAutomation', () => ({
  isSalesOrderCancelled: (...args: unknown[]) => isSalesOrderCancelledMock(...args),
  reserveInventoryForConfirmedOrder: (...args: unknown[]) => reserveInventoryForConfirmedOrderMock(...args),
}))

const input = {
  salesOrderId: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
  tenantId: '33333333-3333-4333-8333-333333333333',
}

const ctx = {
  container: { resolve: jest.fn() },
  auth: { sub: 'user-1', tenantId: input.tenantId, orgId: input.organizationId },
  organizationScope: null,
  selectedOrganizationId: input.organizationId,
  organizationIds: [input.organizationId],
}

describe('wms.sales-order.re-run-reservation (issue #4521)', () => {
  beforeAll(async () => {
    await import('../sales-order-assignment')
  })

  beforeEach(() => {
    isSalesOrderCancelledMock.mockReset()
    reserveInventoryForConfirmedOrderMock.mockClear()
  })

  it('refuses to reserve stock for a cancelled order with a 409', async () => {
    isSalesOrderCancelledMock.mockResolvedValue(true)
    const handler = commandRegistry.get('wms.sales-order.re-run-reservation')
    const run = handler!.execute!(input, ctx as never)
    await expect(run).rejects.toBeInstanceOf(CrudHttpError)
    await expect(run).rejects.toMatchObject({
      status: 409,
      body: { error: 'A cancelled order cannot hold a stock reservation.' },
    })
    expect(reserveInventoryForConfirmedOrderMock).not.toHaveBeenCalled()
  })

  it('re-runs the reservation for an order that is not cancelled', async () => {
    isSalesOrderCancelledMock.mockResolvedValue(false)
    const handler = commandRegistry.get('wms.sales-order.re-run-reservation')
    await expect(handler!.execute!(input, ctx as never)).resolves.toEqual({ ok: true })
    expect(reserveInventoryForConfirmedOrderMock).toHaveBeenCalledWith(
      { orderId: input.salesOrderId, tenantId: input.tenantId, organizationId: input.organizationId },
      expect.objectContaining({ resolve: expect.any(Function) }),
    )
  })
})
