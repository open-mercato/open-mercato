/** @jest-environment node */

import { asValue, createContainer, InjectionMode } from 'awilix'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'
import { orderCreateSchema, quoteCreateSchema } from '../../data/validators'
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
  const logger = {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    child: jest.fn(),
  }
  logger.child.mockReturnValue(logger)
  return { createLogger: () => logger }
})

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
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

const { setRecordCustomFields } = jest.requireMock(
  '@open-mercato/core/modules/entities/lib/helpers',
) as { setRecordCustomFields: jest.Mock }

const { emitCrudSideEffects } = jest.requireMock('@open-mercato/shared/lib/commands/helpers') as {
  emitCrudSideEffects: jest.Mock
}

const TEST_TENANT_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
const TEST_ORG_ID = 'bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb'

function buildHarness() {
  let inTransaction = false
  const create = jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ ...data }))
  const generate = jest.fn(async () => ({ number: 'DOC-1' }))
  const userHasAllFeatures = jest.fn(async () => false)
  let em: Record<string, unknown>
  em = {
    fork: () => em,
    create,
    persist: () => undefined,
    find: async () => [],
    findOne: async () => null,
    nativeDelete: async () => 0,
    remove: jest.fn(),
    flush: async () => undefined,
    isInTransaction: () => inTransaction,
    begin: async () => {
      inTransaction = true
    },
    commit: async () => {
      inTransaction = false
    },
    rollback: async () => {
      inTransaction = false
    },
    getReference: (_entity: unknown, id: unknown) => ({ id }),
  }

  const container = createContainer({ injectionMode: InjectionMode.PROXY })
  container.register({
    em: asValue(em),
    dataEngine: asValue({}),
    eventBus: asValue({ emit: async () => undefined, emitEvent: async () => undefined }),
    salesCalculationService: asValue(new DefaultSalesCalculationService(null)),
    salesDocumentNumberGenerator: asValue({ generate }),
    rbacService: asValue({ userHasAllFeatures }),
  })

  const ctx: CommandRuntimeContext = {
    container,
    auth: null,
    organizationScope: null,
    selectedOrganizationId: TEST_ORG_ID,
    organizationIds: [TEST_ORG_ID],
  }

  return { ctx, create, generate, userHasAllFeatures }
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
    lines: [line],
    ...extra,
  }
}

function customFieldWritesFor(entityId: string) {
  return setRecordCustomFields.mock.calls
    .map(([, options]) => options as Record<string, unknown>)
    .filter((options) => options.entityId === entityId)
}

describe('order/quote create schemas — customFields (GSM-296)', () => {
  it('keeps customFields on orderCreateSchema instead of stripping it', () => {
    const parsed = orderCreateSchema.parse(
      buildInput({ customFields: { subiekt_doc_id: '42', customer_name: 'Acme' } }),
    )

    expect(parsed.customFields).toEqual({ subiekt_doc_id: '42', customer_name: 'Acme' })
  })

  it('keeps customFields on quoteCreateSchema instead of stripping it', () => {
    const parsed = quoteCreateSchema.parse(buildInput({ customFields: { source: 'import' } }))

    expect(parsed.customFields).toEqual({ source: 'import' })
  })
})

