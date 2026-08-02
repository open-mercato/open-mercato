/** @jest-environment node */

import { asValue, createContainer, InjectionMode } from 'awilix'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'
import {
  ORDER_PAYMENT_LEDGER_FIELDS,
  ORDER_PAYMENT_LEDGER_WARNING_CODE,
  orderCreateSchema,
  resolveSuppliedOrderPaymentLedgerFields,
  type OrderPaymentLedgerWarning,
} from '../../data/validators'
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
  const warn = jest.fn()
  const logger = {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn,
    child: jest.fn(),
  }
  logger.child.mockReturnValue(logger)
  return {
    mockLoggerWarn: warn,
    createLogger: () => logger,
  }
})

const { mockLoggerWarn } = jest.requireMock('@open-mercato/shared/lib/logger') as {
  mockLoggerWarn: jest.Mock
}

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
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

const TEST_TENANT_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
const TEST_ORG_ID = 'bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb'

type OrderCreateResult = {
  orderId: string
  warnings?: OrderPaymentLedgerWarning[]
}

function num(value: unknown): number {
  return Number(value ?? 0)
}

function buildHarness() {
  const createdOrders: Record<string, unknown>[] = []
  const generatedNumbers: string[] = []
  let em: Record<string, unknown>
  em = {
    fork: () => em,
    create: (_entity: unknown, data: Record<string, unknown>) => ({ ...data }),
    persist: (entity: Record<string, unknown>) => {
      if (typeof entity.orderNumber === 'string') createdOrders.push(entity)
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
      generate: async () => {
        const number = `SO-${generatedNumbers.length + 1}`
        generatedNumbers.push(number)
        return { number }
      },
    }),
  })

  const ctx: CommandRuntimeContext = {
    container,
    auth: null,
    organizationScope: null,
    selectedOrganizationId: TEST_ORG_ID,
    organizationIds: [TEST_ORG_ID],
  }

  return { createdOrders, generatedNumbers, ctx }
}

function buildInput(extra: Record<string, unknown> = {}) {
  return {
    organizationId: TEST_ORG_ID,
    tenantId: TEST_TENANT_ID,
    currencyCode: 'USD',
    lines: [
      {
        name: 'Item',
        currencyCode: 'USD',
        quantity: 1,
        unitPriceNet: 100,
        unitPriceGross: 100,
        taxRate: 0,
        discountAmount: 0,
        discountPercent: 0,
      },
    ],
    ...extra,
  }
}

describe('orderCreateSchema — deprecated payment ledger input (#4695)', () => {
  it.each(ORDER_PAYMENT_LEDGER_FIELDS)('accepts the released %s input', (field) => {
    const result = orderCreateSchema.safeParse(buildInput({ [field]: 100 }))

    expect(result.success).toBe(true)
    expect(result.data?.[field]).toBe(100)
  })

  it('accepts zero values and reports supplied fields in canonical order', () => {
    const input = buildInput({ outstandingAmount: 0, paidTotalAmount: 0, refundedTotalAmount: 0 })

    expect(orderCreateSchema.safeParse(input).success).toBe(true)
    expect(resolveSuppliedOrderPaymentLedgerFields(input)).toEqual(ORDER_PAYMENT_LEDGER_FIELDS)
  })

  it('does not treat inherited ledger properties as supplied input', () => {
    const input = Object.create({ paidTotalAmount: 100 }) as Record<string, unknown>
    Object.assign(input, buildInput())

    expect(resolveSuppliedOrderPaymentLedgerFields(input)).toEqual([])
  })

  it('accepts a payload that omits the deprecated ledger fields', () => {
    expect(orderCreateSchema.safeParse(buildInput()).success).toBe(true)
  })
})

describe('sales.orders.create — deprecated payment ledger input (#4695)', () => {
  beforeAll(async () => {
    commandRegistry.clear?.()
    await import('../documents')
  })

  function getHandler() {
    const handler = commandRegistry.get<unknown, OrderCreateResult>('sales.orders.create')
    expect(handler).toBeTruthy()
    return handler!
  }

  it('ignores supplied totals, returns a stable warning, and logs once per process', async () => {
    const first = buildHarness()
    const second = buildHarness()

    const firstResult = await getHandler().execute(
      buildInput({ outstandingAmount: 0, paidTotalAmount: 100 }) as never,
      first.ctx,
    )
    await getHandler().execute(buildInput({ refundedTotalAmount: 25 }) as never, second.ctx)

    expect(firstResult.warnings).toEqual([
      {
        code: ORDER_PAYMENT_LEDGER_WARNING_CODE,
        fields: ['paidTotalAmount', 'outstandingAmount'],
      },
    ])
    expect(mockLoggerWarn).toHaveBeenCalledTimes(1)
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      'sales.orders.create ignored deprecated payment ledger input',
      {
        code: ORDER_PAYMENT_LEDGER_WARNING_CODE,
        fields: ['paidTotalAmount', 'outstandingAmount'],
      },
    )
    expect(first.generatedNumbers).toHaveLength(1)
    expect(first.createdOrders).toHaveLength(1)
    const order = first.createdOrders[0]
    expect(num(order.grandTotalGrossAmount)).toBeCloseTo(100, 4)
    expect(num(order.paidTotalAmount)).toBeCloseTo(0, 4)
    expect(num(order.refundedTotalAmount)).toBeCloseTo(0, 4)
    expect(num(order.outstandingAmount)).toBeCloseTo(100, 4)
  })

  it('keeps the historical clean create result and unpaid ledger', async () => {
    const { createdOrders, ctx } = buildHarness()

    const result = await getHandler().execute(buildInput() as never, ctx)

    expect(result).toEqual({ orderId: expect.any(String) })
    expect(createdOrders).toHaveLength(1)
    const order = createdOrders[0]
    expect(num(order.grandTotalGrossAmount)).toBeCloseTo(100, 4)
    expect(num(order.paidTotalAmount)).toBeCloseTo(0, 4)
    expect(num(order.refundedTotalAmount)).toBeCloseTo(0, 4)
    expect(num(order.outstandingAmount)).toBeCloseTo(100, 4)
  })
})
