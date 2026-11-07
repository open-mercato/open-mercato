import { asValue, createContainer, InjectionMode } from 'awilix'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'
import { DefaultSalesCalculationService } from '../../services/salesCalculationService'

jest.mock('#generated/entities.ids.generated', () => ({
  E: {
    sales: {
      sales_order: 'sales.sales_order',
      sales_order_line: 'sales.sales_order_line',
      sales_order_adjustment: 'sales.sales_order_adjustment',
      sales_quote: 'sales.sales_quote',
      sales_quote_line: 'sales.sales_quote_line',
      sales_quote_adjustment: 'sales.sales_quote_adjustment',
    },
  },
}))

jest.mock('@open-mercato/shared/lib/logger', () => {
  const logger = { debug: jest.fn(), error: jest.fn(), info: jest.fn(), warn: jest.fn(), child: jest.fn() }
  logger.child.mockReturnValue(logger)
  return { createLogger: () => logger }
})

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (key: string, fallback?: string) => fallback ?? key }),
}))

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  loadCustomFieldValues: jest.fn(async () => ({})),
}))

jest.mock('@open-mercato/core/modules/entities/lib/helpers', () => ({
  setRecordCustomFields: jest.fn(async () => undefined),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(async () => []),
  findOneWithDecryption: jest.fn(async () => null),
}))

jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({
  emitCrudSideEffects: jest.fn(async () => undefined),
}))

jest.mock('@open-mercato/core/modules/notifications/lib/notificationService', () => ({
  resolveNotificationService: () => ({ createForFeature: jest.fn(async () => undefined) }),
}))

const TEST_TENANT_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
const TEST_ORG_ID = 'bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb'
const APPROVAL_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const CART_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const COMPANY_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const BUYER_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff'

function buildHarness(options: { trusted: boolean }) {
  const created: Record<string, unknown>[] = []
  let inTransaction = false
  let em: Record<string, unknown>
  em = {
    fork: () => em,
    create: (_entity: unknown, data: Record<string, unknown>) => {
      const row = { ...data }
      created.push(row)
      return row
    },
    persist: () => undefined,
    find: async () => [],
    findOne: async () => null,
    nativeDelete: async () => 0,
    remove: jest.fn(),
    flush: async () => undefined,
    isInTransaction: () => inTransaction,
    begin: async () => { inTransaction = true },
    commit: async () => { inTransaction = false },
    rollback: async () => { inTransaction = false },
    getReference: (_entity: unknown, id: unknown) => ({ id }),
  }

  const container = createContainer({ injectionMode: InjectionMode.PROXY })
  container.register({
    em: asValue(em),
    dataEngine: asValue({}),
    eventBus: asValue({ emit: async () => undefined, emitEvent: async () => undefined }),
    salesCalculationService: asValue(new DefaultSalesCalculationService(null)),
    salesDocumentNumberGenerator: asValue({ generate: async () => ({ number: 'DOC-1' }) }),
    customerPurchaseApprovalService: asValue({
      getApproval: async () => ({
        id: APPROVAL_ID,
        status: 'approved',
        currencyCode: 'USD',
        amountGross: '100',
        subjectType: 'cart',
        subjectId: CART_ID,
        customerId: COMPANY_ID,
      }),
    }),
  })

  const ctx: CommandRuntimeContext = {
    container,
    auth: null,
    organizationScope: null,
    selectedOrganizationId: TEST_ORG_ID,
    organizationIds: [TEST_ORG_ID],
    ...(options.trusted ? { systemActor: true } : {}),
  }

  return { ctx, created }
}

const line = {
  name: 'Item',
  currencyCode: 'USD',
  quantity: 1,
  unitPriceNet: 100,
  unitPriceGross: 100,
  taxRate: 0,
  discountAmount: 0,
  discountPercent: 0,
}

function buildInput(extra: Record<string, unknown> = {}) {
  return {
    organizationId: TEST_ORG_ID,
    tenantId: TEST_TENANT_ID,
    currencyCode: 'USD',
    customerEntityId: BUYER_ID,
    lines: [line],
    metadata: { sourceModule: 'checkout', pendingApproval: { required: true, approvalId: APPROVAL_ID } },
    ...extra,
  }
}

describe('sales.quotes.create — protected approval requirement', () => {
  beforeAll(async () => {
    commandRegistry.clear?.()
    await import('../documents')
  })

  function getHandler(id: string) {
    const handler = commandRegistry.get<unknown, { quoteId?: string }>(id)
    expect(handler).toBeTruthy()
    return handler!
  }

  function findQuoteRow(created: Record<string, unknown>[]) {
    const row = created.find((entry) => 'quoteNumber' in entry)
    expect(row).toBeDefined()
    return row as Record<string, unknown>
  }

  it('records the requirement and provenance server-side for a trusted system caller and strips it from metadata', async () => {
    const { ctx, created } = buildHarness({ trusted: true })

    await getHandler('sales.quotes.create').execute(buildInput() as never, ctx)

    const row = findQuoteRow(created)
    expect(row.approvalRequirement).toMatchObject({
      required: true,
      approvalId: APPROVAL_ID,
      approvalSubjectType: 'cart',
      approvalSubjectId: CART_ID,
      approvalCustomerId: COMPANY_ID,
      buyerCustomerEntityId: BUYER_ID,
    })
    expect(row.metadata).toEqual({ sourceModule: 'checkout' })
  })

  it('never records a requirement from an ordinary (non-system) caller and drops the metadata claim', async () => {
    const { ctx, created } = buildHarness({ trusted: false })

    await getHandler('sales.quotes.create').execute(buildInput() as never, ctx)

    const row = findQuoteRow(created)
    expect(row.approvalRequirement).toBeNull()
    expect(row.metadata).toEqual({ sourceModule: 'checkout' })
  })
})

describe('sales.quotes.update — metadata cannot reintroduce the approval claim', () => {
  beforeAll(async () => {
    commandRegistry.clear?.()
    await import('../documents')
  })

  it('omitPendingApprovalMetadata strips the key the update path forwards', async () => {
    const { omitPendingApprovalMetadata } = await import('../../lib/quoteApprovalRequirement')
    expect(omitPendingApprovalMetadata({ a: 1, pendingApproval: { required: false } })).toEqual({ a: 1 })
    expect(omitPendingApprovalMetadata(null)).toBeNull()
  })
})
