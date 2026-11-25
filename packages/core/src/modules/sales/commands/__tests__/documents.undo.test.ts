/** @jest-environment node */

import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { asValue, createContainer } from 'awilix'
import { SalesCreditMemoLine, SalesInvoiceLine } from '../../data/entities'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string) => key,
    translate: (key: string) => key,
  }),
}))

function buildOrderSnapshot(overrides?: {
  order?: Record<string, unknown>
  lines?: Array<Record<string, unknown>>
  adjustments?: Array<Record<string, unknown>>
}) {
  const order = {
    id: 'order-1',
    organizationId: 'org-1',
    tenantId: 'tenant-1',
    orderNumber: '1001',
    statusEntryId: null,
    status: null,
    fulfillmentStatusEntryId: null,
    fulfillmentStatus: null,
    paymentStatusEntryId: null,
    paymentStatus: null,
    customerEntityId: null,
    customerContactId: null,
    customerSnapshot: null,
    billingAddressId: null,
    shippingAddressId: null,
    billingAddressSnapshot: null,
    shippingAddressSnapshot: null,
    currencyCode: 'USD',
    exchangeRate: null,
    taxStrategyKey: null,
    discountStrategyKey: null,
    taxInfo: null,
    shippingMethodId: null,
    shippingMethodCode: null,
    deliveryWindowId: null,
    deliveryWindowCode: null,
    paymentMethodId: null,
    paymentMethodCode: null,
    channelId: null,
    placedAt: null,
    expectedDeliveryAt: null,
    dueAt: null,
    comments: null,
    internalNotes: null,
    shippingMethodSnapshot: null,
    deliveryWindowSnapshot: null,
    paymentMethodSnapshot: null,
    metadata: null,
    customFieldSetId: null,
    subtotalNetAmount: '0',
    subtotalGrossAmount: '0',
    discountTotalAmount: '0',
    taxTotalAmount: '0',
    shippingNetAmount: '0',
    shippingGrossAmount: '0',
    surchargeTotalAmount: '0',
    grandTotalNetAmount: '0',
    grandTotalGrossAmount: '0',
    paidTotalAmount: '0',
    refundedTotalAmount: '0',
    outstandingAmount: '0',
    totalsSnapshot: null,
    lineItemCount: 1,
    ...overrides?.order,
  }

  return {
    order,
    lines:
      overrides?.lines ??
      [
        {
          id: 'line-1',
          lineNumber: 1,
          kind: 'product',
          statusEntryId: null,
          status: null,
          productId: null,
          productVariantId: null,
          catalogSnapshot: null,
          name: 'Line 1',
          description: null,
          comment: null,
          quantity: '1',
          quantityUnit: null,
          reservedQuantity: '0',
          fulfilledQuantity: '0',
          invoicedQuantity: '0',
          returnedQuantity: '0',
          currencyCode: 'USD',
          unitPriceNet: '10',
          unitPriceGross: '10',
          discountAmount: '0',
          discountPercent: '0',
          taxRate: '0',
          taxAmount: '0',
          totalNetAmount: '10',
          totalGrossAmount: '10',
          configuration: null,
          promotionCode: null,
          promotionSnapshot: null,
          metadata: null,
          customFieldSetId: null,
        },
      ],
    adjustments: overrides?.adjustments ?? [],
  }
}

describe('sales order line undo payloads', () => {
  beforeAll(async () => {
    commandRegistry.clear?.()
    await import('../documents')
  })

  const orderLineUpsertLog = () =>
    commandRegistry.get('sales.orders.lines.upsert')?.buildLog as NonNullable<
      ReturnType<typeof commandRegistry.get>
    >['buildLog']
  const orderLineDeleteLog = () =>
    commandRegistry.get('sales.orders.lines.delete')?.buildLog as NonNullable<
      ReturnType<typeof commandRegistry.get>
    >['buildLog']

  it('captures before snapshot for order line upsert undo', async () => {
    const buildLog = orderLineUpsertLog()
    expect(buildLog).toBeInstanceOf(Function)

    const before = buildOrderSnapshot()
    const after = buildOrderSnapshot({
      order: { comments: 'after' },
      lines: [{ ...before.lines[0], comment: 'changed' }],
    })

    const log = (await buildLog?.({
      result: { orderId: 'order-1', lineId: 'line-1' },
      snapshots: { before, after },
    } as any)) as any

    expect(log.snapshotBefore).toEqual(before)
    expect(log.snapshotAfter).toEqual(after)
    expect(log.payload?.undo).toMatchObject({ before, after })
  })

  it('captures before snapshot for order line delete undo', async () => {
    const buildLog = orderLineDeleteLog()
    expect(buildLog).toBeInstanceOf(Function)

    const before = buildOrderSnapshot()
    const after = buildOrderSnapshot({ lines: [] })

    const log = (await buildLog?.({
      result: { orderId: 'order-1', lineId: 'line-1' },
      snapshots: { before, after },
    } as any)) as any

    expect(log.snapshotBefore).toEqual(before)
    expect(log.snapshotAfter).toEqual(after)
    expect(log.payload?.undo).toMatchObject({ before, after })
  })
})

describe('sales document create undo', () => {
  beforeAll(async () => {
    await import('../documents')
  })

  it.each([
    ['sales.invoices.create', 'invoice', SalesInvoiceLine],
    ['sales.credit_memos.create', 'creditMemo', SalesCreditMemoLine],
  ] as const)('checks scope before deleting records in %s', async (commandId, relation, lineEntity) => {
    const document = { id: 'document-1', organizationId: 'org-1', tenantId: 'tenant-1' }
    const tx = { findOne: jest.fn(async () => document), nativeDelete: jest.fn(), remove: jest.fn(), flush: jest.fn() }
    const transactional = jest.fn(async (run: (em: typeof tx) => Promise<void>) => run(tx))
    const container = createContainer().register({ em: asValue({ fork: () => ({ transactional }) }) })
    const undoCommand = commandRegistry.get(commandId)?.undo
    if (!undoCommand) throw new Error(`[internal] Missing undo handler for ${commandId}`)
    const undo = async (orgId: string, tenantId: string) => undoCommand({
      input: {},
      logEntry: { commandPayload: { undo: { after: { [relation]: { id: document.id } } } } },
      ctx: {
        container,
        auth: { sub: 'user-1', orgId, tenantId },
        organizationScope: null,
        selectedOrganizationId: orgId,
        organizationIds: [orgId],
      },
    })

    await expect(undo('org-2', document.tenantId)).rejects.toMatchObject({ status: 403 })
    await expect(undo(document.organizationId, 'tenant-2')).rejects.toMatchObject({ status: 403 })
    expect(tx.nativeDelete).not.toHaveBeenCalled()
    expect(tx.remove).not.toHaveBeenCalled()

    await expect(undo(document.organizationId, document.tenantId)).resolves.toBeUndefined()
    expect(tx.nativeDelete).toHaveBeenCalledWith(lineEntity, { [relation]: document.id })
    expect(tx.remove).toHaveBeenCalledWith(document)
    expect(tx.flush).toHaveBeenCalledTimes(1)
  })
})
