/** @jest-environment node */

/**
 * `documentUpdateSchema` (packages/core/src/modules/sales/commands/documents.ts)
 * is a closed object shared by `sales.orders.update` and `sales.quotes.update`:
 * a key it does not declare is stripped before `applyDocumentUpdate` runs, so
 * the command reports success having written nothing. `exchangeRate`,
 * `paymentStatusEntryId` and `fulfillmentStatusEntryId` are declared by the
 * order create schema (data/validators.ts) and were absent here, so an
 * integration re-syncing orders from a system of record silently lost all three
 * on every update.
 *
 * All three columns exist on SalesOrder only, so these tests pin both halves:
 * an order update writes them (entry ids together with their derived text
 * column), and a quote update rejects them with a 400 rather than dropping
 * them — dropping would let an otherwise-empty payload reach execution, and
 * `updateQuoteCommand` strips a sent quote's acceptance link on any update that
 * gets that far.
 */

import { createContainer, asValue, InjectionMode } from 'awilix'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import { SalesOrder, SalesQuote } from '../../data/entities'
import { documentUpdateSchema, type DocumentUpdateInput } from '../documents'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string) => key,
    translate: (key: string) => key,
  }),
}))

jest.mock('@open-mercato/shared/lib/crud/cache', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/crud/cache')
  return {
    ...actual,
    invalidateCrudCache: jest.fn(),
  }
})

const ORDER_ID = '11111111-1111-4111-8111-111111111111'
const QUOTE_ID = '44444444-4444-4444-8444-444444444444'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const TENANT_ID = '33333333-3333-4333-8333-333333333333'

const PAID_ENTRY_ID = '55555555-5555-4555-8555-555555555555'
const SHIPPED_ENTRY_ID = '66666666-6666-4666-8666-666666666666'
const UNKNOWN_ENTRY_ID = '77777777-7777-4777-8777-777777777777'

// Only these two ids resolve; UNKNOWN_ENTRY_ID stands for an entry that was
// deleted, belongs to another tenant, or never existed.
const DICTIONARY_ENTRIES: Record<string, string> = {
  [PAID_ENTRY_ID]: 'paid',
  [SHIPPED_ENTRY_ID]: 'shipped',
}

function makeOrder() {
  return {
    id: ORDER_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    orderNumber: 'O-1',
    status: null,
    statusEntryId: null,
    paymentStatus: 'pending',
    paymentStatusEntryId: 'entry-pending',
    fulfillmentStatus: 'unfulfilled',
    fulfillmentStatusEntryId: 'entry-unfulfilled',
    exchangeRate: '1.0',
    customerEntityId: null,
    customerContactId: null,
    customerSnapshot: null,
    billingAddressId: null,
    shippingAddressId: null,
    billingAddressSnapshot: null,
    shippingAddressSnapshot: null,
    currencyCode: 'USD',
    shippingMethodId: null,
    shippingMethodCode: null,
    shippingMethodSnapshot: null,
    paymentMethodId: null,
    paymentMethodCode: null,
    paymentMethodSnapshot: null,
    comments: null,
    internalNotes: null,
    metadata: null,
    deletedAt: null,
  }
}

// A quote has none of the three columns — not the entry ids, not their derived
// text columns, not exchange_rate.
function makeQuote(overrides: Record<string, unknown> = {}) {
  const {
    orderNumber: _orderNumber,
    internalNotes: _internalNotes,
    exchangeRate: _exchangeRate,
    paymentStatus: _paymentStatus,
    paymentStatusEntryId: _paymentStatusEntryId,
    fulfillmentStatus: _fulfillmentStatus,
    fulfillmentStatusEntryId: _fulfillmentStatusEntryId,
    ...rest
  } = makeOrder()
  return { ...rest, id: QUOTE_ID, quoteNumber: 'Q-1', ...overrides }
}

// A quote in `sent` status holds the customer's acceptance link. Any update
// that reaches execution clears it and reverts the quote to draft, so a payload
// carrying only a rejected field must not reach execution.
function makeSentQuote() {
  return makeQuote({
    status: 'sent',
    statusEntryId: 'entry-sent',
    acceptanceToken: 'tok-customer-link',
    sentAt: new Date('2026-08-01T00:00:00.000Z'),
  })
}

type StoredDocument = Record<string, unknown>

function makeEm(document: StoredDocument, entityClass: unknown = SalesOrder) {
  const em: any = {
    findOne: jest.fn(async (requested: unknown, where: any) => {
      if (requested === entityClass) return document
      if (requested === DictionaryEntry) {
        const value = DICTIONARY_ENTRIES[where?.id as string]
        return value ? { id: where.id, value, tenantId: where.tenantId } : null
      }
      return null
    }),
    find: jest.fn(async () => []),
    create: jest.fn((_entityClass: unknown, data: unknown) => data),
    persist: jest.fn(),
    remove: jest.fn(),
    nativeDelete: jest.fn(async () => 0),
    getReference: jest.fn((_entityClass: unknown, id: string) => ({ id })),
    flush: jest.fn(async () => {}),
    begin: jest.fn(async () => {}),
    commit: jest.fn(async () => {}),
    rollback: jest.fn(async () => {}),
    fork: () => em,
  }
  return em
}

