/** @jest-environment node */

/**
 * The order/quote detail page's customer editor always sends `customerEntityId`
 * on save, including when the customer is unchanged and only the customer email
 * was edited. `applyDocumentUpdate` used to treat the key's presence as a
 * customer change and cleared the contact and both addresses every time.
 *
 * These tests pin the invariant: the contact and addresses are reset only when
 * the customer actually changes (including detaching it with null), and a new
 * customer's snapshot never carries the previous customer's contact.
 */

import { createContainer, asValue, InjectionMode } from 'awilix'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { CustomerEntity, CustomerPersonProfile } from '@open-mercato/core/modules/customers/data/entities'
import { SalesOrder, SalesQuote } from '../../data/entities'
import '../documents'
import type { DocumentUpdateInput } from '../documents'

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
const QUOTE_ID = '66666666-6666-4666-8666-666666666666'
const CUSTOMER_ID = 'c0ffee22-2bad-4cab-8fed-22222222abcd'
const OTHER_CUSTOMER_ID = 'beefcafe-77ab-4cde-8f77-7777777fedcb'
const CONTACT_ID = '55555555-5555-4555-8555-555555555555'
const OTHER_CONTACT_ID = '88888888-8888-4888-8888-888888888888'
const ORG_ID = '33333333-3333-4333-8333-333333333333'
const TENANT_ID = '44444444-4444-4444-8444-444444444444'
const BILLING_ADDRESS_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const SHIPPING_ADDRESS_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const OTHER_BILLING_ADDRESS_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const OTHER_SHIPPING_ADDRESS_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

const CUSTOMERS: Record<string, Record<string, unknown>> = {
  [CUSTOMER_ID]: { id: CUSTOMER_ID, kind: 'person', displayName: 'Customer One', primaryEmail: 'one@example.com' },
  [OTHER_CUSTOMER_ID]: { id: OTHER_CUSTOMER_ID, kind: 'person', displayName: 'Customer Two', primaryEmail: 'two@example.com' },
}

const CONTACTS: Record<string, Record<string, unknown>> = {
  [CONTACT_ID]: { id: CONTACT_ID, firstName: 'Jane', lastName: 'Doe' },
  [OTHER_CONTACT_ID]: { id: OTHER_CONTACT_ID, firstName: 'John', lastName: 'Roe' },
}

type DocumentRecord = Record<string, unknown>

type CustomerSnapshotShape = {
  customer?: { id?: string } | null
  contact?: { id?: string } | null
} | null

type LookupWhere = { id?: string } | undefined

function customerSnapshotOf(document: DocumentRecord): CustomerSnapshotShape {
  return document.customerSnapshot as CustomerSnapshotShape
}

function lookupById<T>(records: Record<string, T>, where: LookupWhere): T | undefined {
  return typeof where?.id === 'string' ? records[where.id.toLowerCase()] : undefined
}

function mixCase(uuid: string): string {
  return uuid.replace(/[a-f]/g, (char, index: number) => (index % 2 === 0 ? char.toUpperCase() : char))
}

function makeDocument(kind: 'order' | 'quote'): DocumentRecord {
  return {
    id: kind === 'order' ? ORDER_ID : QUOTE_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    ...(kind === 'order' ? { orderNumber: 'O-1' } : { quoteNumber: 'Q-1' }),
    status: null,
    statusEntryId: null,
    customerEntityId: CUSTOMER_ID,
    customerContactId: CONTACT_ID,
    customerSnapshot: {
      customer: { id: CUSTOMER_ID, primaryEmail: 'one@example.com' },
      contact: { id: CONTACT_ID },
    },
    billingAddressId: BILLING_ADDRESS_ID,
    shippingAddressId: SHIPPING_ADDRESS_ID,
    billingAddressSnapshot: { line1: '1 Main St' },
    shippingAddressSnapshot: { line1: '2 Dock Rd' },
    currencyCode: 'USD',
    shippingMethodId: null,
    shippingMethodCode: null,
    shippingMethodSnapshot: null,
    paymentMethodId: null,
    paymentMethodCode: null,
    paymentMethodSnapshot: null,
    comments: null,
    metadata: null,
    deletedAt: null,
  }
}

