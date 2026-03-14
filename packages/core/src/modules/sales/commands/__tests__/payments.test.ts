/** @jest-environment node */

import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string) => key,
    translate: (key: string) => key,
  }),
}))

function buildPaymentSnapshot(overrides?: Record<string, unknown>) {
  return {
    id: 'payment-1',
    orderId: 'order-1',
    organizationId: 'org-1',
    tenantId: 'tenant-1',
    paymentMethodId: 'method-1',
    paymentReference: null,
    statusEntryId: null,
    status: null,
    amount: 100,
    currencyCode: 'USD',
    capturedAmount: 0,
    refundedAmount: 0,
    receivedAt: null,
    capturedAt: null,
    metadata: null,
    allocations: [],
    ...overrides,
  }
}

describe('createPaymentCommand buildLog — orderPaymentMethodIdBefore in undo payload', () => {
  beforeAll(async () => {
    commandRegistry.clear?.()
    await import('../payments')
  })

  const getCreateBuildLog = () =>
    commandRegistry.get('sales.payments.create')?.buildLog as NonNullable<
      ReturnType<typeof commandRegistry.get>
    >['buildLog']

  it('stores orderPaymentMethodIdBefore=null in undo payload when order had no method before', async () => {
    const buildLog = getCreateBuildLog()
    expect(buildLog).toBeInstanceOf(Function)

    const after = buildPaymentSnapshot()
    const log = (await buildLog?.({
      result: { paymentId: 'payment-1', orderPaymentMethodIdBefore: null, orderPaymentMethodCodeBefore: null },
      snapshots: { after },
    } as any)) as any

    expect(log.payload?.undo?.orderPaymentMethodIdBefore).toBeNull()
    expect(log.payload?.undo?.orderPaymentMethodCodeBefore).toBeNull()
  })

  it('stores orderPaymentMethodIdBefore in undo payload when order already had a method', async () => {
    const buildLog = getCreateBuildLog()
    expect(buildLog).toBeInstanceOf(Function)

    const after = buildPaymentSnapshot()
    const log = (await buildLog?.({
      result: {
        paymentId: 'payment-1',
        orderPaymentMethodIdBefore: 'existing-method-id',
        orderPaymentMethodCodeBefore: 'existing-code',
      },
      snapshots: { after },
    } as any)) as any

    expect(log.payload?.undo?.orderPaymentMethodIdBefore).toBe('existing-method-id')
    expect(log.payload?.undo?.orderPaymentMethodCodeBefore).toBe('existing-code')
  })

  it('returns null log when no after snapshot is available', async () => {
    const buildLog = getCreateBuildLog()
    expect(buildLog).toBeInstanceOf(Function)

    const log = await buildLog?.({
      result: { paymentId: 'payment-1', orderPaymentMethodIdBefore: null, orderPaymentMethodCodeBefore: null },
      snapshots: {},
    } as any)

    expect(log).toBeNull()
  })
})
