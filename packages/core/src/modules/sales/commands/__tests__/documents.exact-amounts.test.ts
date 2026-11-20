/** @jest-environment node */

import { asValue, createContainer, InjectionMode } from 'awilix'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'
import { creditMemoCreateSchema, invoiceCreateSchema, orderCreateSchema } from '../../data/validators'
import { withExactDocumentInput, withExactInvoiceInput } from '../../lib/exactAmountFields'
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
      sales_invoice: 'sales.sales_invoice',
      sales_credit_memo: 'sales.sales_credit_memo',
    },
  },
}))

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

jest.mock('@open-mercato/shared/lib/crud/cache', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/crud/cache'),
  invalidateCrudCache: jest.fn(async () => undefined),
}))

jest.mock('@open-mercato/core/modules/notifications/lib/notificationService', () => ({
  resolveNotificationService: () => ({ createForFeature: jest.fn(async () => undefined) }),
}))

const TEST_TENANT_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
const TEST_ORG_ID = 'bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb'
const LONG_RATE = '1.234567890123456789012345'
const LONG_AMOUNT = '1234567890.123456789012345'

type PersistedRecord = Record<string, unknown>

function buildHarness() {
  const persisted: PersistedRecord[] = []
  let em: Record<string, unknown>
  em = {
    fork: () => em,
    create: (_entity: unknown, data: PersistedRecord) => ({ ...data }),
    persist: (entity: PersistedRecord) => {
      persisted.push(entity)
    },
    find: async () => [],
    findOne: async () => null,
    nativeDelete: async () => 0,
    remove: jest.fn(),
    flush: async () => undefined,
    begin: async () => undefined,
    commit: async () => undefined,
    rollback: async () => undefined,
    getReference: (_entity: unknown, id: unknown) => ({ id }),
  }

  const container = createContainer({ injectionMode: InjectionMode.PROXY })
  container.register({
    em: asValue(em),
    dataEngine: asValue({}),
    eventBus: asValue({
      emit: async () => undefined,
      emitEvent: async () => undefined,
    }),
    salesCalculationService: asValue(new DefaultSalesCalculationService(null)),
    salesDocumentNumberGenerator: asValue({
      generate: async () => ({ number: `DOC-${persisted.length + 1}` }),
    }),
  })

  const ctx: CommandRuntimeContext = {
    container,
    auth: null,
    organizationScope: null,
    selectedOrganizationId: TEST_ORG_ID,
    organizationIds: [TEST_ORG_ID],
  }

  return { persisted, ctx }
}

function getHandler(commandId: string) {
  const handler = commandRegistry.get<unknown, Record<string, unknown>>(commandId)
  expect(handler).toBeTruthy()
  return handler!
}

describe('sales document commands keep exact amounts from API route input', () => {
  beforeAll(async () => {
    commandRegistry.clear?.()
    await import('../documents')
  })

  it('stores every digit of an order exchange rate the route already parsed into a number', async () => {
    const { persisted, ctx } = buildHarness()
    const body = {
      organizationId: TEST_ORG_ID,
      tenantId: TEST_TENANT_ID,
      currencyCode: 'USD',
      exchangeRate: LONG_RATE,
      lines: [{ name: 'Item', currencyCode: 'USD', quantity: 1, unitPriceNet: 100, unitPriceGross: 100 }],
    }
    const routeInput = withExactDocumentInput(orderCreateSchema.parse(body), body)
    expect(typeof routeInput.exchangeRate).toBe('number')

    await getHandler('sales.orders.create').execute(routeInput, ctx)

    const order = persisted.find((record) => typeof record.orderNumber === 'string')
    expect(order?.exchangeRate).toBe(LONG_RATE)
  })

  it('stores every digit of invoice totals and lines sent through the invoice route', async () => {
    const { persisted, ctx } = buildHarness()
    const body = {
      organizationId: TEST_ORG_ID,
      tenantId: TEST_TENANT_ID,
      currencyCode: 'USD',
      grandTotalGrossAmount: LONG_AMOUNT,
      lines: [
        {
          name: 'Item',
          currencyCode: 'USD',
          quantity: 1,
          unitPriceNet: LONG_AMOUNT,
          unitPriceGross: LONG_AMOUNT,
          totalGrossAmount: LONG_AMOUNT,
        },
      ],
    }
    const routeInput = withExactInvoiceInput(invoiceCreateSchema.parse(body), body)

    await getHandler('sales.invoices.create').execute(routeInput, ctx)

    const invoice = persisted.find((record) => typeof record.invoiceNumber === 'string')
    const line = persisted.find((record) => record.invoice !== undefined)
    expect(invoice?.grandTotalGrossAmount).toBe(LONG_AMOUNT)
    expect(line?.unitPriceNet).toBe(LONG_AMOUNT)
    expect(line?.unitPriceGross).toBe(LONG_AMOUNT)
    expect(line?.totalGrossAmount).toBe(LONG_AMOUNT)
  })

  it('stores every digit of credit memo totals and lines sent through the credit memo route', async () => {
    const { persisted, ctx } = buildHarness()
    const body = {
      organizationId: TEST_ORG_ID,
      tenantId: TEST_TENANT_ID,
      currencyCode: 'USD',
      grandTotalNetAmount: LONG_AMOUNT,
      lines: [{ name: 'Item', currencyCode: 'USD', quantity: 1, unitPriceNet: LONG_AMOUNT }],
    }
    const routeInput = withExactInvoiceInput(creditMemoCreateSchema.parse(body), body)

    await getHandler('sales.credit_memos.create').execute(routeInput, ctx)

    const creditMemo = persisted.find((record) => typeof record.creditMemoNumber === 'string')
    const line = persisted.find((record) => record.creditMemo !== undefined)
    expect(creditMemo?.grandTotalNetAmount).toBe(LONG_AMOUNT)
    expect(line?.unitPriceNet).toBe(LONG_AMOUNT)
  })
})
