/** @jest-environment node */

const enqueue = jest.fn(async () => undefined)
const resolveContainerValue = jest.fn()
const resolveOrganizationScopeForRequest = jest.fn()
const findWithDecryption = jest.fn()
const loadCustomerSummaries = jest.fn()
const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: async () => ({
    sub: 'user-1',
    tenantId,
    orgId: organizationId,
    roles: ['admin'],
  }),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({ resolve: resolveContainerValue }),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback: string) => fallback }),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: (...args: unknown[]) => resolveOrganizationScopeForRequest(...args),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryption(...args),
}))

jest.mock('@open-mercato/core/modules/customers/data/entities', () => ({
  CustomerInteraction: class CustomerInteraction {},
}))

jest.mock('@open-mercato/core/modules/customers/lib/interactionReadModel', () => ({
  loadCustomerSummaries: (...args: unknown[]) => loadCustomerSummaries(...args),
}))

jest.mock('../../../lib/queue', () => ({
  EXAMPLE_CUSTOMERS_SYNC_RECONCILE_QUEUE: 'example-customers-sync-reconcile',
  getExampleCustomersSyncQueue: () => ({ enqueue }),
}))

import { GET as listMappings } from '../mappings/route'
import { POST as reconcile } from '../reconcile/route'

describe('example customers sync route scope', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('rejects reconcile with an explicit body organization before queue or container access', async () => {
    resolveOrganizationScopeForRequest.mockResolvedValue({
      tenantId,
      selectedId: organizationId,
      filterIds: [],
      allowedIds: [organizationId],
    })

    const response = await reconcile(new Request('http://localhost/api/example-customers-sync/reconcile', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ organizationId }),
    }))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
    expect(enqueue).not.toHaveBeenCalled()
    expect(resolveContainerValue).not.toHaveBeenCalled()
  })

  it('rejects mappings when allowed organizations are explicitly empty before any data access', async () => {
    resolveOrganizationScopeForRequest.mockResolvedValue({
      tenantId,
      selectedId: organizationId,
      filterIds: null,
      allowedIds: [],
    })

    const response = await listMappings(new Request('http://localhost/api/example-customers-sync/mappings'))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
    expect(resolveContainerValue).not.toHaveBeenCalled()
    expect(findWithDecryption).not.toHaveBeenCalled()
    expect(loadCustomerSummaries).not.toHaveBeenCalled()
  })
})
