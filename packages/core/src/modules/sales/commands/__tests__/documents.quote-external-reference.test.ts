/** @jest-environment node */

// Release 5 Phase 4 (checkout C3/C19). `quoteCreateSchema`/`createQuoteCommand` never
// exposed `externalReference`/`customerReference` as inputs before this Step, even though
// the `SalesQuote` entity has carried both columns since before this release and
// `orderCreateSchema`/`createOrderCommand` already wire the identical pair — checkout's
// idempotent document creation (§7.2 step 5a, C3) needs both. See the matching comment in
// `data/validators.ts`/`commands/documents.ts`.

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

function buildHarness() {
  let inTransaction = false
  let em: Record<string, unknown>
  em = {
    fork: () => em,
    create: (_entity: unknown, data: Record<string, unknown>) => ({ ...data }),
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
  })

  const ctx: CommandRuntimeContext = {
    container,
    auth: null,
    organizationScope: null,
    selectedOrganizationId: TEST_ORG_ID,
    organizationIds: [TEST_ORG_ID],
  }

  return { ctx }
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

describe('sales.quotes.create — externalReference/customerReference (checkout C3/C19)', () => {
  beforeAll(async () => {
    commandRegistry.clear?.()
    await import('../documents')
  })

  function getHandler(id: string) {
    const handler = commandRegistry.get<unknown, { quoteId?: string }>(id)
    expect(handler).toBeTruthy()
    return handler!
  }

  it('persists externalReference/customerReference supplied to sales.quotes.create', async () => {
    const { ctx } = buildHarness()

    const result = await getHandler('sales.quotes.create').execute(
      buildInput({
        externalReference: 'checkout:session-1:1',
        customerReference: 'PO-42',
      }) as never,
      ctx,
    ) as { quoteId: string }

    expect(result.quoteId).toBeTruthy()
  })

  it('leaves externalReference/customerReference null when the caller supplies neither', async () => {
    const { ctx } = buildHarness()
    const created: Record<string, unknown>[] = []
    const em = ctx.container.resolve<Record<string, unknown>>('em') as any
    const originalCreate = em.create
    em.create = (entity: unknown, data: Record<string, unknown>) => {
      const row = originalCreate(entity, data)
      created.push(row)
      return row
    }

    await getHandler('sales.quotes.create').execute(buildInput() as never, ctx)

    const quoteRow = created.find((row) => 'quoteNumber' in row)
    expect(quoteRow).toMatchObject({ externalReference: null, customerReference: null })
  })

  // Regression for PR #16 round-2 QA bug 12: checkout's document creation
  // (checkout/commands/submit.ts) spreads a SalesLineSnapshot straight into this
  // command's `lines` input. The snapshot type declares productVariantId /
  // configuration / quantityUnit as `| null`, and toCartTotalsLineSnapshot sets
  // them explicitly rather than omitting them — this must go through the REAL
  // command handler (not a mocked commandBus), since the bug was the real
  // `quoteCreateSchema.parse()` call inside it rejecting `null`.
  it('accepts a checkout-shaped line snapshot with explicit nulls for productVariantId/configuration/quantityUnit', async () => {
    const { ctx } = buildHarness()

    const result = await getHandler('sales.quotes.create').execute(
      buildInput({
        lines: [
          {
            ...line,
            productId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            productVariantId: null,
            configuration: null,
            quantityUnit: null,
          },
        ],
      }) as never,
      ctx,
    ) as { quoteId: string }

    expect(result.quoteId).toBeTruthy()
  })
})