describe('sales document create commands — customFields (GSM-296)', () => {
  beforeAll(async () => {
    commandRegistry.clear?.()
    await import('../documents')
  })

  beforeEach(() => {
    setRecordCustomFields.mockClear()
    emitCrudSideEffects.mockClear()
  })

  function getHandler(id: string) {
    const handler = commandRegistry.get<unknown, { orderId?: string; quoteId?: string }>(id)
    expect(handler).toBeTruthy()
    return handler!
  }

  it('persists customFields supplied to sales.orders.create', async () => {
    const { ctx } = buildHarness()

    const result = await getHandler('sales.orders.create').execute(
      buildInput({ customFields: { subiekt_doc_id: 'FS-1/2026', payment_status: 'paid' } }) as never,
      ctx,
    )

    const writes = customFieldWritesFor('sales.sales_order')
    expect(writes).toHaveLength(1)
    expect(writes[0]).toEqual({
      entityId: 'sales.sales_order',
      recordId: result.orderId,
      organizationId: TEST_ORG_ID,
      tenantId: TEST_TENANT_ID,
      values: { subiekt_doc_id: 'FS-1/2026', payment_status: 'paid' },
    })
  })

  it('persists customFields supplied to sales.quotes.create', async () => {
    const { ctx } = buildHarness()

    const result = await getHandler('sales.quotes.create').execute(
      buildInput({ customFields: { source: 'import' } }) as never,
      ctx,
    )

    const writes = customFieldWritesFor('sales.sales_quote')
    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({
      recordId: result.quoteId,
      organizationId: TEST_ORG_ID,
      tenantId: TEST_TENANT_ID,
      values: { source: 'import' },
    })
  })

  it('writes custom fields before the create side effects refresh the query index', async () => {
    const { ctx } = buildHarness()
    const order: string[] = []
    setRecordCustomFields.mockImplementationOnce(async () => {
      order.push('custom-fields')
    })
    emitCrudSideEffects.mockImplementationOnce(async () => {
      order.push('side-effects')
    })

    await getHandler('sales.orders.create').execute(
      buildInput({ customFields: { subiekt_doc_id: 'FS-2/2026' } }) as never,
      ctx,
    )

    expect(order).toEqual(['custom-fields', 'side-effects'])
  })

  it('skips the custom field write when the caller supplies none', async () => {
    const { ctx } = buildHarness()

    await getHandler('sales.orders.create').execute(buildInput() as never, ctx)

    expect(customFieldWritesFor('sales.sales_order')).toHaveLength(0)
  })

  it('skips the custom field write for an empty customFields object', async () => {
    const { ctx } = buildHarness()

    await getHandler('sales.orders.create').execute(
      buildInput({ customFields: {} }) as never,
      ctx,
    )

    expect(customFieldWritesFor('sales.sales_order')).toHaveLength(0)
  })
})

describe('sales document create commands — document number permissions', () => {
  const scope = { tenantId: TEST_TENANT_ID, organizationId: TEST_ORG_ID }
  const actor = { sub: 'staff-user', tenantId: TEST_TENANT_ID, orgId: TEST_ORG_ID }

  beforeAll(async () => {
    await import('../documents')
  })

  const documents = [
    ['sales.orders.create', 'orderNumber', 'order'],
    ['sales.quotes.create', 'quoteNumber', 'quote'],
    ['sales.invoices.create', 'invoiceNumber', 'invoice'],
    ['sales.credit_memos.create', 'creditMemoNumber', 'credit_memo'],
  ] as const

  it.each(documents)('%s protects manual numbers and still generates numbers', async (commandId, numberField, kind) => {
    const handler = commandRegistry.get<unknown, unknown>(commandId)!
    const { ctx, create, generate, userHasAllFeatures } = buildHarness()
    ctx.auth = actor
    const input = buildInput()

    await expect(handler.execute({ ...input, [numberField]: 'MANUAL-1' }, ctx)).rejects.toMatchObject({ status: 403 })
    expect(userHasAllFeatures).toHaveBeenCalledWith(actor.sub, ['sales.documents.number.edit'], scope)
    expect(generate).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()

    userHasAllFeatures.mockClear()
    await handler.execute(input, ctx)
    expect(userHasAllFeatures).not.toHaveBeenCalled()
    expect(generate).toHaveBeenCalledWith({ ...scope, kind })
    expect(create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ [numberField]: 'DOC-1' }))

    userHasAllFeatures.mockResolvedValue(true)
    generate.mockClear()
    await handler.execute({ ...input, [numberField]: 'MANUAL-1' }, ctx)
    expect(generate).not.toHaveBeenCalled()
    expect(create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ [numberField]: 'MANUAL-1' }))
  })
})
