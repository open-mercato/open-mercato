/** @jest-environment node */

import { asValue, createContainer, InjectionMode } from 'awilix'
import { parseScopedCommandInput } from '@open-mercato/shared/lib/api/scoped'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'
import { orderCreateSchema, orderLineBulkUpsertSchema } from '../../data/validators'
import { withExactDocumentInput, withExactOrderTotalsInput } from '../../lib/exactAmountFields'
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
  ...jest.requireActual('@open-mercato/shared/lib/crud/custom-fields'),
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
const LONG_TOTAL = '1234567890123456.1234'

type PersistedRecord = Record<string, unknown>

function buildHarness() {
  const persisted: PersistedRecord[] = []
  const flush = jest.fn(async () => undefined)
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
    flush,
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
    auth: { tenantId: TEST_TENANT_ID, orgId: TEST_ORG_ID, sub: 'alias-test' },
    organizationScope: null,
    selectedOrganizationId: TEST_ORG_ID,
    organizationIds: [TEST_ORG_ID],
  }

  return { persisted, ctx, flush }
}

function getHandler(commandId: string) {
  const handler = commandRegistry.get<unknown, Record<string, unknown>>(commandId)
  expect(handler).toBeTruthy()
  return handler!
}

const translate = (key: string, fallback?: string) => fallback ?? key
const line = { name: 'Item', currencyCode: 'USD', quantity: 1, unitPriceNet: 100, unitPriceGross: 100 }

describe('document write payload aliases retain exact money', () => {
  beforeAll(async () => {
    await import('../documents')
  })

  it.each(['exchangeRate', 'exchange_rate'])('stores the exact %s through the real order command', async (field) => {
    const { persisted, ctx, flush } = buildHarness()
    const raw = { currencyCode: 'USD', [field]: LONG_RATE, lines: [line] }
    const mapped = withExactDocumentInput(parseScopedCommandInput(orderCreateSchema, raw, ctx, translate), raw)
    expect(typeof mapped.exchangeRate).toBe('number')
    expect(mapped).toHaveProperty('exchangeRateExact', LONG_RATE)
    await getHandler('sales.orders.create').execute(mapped, ctx)
    expect(persisted.find((record) => typeof record.orderNumber === 'string')?.exchangeRate).toBe(LONG_RATE)
    expect(flush).toHaveBeenCalled()
  })

  it('rejects a null exchange_rate before the command can persist or flush', async () => {
    const { persisted, ctx, flush } = buildHarness()
    const raw = { currencyCode: 'USD', exchange_rate: null, lines: [line] }
    const execute = async () => {
      const mapped = withExactDocumentInput(parseScopedCommandInput(orderCreateSchema, raw, ctx, translate), raw)
      await getHandler('sales.orders.create').execute(mapped, ctx)
    }
    await expect(execute()).rejects.toMatchObject({ status: 400, body: { fields: ['exchange_rate'] } })
    expect(persisted).toEqual([])
    expect(flush).not.toHaveBeenCalled()
  })

  it.each(['grandTotalGrossAmount', 'grand_total_gross_amount'])(
    'stores the exact external %s through the real order command', async (field) => {
      const { persisted, ctx, flush } = buildHarness()
      const raw = {
        currencyCode: 'USD',
        totalsMode: 'external',
        lines: [{ ...line, unitPriceNet: LONG_TOTAL, totalNetAmount: LONG_TOTAL, totalGrossAmount: LONG_TOTAL, taxAmount: '0' }],
        subtotalNetAmount: LONG_TOTAL,
        subtotalGrossAmount: LONG_TOTAL,
        discountTotalAmount: '0',
        taxTotalAmount: '0',
        grandTotalNetAmount: LONG_TOTAL,
        [field]: LONG_TOTAL,
      }
      const mapped = withExactDocumentInput(parseScopedCommandInput(orderCreateSchema, raw, ctx, translate), raw)
      expect(typeof mapped.grandTotalGrossAmount).toBe('number')
      expect(mapped).toHaveProperty('grandTotalGrossAmountExact', LONG_TOTAL)
      await getHandler('sales.orders.create').execute(mapped, ctx)
      expect(persisted.find((record) => typeof record.orderNumber === 'string')?.grandTotalGrossAmount).toBe(LONG_TOTAL)
      expect(flush).toHaveBeenCalled()
    },
  )

  it.each(['orderTotals', 'order_totals'])('keeps nested exact header amounts when %s is accepted', (field) => {
    const { ctx } = buildHarness()
    const raw = {
      orderId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      lines: [line],
      [field]: { grandTotalGrossAmount: LONG_AMOUNT },
    }
    const mapped = withExactOrderTotalsInput(parseScopedCommandInput(orderLineBulkUpsertSchema, raw, ctx, translate), raw)
    expect(mapped.orderTotals).toHaveProperty('grandTotalGrossAmount', Number(LONG_AMOUNT))
    expect(mapped.orderTotals).toHaveProperty('grandTotalGrossAmountExact', LONG_AMOUNT)
  })
})