function makeCtx(em: unknown) {
  const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
  container.register({ em: asValue(em) })
  return {
    container,
    auth: { tenantId: TENANT_ID, orgId: ORG_ID, sub: 'user-1' },
    selectedOrganizationId: ORG_ID,
    organizationScope: null,
    organizationIds: null,
  } as any
}

function getHandler(commandId = 'sales.orders.update') {
  const handler = commandRegistry.get<DocumentUpdateInput, { order: SalesOrder }>(commandId)
  expect(handler).toBeTruthy()
  return handler!
}

async function updateOrder(
  input: Record<string, unknown>,
  order: Record<string, unknown> = makeOrder(),
) {
  const em = makeEm(order)
  await getHandler().execute({ id: ORDER_ID, ...input } as never, makeCtx(em))
  return order
}

async function updateQuote(
  input: Record<string, unknown>,
  quote: Record<string, unknown> = makeQuote(),
) {
  const em = makeEm(quote, SalesQuote)
  await getHandler('sales.quotes.update').execute(
    { id: QUOTE_ID, ...input } as never,
    makeCtx(em),
  )
  return quote
}

const ORDER_ONLY_FIELDS: Array<[string, unknown]> = [
  ['exchangeRate', 4.25],
  ['paymentStatusEntryId', PAID_ENTRY_ID],
  ['fulfillmentStatusEntryId', SHIPPED_ENTRY_ID],
]

describe('documentUpdateSchema — order-only fields', () => {
  it.each(ORDER_ONLY_FIELDS)(
    'accepts %s, which the create schema declares but the update schema did not',
    (field, value) => {
      const result = documentUpdateSchema.safeParse({ id: ORDER_ID, [field]: value })

      expect(result.success).toBe(true)
      expect(result.data).toMatchObject({ [field]: value })
    },
  )

  it.each(ORDER_ONLY_FIELDS)(
    'does not reject an update whose only edit is %s as an empty payload',
    (field, value) => {
      const result = documentUpdateSchema.safeParse({ id: ORDER_ID, [field]: value })

      expect(result.error?.issues.map((issue) => issue.message) ?? []).not.toContain(
        'update_payload_empty',
      )
    },
  )

  it.each(ORDER_ONLY_FIELDS)('accepts null for %s so the column can be cleared', (field) => {
    const result = documentUpdateSchema.safeParse({ id: ORDER_ID, [field]: null })

    expect(result.success).toBe(true)
    expect(result.data).toMatchObject({ [field]: null })
  })

  // The union puts z.null() first precisely for this: z.coerce.number() accepts
  // null and turns it into 0, which would write a zero rate instead of clearing.
  it('keeps a null exchangeRate null rather than coercing it to zero', () => {
    const result = documentUpdateSchema.safeParse({ id: ORDER_ID, exchangeRate: null })

    expect(result.data?.exchangeRate).toBeNull()
  })

  it('rejects a negative exchangeRate, matching the create schema minimum', () => {
    const result = documentUpdateSchema.safeParse({ id: ORDER_ID, exchangeRate: -1 })

    expect(result.success).toBe(false)
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toContain('exchangeRate')
  })

  it.each(['paymentStatusEntryId', 'fulfillmentStatusEntryId'])(
    'rejects a non-uuid %s',
    (field) => {
      const result = documentUpdateSchema.safeParse({ id: ORDER_ID, [field]: 'not-a-uuid' })

      expect(result.success).toBe(false)
      expect(result.error?.issues.map((issue) => issue.path.join('.'))).toContain(field)
    },
  )
})

