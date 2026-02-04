/** @jest-environment node */

import { createContainer, asValue, InjectionMode } from 'awilix'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { invalidateCrudCache } from '@open-mercato/shared/lib/crud/cache'
import { CustomerEntity, CustomerPersonProfile } from '@open-mercato/core/modules/customers/data/entities'
import { SalesQuote } from '../../data/entities'
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

describe('sales quote update cache + snapshot refresh', () => {
  const invalidateMock = invalidateCrudCache as jest.MockedFunction<typeof invalidateCrudCache>

  beforeAll(async () => {
    commandRegistry.clear?.()
    await import('../documents')
  })

  afterEach(() => {
    invalidateMock.mockClear()
  })

  it('refreshes customer snapshot from DB and invalidates cache', async () => {
    const quoteId = '11111111-1111-4111-8111-111111111111'
    const customerId = '22222222-2222-4222-8222-222222222222'
    const organizationId = '33333333-3333-4333-8333-333333333333'
    const tenantId = '44444444-4444-4444-8444-444444444444'

    const quote: any = {
      id: quoteId,
      organizationId,
      tenantId,
      quoteNumber: 'Q-1',
      status: null,
      statusEntryId: null,
      customerEntityId: customerId,
      customerContactId: null,
      customerSnapshot: {
        customer: { id: customerId, primaryEmail: 'old@example.com' },
        contact: null,
      },
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
    }

    const findOne = jest.fn(async (entityClass: unknown) => {
      if (entityClass === SalesQuote) return quote
      if (entityClass === CustomerEntity) {
        return {
          id: customerId,
          kind: 'person',
          displayName: 'Customer One',
          primaryEmail: 'new@example.com',
          primaryPhone: null,
          personProfile: null,
          companyProfile: null,
        }
      }
      if (entityClass === CustomerPersonProfile) return null
      return null
    })

    const em = {
      findOne,
      flush: jest.fn(async () => {}),
      fork: () => em,
    }

    const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
    container.register({ em: asValue(em) })

    const ctx: any = {
      container,
      auth: { tenantId, orgId: organizationId, sub: 'user-1' },
      selectedOrganizationId: organizationId,
      organizationScope: null,
      organizationIds: null,
    }

    const handler = commandRegistry.get<DocumentUpdateInput, { quote: SalesQuote }>('sales.quotes.update')
    expect(handler).toBeTruthy()

    await handler?.execute({ id: quoteId, customerEntityId: customerId }, ctx)

    expect(findOne).toHaveBeenCalledWith(
      CustomerEntity,
      { id: customerId, organizationId, tenantId },
      { populate: ['personProfile', 'companyProfile'] }
    )
    expect(quote.customerSnapshot?.customer?.primaryEmail).toBe('new@example.com')

    expect(invalidateMock).toHaveBeenCalledWith(
      container,
      'sales.quote',
      { id: quoteId, organizationId, tenantId },
      tenantId,
      'updated'
    )
  })
})