function makeEm(document: DocumentRecord, documentClass: unknown): Record<string, unknown> {
  const em: Record<string, unknown> = {
    findOne: jest.fn(async (requested: unknown, where: LookupWhere) => {
      if (requested === documentClass) return document
      if (requested === CustomerEntity) {
        const customer = lookupById(CUSTOMERS, where)
        return customer ? { primaryPhone: null, personProfile: null, companyProfile: null, ...customer } : null
      }
      if (requested === CustomerPersonProfile) {
        const contact = lookupById(CONTACTS, where)
        return contact ? { preferredName: null, jobTitle: null, department: null, ...contact } : null
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

function makeCtx(em: unknown): CommandRuntimeContext {
  const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
  container.register({
    em: asValue(em),
    dataEngine: asValue({ markOrmEntityChange: jest.fn() }),
  })
  return {
    container,
    auth: { tenantId: TENANT_ID, orgId: ORG_ID, sub: 'user-1' },
    selectedOrganizationId: ORG_ID,
    organizationScope: null,
    organizationIds: null,
  }
}

async function updateDocument(
  kind: 'order' | 'quote',
  input: Record<string, unknown>,
  prepare: (document: DocumentRecord) => void = () => {},
) {
  const document = makeDocument(kind)
  prepare(document)
  const em = makeEm(document, kind === 'order' ? SalesOrder : SalesQuote)
  const handler = commandRegistry.get<DocumentUpdateInput, unknown>(
    kind === 'order' ? 'sales.orders.update' : 'sales.quotes.update',
  )
  expect(handler).toBeTruthy()
  await handler!.execute({ id: document.id, ...input } as never, makeCtx(em))
  return document
}

const KEPT_ADDRESSES = {
  billingAddressId: BILLING_ADDRESS_ID,
  shippingAddressId: SHIPPING_ADDRESS_ID,
  billingAddressSnapshot: { line1: '1 Main St' },
  shippingAddressSnapshot: { line1: '2 Dock Rd' },
}

const CLEARED_ADDRESSES = {
  billingAddressId: null,
  shippingAddressId: null,
  billingAddressSnapshot: null,
  shippingAddressSnapshot: null,
}

describe.each(['order', 'quote'] as const)('sales %s update — customer assignment', (kind) => {
  it('keeps the contact and both addresses when the same customer is resent', async () => {
    const document = await updateDocument(kind, { customerEntityId: CUSTOMER_ID })

    expect(document).toMatchObject({
      customerEntityId: CUSTOMER_ID,
      customerContactId: CONTACT_ID,
      ...KEPT_ADDRESSES,
    })
    expect(customerSnapshotOf(document)?.contact?.id).toBe(CONTACT_ID)
  })

  it.each([
    ['upper-case', CUSTOMER_ID.toUpperCase()],
    ['mixed-case', mixCase(CUSTOMER_ID)],
  ])('keeps the contact and both addresses when the same customer is resent in %s', async (_label, resentId) => {
    expect(resentId).not.toBe(CUSTOMER_ID)
    const document = await updateDocument(kind, { customerEntityId: resentId })

    expect(document).toMatchObject({
      customerEntityId: CUSTOMER_ID,
      customerContactId: CONTACT_ID,
      ...KEPT_ADDRESSES,
    })
    expect(customerSnapshotOf(document)?.customer?.id).toBe(CUSTOMER_ID)
    expect(customerSnapshotOf(document)?.contact?.id).toBe(CONTACT_ID)
  })

  it('clears the contact and both addresses when a different customer is sent in mixed case', async () => {
    const document = await updateDocument(kind, { customerEntityId: mixCase(OTHER_CUSTOMER_ID) })

    expect(document).toMatchObject({ customerContactId: null, ...CLEARED_ADDRESSES })
    expect((document.customerEntityId as string).toLowerCase()).toBe(OTHER_CUSTOMER_ID)
    expect(customerSnapshotOf(document)?.customer?.id).toBe(OTHER_CUSTOMER_ID)
  })

  it('keeps the contact and both addresses when only the customer email changes', async () => {
    const document = await updateDocument(kind, {
      customerEntityId: CUSTOMER_ID,
      metadata: { customerEmail: 'billing@example.com' },
    })

    expect(document).toMatchObject({
      customerContactId: CONTACT_ID,
      metadata: { customerEmail: 'billing@example.com' },
      ...KEPT_ADDRESSES,
    })
  })

  it('applies an explicit contact sent alongside the unchanged customer', async () => {
    const document = await updateDocument(kind, {
      customerEntityId: CUSTOMER_ID,
      customerContactId: OTHER_CONTACT_ID,
    })

    expect(document).toMatchObject({ customerContactId: OTHER_CONTACT_ID, ...KEPT_ADDRESSES })
    expect(customerSnapshotOf(document)?.contact?.id).toBe(OTHER_CONTACT_ID)
  })

  it('clears only the contact when the unchanged customer is sent with a null contact', async () => {
    const document = await updateDocument(kind, { customerEntityId: CUSTOMER_ID, customerContactId: null })

    expect(document).toMatchObject({ customerEntityId: CUSTOMER_ID, customerContactId: null, ...KEPT_ADDRESSES })
    expect(customerSnapshotOf(document)?.contact).toBeNull()
  })

  it('applies explicit address ids sent together with a new customer', async () => {
    const document = await updateDocument(kind, {
      customerEntityId: OTHER_CUSTOMER_ID,
      billingAddressId: OTHER_BILLING_ADDRESS_ID,
      shippingAddressId: OTHER_SHIPPING_ADDRESS_ID,
    })

    expect(document).toMatchObject({
      customerEntityId: OTHER_CUSTOMER_ID,
      customerContactId: null,
      billingAddressId: OTHER_BILLING_ADDRESS_ID,
      shippingAddressId: OTHER_SHIPPING_ADDRESS_ID,
    })
  })

  it('clears the contact and both addresses when the customer changes', async () => {
    const document = await updateDocument(kind, { customerEntityId: OTHER_CUSTOMER_ID })

    expect(document).toMatchObject({
      customerEntityId: OTHER_CUSTOMER_ID,
      customerContactId: null,
      ...CLEARED_ADDRESSES,
    })
    expect(customerSnapshotOf(document)?.customer?.id).toBe(OTHER_CUSTOMER_ID)
    expect(customerSnapshotOf(document)?.contact).toBeNull()
  })

  it('applies the contact sent together with a new customer and still clears the addresses', async () => {
    const document = await updateDocument(kind, {
      customerEntityId: OTHER_CUSTOMER_ID,
      customerContactId: OTHER_CONTACT_ID,
    })

    expect(document).toMatchObject({
      customerEntityId: OTHER_CUSTOMER_ID,
      customerContactId: OTHER_CONTACT_ID,
      ...CLEARED_ADDRESSES,
    })
    expect(customerSnapshotOf(document)?.contact?.id).toBe(OTHER_CONTACT_ID)
  })

  it('keeps both addresses when a document without a customer is detached again', async () => {
    const document = await updateDocument(kind, { customerEntityId: null }, (stored) => {
      stored.customerEntityId = null
      stored.customerContactId = null
      stored.customerSnapshot = null
    })

    expect(document).toMatchObject({ customerEntityId: null, customerSnapshot: null, ...KEPT_ADDRESSES })
  })

  it('clears the customer, contact and both addresses when the customer is detached', async () => {
    const document = await updateDocument(kind, { customerEntityId: null })

    expect(document).toMatchObject({
      customerEntityId: null,
      customerContactId: null,
      customerSnapshot: null,
      ...CLEARED_ADDRESSES,
    })
  })
})
