/** @jest-environment node */

// Regression coverage for #4695: `orderCreateSchema` accepted `paidTotalAmount`,
// `refundedTotalAmount` and `outstandingAmount`, and `sales.orders.create` then
// hardcoded the ledger to "0" and recomputed totals from those zeros — the
// caller's values vanished with no error, warning or log.
//
// They are not a create-time input at all: `recomputeOrderPaymentTotals`
// (commands/payments.ts) rebuilds these three columns from the SalesPayment /
// SalesPaymentAllocation rows on every payment write, so a value seeded on the
// document has no payment history behind it and is erased by the next payment
// touch. The create surface therefore rejects them, and an order starts unpaid
// until a payment is recorded.

import { asValue, createContainer, InjectionMode } from 'awilix'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'
import {
  ORDER_PAYMENT_LEDGER_FIELDS,
  ORDER_PAYMENT_LEDGER_INPUT_MESSAGE,
  orderCreateSchema,
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

// The order-created notification fan-out needs a real database; it is non-critical
// to the create command and irrelevant to the totals under test.
jest.mock('@open-mercato/core/modules/notifications/lib/notificationService', () => ({
  resolveNotificationService: () => ({ createForFeature: jest.fn(async () => undefined) }),
}))

const TEST_TENANT_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
const TEST_ORG_ID = 'bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb'

type OrderCreateResult = { orderId: string }

function num(value: unknown): number {
  return Number(value ?? 0)
}

function buildHarness() {
  const createdOrders: Record<string, unknown>[] = []
  const generatedNumbers: string[] = []
  const em: Record<string, any> = {
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

// One 100.00 gross line; net equals gross so the grand total is exactly 100.00.
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

describe('orderCreateSchema — rejects payment ledger input (#4695)', () => {
  it.each(ORDER_PAYMENT_LEDGER_FIELDS)('rejects %s with an actionable message', (field) => {
    const result = orderCreateSchema.safeParse(buildInput({ [field]: 100 }))

    expect(result.success).toBe(false)
    const issue = result.error?.issues.find((entry) => entry.path.join('.') === field)
    expect(issue?.message).toBe(ORDER_PAYMENT_LEDGER_INPUT_MESSAGE)
  })

  it('rejects a zero ledger value too — the field is not part of the create surface', () => {
    const result = orderCreateSchema.safeParse(buildInput({ paidTotalAmount: 0 }))

    expect(result.success).toBe(false)
  })

  it('reports every supplied ledger field at once', () => {
    const result = orderCreateSchema.safeParse(
      buildInput({ paidTotalAmount: 100, refundedTotalAmount: 25, outstandingAmount: 0 }),
    )

    expect(result.success).toBe(false)
    expect(result.error?.issues.map((issue) => issue.path.join('.')).sort()).toEqual(
      [...ORDER_PAYMENT_LEDGER_FIELDS].sort(),
    )
  })

  it('accepts a payload that leaves the ledger to the payments module', () => {
    expect(orderCreateSchema.safeParse(buildInput()).success).toBe(true)
  })
})

describe('sales.orders.create — payment ledger (#4695)', () => {
  beforeAll(async () => {
    commandRegistry.clear?.()
    await import('../documents')
  })

  function getHandler() {
    const handler = commandRegistry.get<unknown, OrderCreateResult>('sales.orders.create')
    expect(handler).toBeTruthy()
    return handler!
  }

  it('rejects a supplied paidTotalAmount instead of discarding it', async () => {
    const { createdOrders, generatedNumbers, ctx } = buildHarness()

    await expect(
      getHandler().execute(buildInput({ paidTotalAmount: 100, outstandingAmount: 0 }) as never, ctx),
    ).rejects.toThrow(ORDER_PAYMENT_LEDGER_INPUT_MESSAGE)

    // Validation runs before the document number is drawn, so a rejected create
    // burns neither an order number nor a persisted row.
    expect(createdOrders).toHaveLength(0)
    expect(generatedNumbers).toHaveLength(0)
  })

  it('creates an unpaid order whose outstanding balance is the full grand total', async () => {
    const { createdOrders, ctx } = buildHarness()

    await getHandler().execute(buildInput() as never, ctx)

    expect(createdOrders).toHaveLength(1)
    const order = createdOrders[0]
    expect(num(order.grandTotalGrossAmount)).toBeCloseTo(100, 4)
    expect(num(order.paidTotalAmount)).toBeCloseTo(0, 4)
    expect(num(order.refundedTotalAmount)).toBeCloseTo(0, 4)
    expect(num(order.outstandingAmount)).toBeCloseTo(100, 4)
  })
})
