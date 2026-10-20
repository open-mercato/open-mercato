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
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { CustomerEntity, CustomerPersonProfile } from '@open-mercato/core/modules/customers/data/entities'
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
const QUOTE_ID = '66666666-6666-4666-8666-666666666666'
const CUSTOMER_ID = '22222222-2222-4222-8222-222222222222'
const OTHER_CUSTOMER_ID = '77777777-7777-4777-8777-777777777777'
const CONTACT_ID = '55555555-5555-4555-8555-555555555555'
const OTHER_CONTACT_ID = '88888888-8888-4888-8888-888888888888'
const ORG_ID = '33333333-3333-4333-8333-333333333333'
const TENANT_ID = '44444444-4444-4444-8444-444444444444'
const BILLING_ADDRESS_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const SHIPPING_ADDRESS_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const CUSTOMERS: Record<string, Record<string, unknown>> = {
  [CUSTOMER_ID]: { id: CUSTOMER_ID, kind: 'person', displayName: 'Customer One', primaryEmail: 'one@example.com' },
  [OTHER_CUSTOMER_ID]: { id: OTHER_CUSTOMER_ID, kind: 'person', displayName: 'Customer Two', primaryEmail: 'two@example.com' },
}

const CONTACTS: Record<string, Record<string, unknown>> = {
  [CONTACT_ID]: { id: CONTACT_ID, firstName: 'Jane', lastName: 'Doe' },
  [OTHER_CONTACT_ID]: { id: OTHER_CONTACT_ID, firstName: 'John', lastName: 'Roe' },
}

function makeDocument(kind: 'order' | 'quote') {
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
  } as Record<string, unknown>
}

function makeEm(document: Record<string, unknown>, documentClass: unknown) {
  const em: any = {
    findOne: jest.fn(async (requested: unknown, where: any) => {
      if (requested === documentClass) return document
      if (requested === CustomerEntity) {
        const customer = CUSTOMERS[where?.id as string]
        return customer ? { primaryPhone: null, personProfile: null, companyProfile: null, ...customer } : null
      }
      if (requested === CustomerPersonProfile) {
        const contact = CONTACTS[where?.id as string]
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

function makeCtx(em: unknown) {
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
  } as any
}

async function updateDocument(kind: 'order' | 'quote', input: Record<string, unknown>) {
  expect(documentUpdateSchema).toBeDefined()
  const document = makeDocument(kind)
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
    expect((document.customerSnapshot as any)?.contact?.id).toBe(CONTACT_ID)
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
    expect((document.customerSnapshot as any)?.contact?.id).toBe(OTHER_CONTACT_ID)
  })

  it('clears the contact and both addresses when the customer changes', async () => {
    const document = await updateDocument(kind, { customerEntityId: OTHER_CUSTOMER_ID })

    expect(document).toMatchObject({
      customerEntityId: OTHER_CUSTOMER_ID,
      customerContactId: null,
      ...CLEARED_ADDRESSES,
    })
    expect((document.customerSnapshot as any)?.customer?.id).toBe(OTHER_CUSTOMER_ID)
    expect((document.customerSnapshot as any)?.contact).toBeNull()
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
    expect((document.customerSnapshot as any)?.contact?.id).toBe(OTHER_CONTACT_ID)
  })

  it('keeps both addresses when a document without a customer is detached again', async () => {
    const document = makeDocument(kind)
    document.customerEntityId = null
    document.customerContactId = null
    document.customerSnapshot = null
    const em = makeEm(document, kind === 'order' ? SalesOrder : SalesQuote)
    const handler = commandRegistry.get<DocumentUpdateInput, unknown>(
      kind === 'order' ? 'sales.orders.update' : 'sales.quotes.update',
    )
    await handler!.execute({ id: document.id, customerEntityId: null } as never, makeCtx(em))

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
