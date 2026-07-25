/** @jest-environment node */

/**
 * Repro for #3038 (Part 2): when a saved customer address is chosen as a sales
 * document shipping (or billing) address, the address must be DECRYPTED before
 * its values are snapshotted onto the document.
 *
 * CustomerAddress fields (address_line1, city, postal_code, ...) are encrypted
 * at rest (see customers/encryption.ts). `resolveAddressSnapshot` read the row
 * with a raw `em.findOne(CustomerAddress, ...)`, copying the still-encrypted
 * ciphertext into `shipping_address_snapshot` (an encrypted JSON column on the
 * order/quote). On read the outer JSON decrypts but the inner per-field values
 * stay garbled — exactly the `XQ4Q6eh...:...:...` strings in the issue. The fix
 * reads CustomerAddress through `findOneWithDecryption` (the platform rule for
 * every encrypted entity), so the snapshot carries plaintext.
 *
 * Driven through `sales.quotes.update` (the lightest command that reaches
 * `resolveAddressSnapshot`); the same `resolveAddressSnapshot` serves order +
 * quote create/update and billing + shipping, so one fix covers them all.
 */

import { asValue, createContainer, InjectionMode } from 'awilix'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CustomerAddress } from '@open-mercato/core/modules/customers/data/entities'
import { SalesQuote } from '../../data/entities'
import type { DocumentUpdateInput } from '../documents'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string) => key,
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

jest.mock('@open-mercato/shared/lib/crud/cache', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/crud/cache')
  return { ...actual, invalidateCrudCache: jest.fn() }
})

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(async () => []),
  findOneWithDecryption: jest.fn(),
}))

const ORG_ID = '33333333-3333-4333-8333-333333333333'
const TENANT_ID = '44444444-4444-4444-8444-444444444444'
const QUOTE_ID = '11111111-1111-4111-8111-111111111111'
const ADDRESS_ID = '55555555-5555-4555-8555-555555555555'

// Values as a RAW em.findOne would return them (encrypted at rest).
const CIPHERTEXT_LINE1 = 'XQ4Q6ehKAbJLHwl7:mRmR22kYhzylaQ==:dWcC'
const CIPHERTEXT_CITY = 'AVddsCP0zDPqZefv:BPyaBLUnVx0=:7hfU9abgRlU'
// Values as findOneWithDecryption would return them (decrypted).
const PLAIN_LINE1 = 'Dmowskiego 4r'
const PLAIN_CITY = 'Wroclaw'
const PLAIN_POSTAL = '55-556'
const PLAIN_COUNTRY = 'PL'

function makeCustomerAddress(overrides: Record<string, unknown>) {
  return {
    id: ADDRESS_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    name: null,
    purpose: null,
    companyName: null,
    addressLine1: 'OVERRIDE_ME',
    addressLine2: null,
    buildingNumber: null,
    flatNumber: null,
    city: null,
    region: null,
    postalCode: null,
    country: null,
    latitude: null,
    longitude: null,
    isPrimary: true,
    ...overrides,
  }
}

const cipherAddress = makeCustomerAddress({
  addressLine1: CIPHERTEXT_LINE1,
  city: CIPHERTEXT_CITY,
  postalCode: 'CIPHER_PC',
  country: 'CIPHER_C',
})

const plainAddress = makeCustomerAddress({
  addressLine1: PLAIN_LINE1,
  city: PLAIN_CITY,
  postalCode: PLAIN_POSTAL,
  country: PLAIN_COUNTRY,
})

function makeQuote() {
  return {
    id: QUOTE_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    quoteNumber: 'Q-1',
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
    metadata: null,
  } as Record<string, any>
}

function makeEm(quote: Record<string, any>) {
  const em: any = {
    // Raw reads return ciphertext (encrypted at rest).
    findOne: jest.fn(async (entityClass: unknown) => {
      if (entityClass === SalesQuote) return quote
      if (entityClass === CustomerAddress) return cipherAddress
      return null
    }),
    find: jest.fn(async () => []),
    flush: jest.fn(async () => {}),
    begin: jest.fn(async () => {}),
    commit: jest.fn(async () => {}),
    rollback: jest.fn(async () => {}),
    fork() {
      return this
    },
  }
  return em
}

describe('#3038 — sales document shipping address is decrypted before snapshot', () => {
  beforeAll(async () => {
    commandRegistry.clear?.()
    await import('../documents')
  })

  beforeEach(() => {
    jest.mocked(findWithDecryption).mockClear()
    // findOneWithDecryption returns the DECRYPTED address for CustomerAddress;
    // for every other entity it transparently delegates to the raw em read so
    // the rest of the command (quote load, snapshots) behaves normally.
    jest.mocked(findOneWithDecryption).mockReset()
    jest.mocked(findOneWithDecryption).mockImplementation(
      async (em: any, entityClass: unknown, where: unknown) => {
        if (entityClass === CustomerAddress) return plainAddress as any
        return em.findOne(entityClass, where)
      },
    )
  })

  it('snapshots decrypted values (not encrypted ciphertext) when shippingAddressId is a saved customer address', async () => {
    const quote = makeQuote()
    const em = makeEm(quote)
    const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
    container.register({ em: asValue(em) })
    const ctx: any = {
      container,
      auth: { tenantId: TENANT_ID, orgId: ORG_ID, sub: 'user-1' },
      selectedOrganizationId: ORG_ID,
      organizationScope: null,
      organizationIds: null,
    }

    const handler = commandRegistry.get<DocumentUpdateInput, { quote: SalesQuote }>('sales.quotes.update')
    expect(handler).toBeTruthy()

    await handler?.execute({ id: QUOTE_ID, shippingAddressId: ADDRESS_ID }, ctx)

    const snapshot = quote.shippingAddressSnapshot as Record<string, unknown> | null
    expect(snapshot).toBeTruthy()
    // The reported symptom: ciphertext leaking into the snapshot.
    expect(snapshot?.addressLine1).toBe(PLAIN_LINE1)
    expect(snapshot?.city).toBe(PLAIN_CITY)
    expect(snapshot?.postalCode).toBe(PLAIN_POSTAL)
    expect(JSON.stringify(snapshot)).not.toContain(CIPHERTEXT_LINE1)

    // The encrypted entity must be read through the decryption helper with the
    // document's tenant/org scope (the platform rule for encrypted reads).
    expect(jest.mocked(findOneWithDecryption)).toHaveBeenCalledWith(
      em,
      CustomerAddress,
      expect.objectContaining({ id: ADDRESS_ID }),
      undefined,
      expect.objectContaining({ tenantId: TENANT_ID, organizationId: ORG_ID }),
    )
  })
})
