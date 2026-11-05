/** @jest-environment node */

// sales.payments.create fans a `sales.payment.received` notification out to every user holding
// `sales.orders.manage`, with inline delivery. Bulk imports opt out of exactly that fan-out via
// `ctx.bulkImport.skipNotifications` — documents.ts honours the flag for its order/quote
// notifications, and this suite pins the same contract on the payment command: a backfill that
// creates a payment per imported record must not write one notification row per record per user,
// while an interactive create keeps notifying.

import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveNotificationService } from '../../../notifications/lib/notificationService'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string) => key,
    translate: (key: string) => key,
  }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn().mockResolvedValue(null),
  findWithDecryption: jest.fn().mockResolvedValue([]),
}))

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  loadCustomFieldValues: jest.fn().mockResolvedValue({}),
}))

jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({
  emitCrudSideEffects: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@open-mercato/shared/lib/crud/cache', () => ({
  invalidateCrudCache: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@open-mercato/core/modules/entities/lib/helpers', () => ({
  setRecordCustomFields: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('../../../notifications/lib/notificationService', () => ({
  resolveNotificationService: jest.fn().mockReturnValue({
    createForFeature: jest.fn().mockResolvedValue(undefined),
  }),
}))

// The real definition list would do, but pinning a minimal def keeps the suite independent of
// notification catalogue changes.
jest.mock('../../notifications', () => ({
  notificationTypes: [
    {
      type: 'sales.payment.received',
      module: 'sales',
      titleKey: 'sales.notifications.payment.received.title',
      bodyKey: 'sales.notifications.payment.received.body',
      severity: 'info',
    },
  ],
}))

jest.mock('../../lib/dictionaries', () => ({
  resolveDictionaryEntryValue: jest.fn().mockResolvedValue(null),
}))

const TEST_TENANT_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
const TEST_ORG_ID = 'bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb'
const TEST_ORDER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const TEST_PAYMENT_ID = 'dddddddd-dddd-4ddd-9ddd-dddddddddddd'

function buildMockEm() {
  const em: Record<string, unknown> = {
    findOne: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockImplementation(
      (_entity: unknown, data: Record<string, unknown>) => ({ ...data, id: data.id ?? TEST_PAYMENT_ID })
    ),
    persist: jest.fn(),
    remove: jest.fn(),
    flush: jest.fn().mockResolvedValue(undefined),
    getReference: jest.fn().mockImplementation((_entity: unknown, id: unknown) => ({ id })),
  }
  em.transactional = jest.fn().mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback(em))
  return em
}

function buildCommandCtx(extra: Record<string, unknown> = {}) {
  const em = buildMockEm()
  const container = {
    resolve: jest.fn().mockImplementation((name: string) => {
      if (name === 'em') return { fork: jest.fn().mockReturnValue(em) }
      if (name === 'dataEngine') return {}
      return {}
    }),
  }
  const ctx = {
    container,
    auth: { tenantId: TEST_TENANT_ID, orgId: TEST_ORG_ID },
    selectedOrganizationId: TEST_ORG_ID,
    organizationIds: [TEST_ORG_ID],
    request: {} as Request,
    organizationScope: null,
    ...extra,
  }
  return { em, container, ctx }
}

function mockOrder() {
  return {
    id: TEST_ORDER_ID,
    tenantId: TEST_TENANT_ID,
    organizationId: TEST_ORG_ID,
    deletedAt: null,
    currencyCode: 'USD',
    paymentMethodId: null,
    paymentMethodCode: null,
    orderNumber: 'ORD-001',
    grandTotalGrossAmount: '100',
  }
}

async function runCreate(ctx: unknown) {
  const execute = commandRegistry.get('sales.payments.create')?.execute
  expect(execute).toBeInstanceOf(Function)
  await execute?.(
    { orderId: TEST_ORDER_ID, tenantId: TEST_TENANT_ID, organizationId: TEST_ORG_ID, amount: 100, currencyCode: 'USD' },
    ctx as any,
  )
}

function createForFeatureMock(): jest.Mock {
  return (resolveNotificationService as jest.Mock)().createForFeature as jest.Mock
}

describe('createPaymentCommand — sales.payment.received under bulk import', () => {
  beforeAll(async () => {
    // Side-effect import: registers the payment commands on the shared registry.
    await import('../payments')
  })

  beforeEach(() => {
    ;(findOneWithDecryption as jest.Mock).mockReset()
    ;(findOneWithDecryption as jest.Mock).mockResolvedValueOnce(mockOrder()).mockResolvedValue(null)
    createForFeatureMock().mockClear()
  })

  it('notifies on an interactive create (no bulkImport on the ctx)', async () => {
    const { ctx } = buildCommandCtx()
    await runCreate(ctx)
    expect(createForFeatureMock()).toHaveBeenCalledTimes(1)
    expect(createForFeatureMock().mock.calls[0][0]).toMatchObject({ type: 'sales.payment.received' })
  })

  it('suppresses the notification when ctx.bulkImport.skipNotifications is set', async () => {
    const { ctx } = buildCommandCtx({ bulkImport: { skipNotifications: true } })
    await runCreate(ctx)
    expect(createForFeatureMock()).not.toHaveBeenCalled()
  })

  it('keeps notifying under a bulkImport ctx that does not skip notifications', async () => {
    const { ctx } = buildCommandCtx({ bulkImport: { skipReindex: true } })
    await runCreate(ctx)
    expect(createForFeatureMock()).toHaveBeenCalledTimes(1)
  })
})