describe('sales.orders.update — order-only columns', () => {
  // The static import of ../documents above is what registers the command.

  it('writes exchangeRate, which no other update field could reach', async () => {
    const order = await updateOrder({ exchangeRate: 4.25 })

    expect(order.exchangeRate).toBe('4.25')
  })

  it('accepts an exchangeRate sent as a numeric string, like the create schema', async () => {
    const order = await updateOrder({ exchangeRate: '3.5' })

    expect(order.exchangeRate).toBe('3.5')
  })

  it('clears exchangeRate when sent as null instead of writing zero', async () => {
    const order = await updateOrder({ exchangeRate: null })

    expect(order.exchangeRate).toBeNull()
  })

  it('writes paymentStatusEntryId together with its derived text column', async () => {
    const order = await updateOrder({ paymentStatusEntryId: PAID_ENTRY_ID })

    expect(order).toMatchObject({
      paymentStatusEntryId: PAID_ENTRY_ID,
      paymentStatus: 'paid',
    })
  })

  it('writes fulfillmentStatusEntryId together with its derived text column', async () => {
    const order = await updateOrder({ fulfillmentStatusEntryId: SHIPPED_ENTRY_ID })

    expect(order).toMatchObject({
      fulfillmentStatusEntryId: SHIPPED_ENTRY_ID,
      fulfillmentStatus: 'shipped',
    })
  })

  it.each([
    ['paymentStatusEntryId', 'paymentStatus'],
    ['fulfillmentStatusEntryId', 'fulfillmentStatus'],
  ])('clears both %s and %s when the id is sent as null', async (idField, textField) => {
    const order = await updateOrder({ [idField]: null })

    expect(order).toMatchObject({ [idField]: null, [textField]: null })
  })

  it.each(['paymentStatusEntryId', 'fulfillmentStatusEntryId'])(
    'rejects an unresolvable %s with a 400 and writes nothing',
    async (field) => {
      const order = makeOrder()

      await expect(updateOrder({ [field]: UNKNOWN_ENTRY_ID }, order)).rejects.toMatchObject({
        status: 400,
      })

      expect(order).toMatchObject({
        paymentStatusEntryId: 'entry-pending',
        paymentStatus: 'pending',
        fulfillmentStatusEntryId: 'entry-unfulfilled',
        fulfillmentStatus: 'unfulfilled',
      })
    },
  )

  it('writes all three in a single update', async () => {
    const order = await updateOrder({
      exchangeRate: 1.075,
      paymentStatusEntryId: PAID_ENTRY_ID,
      fulfillmentStatusEntryId: SHIPPED_ENTRY_ID,
    })

    expect(order).toMatchObject({
      exchangeRate: '1.075',
      paymentStatusEntryId: PAID_ENTRY_ID,
      paymentStatus: 'paid',
      fulfillmentStatusEntryId: SHIPPED_ENTRY_ID,
      fulfillmentStatus: 'shipped',
    })
  })

  it('keeps all three untouched when the update omits them', async () => {
    const order = await updateOrder({ customerReference: 'REF-1' })

    expect(order).toMatchObject({
      exchangeRate: '1.0',
      paymentStatusEntryId: 'entry-pending',
      paymentStatus: 'pending',
      fulfillmentStatusEntryId: 'entry-unfulfilled',
      fulfillmentStatus: 'unfulfilled',
    })
  })

  it.each([
    ['exchangeRate', ['exchangeRate']],
    ['paymentStatusEntryId', ['paymentStatus', 'paymentStatusEntryId']],
    ['fulfillmentStatusEntryId', ['fulfillmentStatus', 'fulfillmentStatusEntryId']],
  ] as Array<[string, string[]]>)(
    'reports %s to the audit log together with every column it moves',
    async (field, expectedKeys) => {
      const changed: Record<string, Record<string, unknown>> = {
        exchangeRate: { exchangeRate: '4.25' },
        paymentStatusEntryId: {
          paymentStatusEntryId: PAID_ENTRY_ID,
          paymentStatus: 'paid',
        },
        fulfillmentStatusEntryId: {
          fulfillmentStatusEntryId: SHIPPED_ENTRY_ID,
          fulfillmentStatus: 'shipped',
        },
      }
      const inputValue: Record<string, unknown> = {
        exchangeRate: 4.25,
        paymentStatusEntryId: PAID_ENTRY_ID,
        fulfillmentStatusEntryId: SHIPPED_ENTRY_ID,
      }
      const before = { order: { ...makeOrder() }, tags: [] }
      const after = { order: { ...makeOrder(), ...changed[field] }, tags: [] }

      const log = await getHandler().buildLog?.({
        input: { id: ORDER_ID, [field]: inputValue[field] },
        snapshots: { before, after },
        result: { order: after.order },
      } as never)

      expect(Object.keys(log?.changes ?? {}).sort()).toEqual(expectedKeys)
    },
  )
})

describe('sales.quotes.update — order-only columns are rejected, not dropped', () => {
  it.each(ORDER_ONLY_FIELDS)('rejects %s on a quote rather than dropping it', async (field, value) => {
    await expect(updateQuote({ [field]: value })).rejects.toMatchObject({ status: 400 })
  })

  it.each(ORDER_ONLY_FIELDS)('leaves no %s property behind on the quote', async (field, value) => {
    const quote = makeQuote()

    await expect(updateQuote({ [field]: value }, quote)).rejects.toMatchObject({ status: 400 })

    expect(Object.prototype.hasOwnProperty.call(quote, field)).toBe(false)
  })

  it.each(ORDER_ONLY_FIELDS)(
    'leaves a sent quote intact when the payload carrying only %s is rejected',
    async (field, value) => {
      const quote = makeSentQuote()

      await expect(updateQuote({ [field]: value }, quote)).rejects.toMatchObject({ status: 400 })

      expect(quote).toMatchObject({
        acceptanceToken: 'tok-customer-link',
        sentAt: new Date('2026-08-01T00:00:00.000Z'),
        status: 'sent',
        statusEntryId: 'entry-sent',
      })
    },
  )

  it('rejects a null exchangeRate on a quote too — there is no column to clear', async () => {
    await expect(updateQuote({ exchangeRate: null })).rejects.toMatchObject({ status: 400 })
  })

  it('still writes fields a quote does have', async () => {
    const quote = await updateQuote({ customerReference: 'REF-1' })

    expect(quote.customerReference).toBe('REF-1')
  })
})
