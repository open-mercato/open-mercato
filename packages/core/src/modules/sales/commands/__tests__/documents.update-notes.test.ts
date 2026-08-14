/** @jest-environment node */

/**
 * `documentUpdateSchema` (packages/core/src/modules/sales/commands/documents.ts)
 * is a closed object: a key it does not declare is stripped before
 * `applyDocumentUpdate` runs, so the command reports success having written
 * nothing. It declares `comment` (singular), while the create schema declares
 * `comments` and `internalNotes` — so a caller reusing its create payload on an
 * update silently lost both note columns. These tests pin that an update
 * accepts the create schema's names, writes them, can clear them, and reports
 * them as changed keys to the audit log.
 */

import { createContainer, asValue, InjectionMode } from 'awilix'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
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

function makeOrder() {
  return {
    id: ORDER_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    orderNumber: 'O-1',
    status: null,
    statusEntryId: null,
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
    comments: 'stored customer note',
    internalNotes: 'stored internal note',
    metadata: null,
    deletedAt: null,
  }
}

// A quote carries `comments` but has no `internalNotes` column at all.
function makeQuote() {
  const { orderNumber: _orderNumber, internalNotes: _internalNotes, ...rest } = makeOrder()
  return { ...rest, id: QUOTE_ID, quoteNumber: 'Q-1' }
}

type StoredDocument = Record<string, unknown>

function makeEm(document: StoredDocument, entityClass: unknown = SalesOrder) {
  const em: any = {
    findOne: jest.fn(async (requested: unknown) =>
      requested === entityClass ? document : null,
    ),
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

async function updateOrder(input: Record<string, unknown>) {
  const order = makeOrder()
  const em = makeEm(order)
  await getHandler().execute({ id: ORDER_ID, ...input } as never, makeCtx(em))
  return order
}

async function updateQuote(input: Record<string, unknown>) {
  const quote = makeQuote()
  const em = makeEm(quote, SalesQuote)
  await getHandler('sales.quotes.update').execute(
    { id: QUOTE_ID, ...input } as never,
    makeCtx(em),
  )
  return quote
}

describe('documentUpdateSchema — note fields', () => {
  it.each(['comments', 'internalNotes'])(
    'accepts %s, which the create schema declares but the update schema did not',
    (field) => {
      const result = documentUpdateSchema.safeParse({
        id: ORDER_ID,
        [field]: 'note',
      })

      expect(result.success).toBe(true)
      expect(result.data).toMatchObject({ [field]: 'note' })
    },
  )

  it.each(['comments', 'internalNotes'])(
    'does not reject an update whose only edit is %s as an empty payload',
    (field) => {
      const result = documentUpdateSchema.safeParse({
        id: ORDER_ID,
        [field]: 'note',
      })

      expect(result.error?.issues.map((issue) => issue.message) ?? []).not.toContain(
        'update_payload_empty',
      )
    },
  )

  // The payload carries a second real edit, so a rejection can only come from
  // the length rule — not from the refine firing on an emptied payload.
  it.each(['comments', 'internalNotes'])('rejects a %s over 4000 characters', (field) => {
    const result = documentUpdateSchema.safeParse({
      id: ORDER_ID,
      customerReference: 'REF-1',
      [field]: 'x'.repeat(4001),
    })

    expect(result.success).toBe(false)
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toContain(field)
  })
})

describe('sales.orders.update — note columns', () => {
  // The static import of ../documents above is what registers the command.

  it('writes comments sent under the create schema name', async () => {
    const order = await updateOrder({ comments: 'customer asked for a gift wrap' })

    expect(order.comments).toBe('customer asked for a gift wrap')
    expect(order.internalNotes).toBe('stored internal note')
  })

  it('writes internalNotes, which no other update field could reach', async () => {
    const order = await updateOrder({ internalNotes: 'call before dispatch' })

    expect(order.internalNotes).toBe('call before dispatch')
    expect(order.comments).toBe('stored customer note')
  })

  it('writes both in a single update', async () => {
    const order = await updateOrder({
      comments: 'customer note',
      internalNotes: 'internal note',
    })

    expect(order).toMatchObject({
      comments: 'customer note',
      internalNotes: 'internal note',
    })
  })

  it.each([
    ['null', null],
    ['whitespace only', '   '],
  ])('clears both columns when sent as %s', async (_label, value) => {
    const order = await updateOrder({ comments: value, internalNotes: value })

    expect(order).toMatchObject({ comments: null, internalNotes: null })
  })

  it('keeps both columns untouched when the update omits them', async () => {
    const order = await updateOrder({ customerReference: 'REF-1' })

    expect(order).toMatchObject({
      comments: 'stored customer note',
      internalNotes: 'stored internal note',
    })
  })

  it('lets the canonical comments win over the legacy singular comment', async () => {
    const order = await updateOrder({ comment: 'legacy', comments: 'canonical' })

    expect(order.comments).toBe('canonical')
  })

  it('still honours the legacy singular comment on its own', async () => {
    const order = await updateOrder({ comment: 'legacy only' })

    expect(order.comments).toBe('legacy only')
  })

  // `entity` is `SalesOrder | SalesQuote` and only the order half declares
  // internalNotes, so an unguarded assignment sets a property MikroORM has no
  // column for — reporting success and persisting nothing. That is the same
  // silent no-op this change exists to fix, one entity over.
  it('does not put internalNotes on a quote, which has no such column', async () => {
    const quote = await updateQuote({ internalNotes: 'should not land on a quote' })

    expect(Object.prototype.hasOwnProperty.call(quote, 'internalNotes')).toBe(false)
  })

  it('still writes comments on a quote, which does have that column', async () => {
    const quote = await updateQuote({ comments: 'quote customer note' })

    expect(quote.comments).toBe('quote customer note')
  })

  it('reports both note columns to the audit log as changed keys', async () => {
    const before = { order: { ...makeOrder() }, tags: [] }
    const after = {
      order: { ...makeOrder(), comments: 'new customer', internalNotes: 'new internal' },
      tags: [],
    }

    const log = await getHandler().buildLog?.({
      input: { id: ORDER_ID, comments: 'new customer', internalNotes: 'new internal' },
      snapshots: { before, after },
      result: { order: after.order },
    } as never)

    expect(Object.keys(log?.changes ?? {}).sort()).toEqual(['comments', 'internalNotes'])
  })
})
