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
    const quote: any = {
      id: 'quote-1',
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      quoteNumber: 'Q-1',
      status: null,
      statusEntryId: null,
      customerEntityId: 'cust-1',
      customerContactId: null,
      customerSnapshot: {
        customer: { id: 'cust-1', primaryEmail: 'old@example.com' },
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
          id: 'cust-1',
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
      auth: { tenantId: 'tenant-1', orgId: 'org-1', sub: 'user-1' },
      selectedOrganizationId: 'org-1',
      organizationScope: null,
      organizationIds: null,
    }

    const handler = commandRegistry.get<DocumentUpdateInput, { quote: SalesQuote }>('sales.quotes.update')
    expect(handler).toBeTruthy()

    await handler?.execute({ id: 'quote-1', customerEntityId: 'cust-1' }, ctx)

    expect(findOne).toHaveBeenCalledWith(
      CustomerEntity,
      { id: 'cust-1', organizationId: 'org-1', tenantId: 'tenant-1' },
      { populate: ['personProfile', 'companyProfile'] }
    )
    expect(quote.customerSnapshot?.customer?.primaryEmail).toBe('new@example.com')

    expect(invalidateMock).toHaveBeenCalledWith(
      container,
      'sales.quote',
      { id: 'quote-1', organizationId: 'org-1', tenantId: 'tenant-1' },
      'tenant-1',
      'updated'
    )
  })
})
