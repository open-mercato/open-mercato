const emitMock = jest.fn(async (..._args: unknown[]) => {})
jest.mock('../../events', () => ({
  emitCustomerGroupsEvent: (...args: unknown[]) => emitMock(...args),
}))

const invalidateCrudCacheMock = jest.fn(async (..._args: unknown[]) => {})
jest.mock('@open-mercato/shared/lib/crud/cache', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/crud/cache'),
  invalidateCrudCache: (...args: unknown[]) => invalidateCrudCacheMock(...args),
}))

import { announceCustomerGroupTermsUpdated, emitCustomerGroupLifecycleEvent } from '../groupEvents'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const GROUP_ID = '22222222-2222-4222-8222-222222222222'

describe('emitCustomerGroupLifecycleEvent', () => {
  it('emits the group CRUD route payload shape: persistent, tenant-scoped, organizationId null', async () => {
    await emitCustomerGroupLifecycleEvent('customer_groups.group.updated', { id: GROUP_ID, tenantId: TENANT_ID })

    expect(emitMock).toHaveBeenCalledWith(
      'customer_groups.group.updated',
      { id: GROUP_ID, organizationId: null, tenantId: TENANT_ID },
      { persistent: true, tenantId: TENANT_ID, organizationId: null },
    )
  })
})

describe('announceCustomerGroupTermsUpdated', () => {
  const TERMS_ID = '33333333-3333-4333-8333-333333333333'

  beforeEach(() => {
    emitMock.mockClear()
    invalidateCrudCacheMock.mockClear()
  })

  it('flushes the owning group cache tags and emits customer_groups.terms.updated', async () => {
    const container = { resolve: jest.fn() } as unknown as Parameters<typeof announceCustomerGroupTermsUpdated>[0]

    await announceCustomerGroupTermsUpdated(container, { id: TERMS_ID, groupId: GROUP_ID, tenantId: TENANT_ID })

    expect(invalidateCrudCacheMock).toHaveBeenCalledWith(
      container,
      'customer.groups.group',
      { id: GROUP_ID, tenantId: TENANT_ID, organizationId: null },
      TENANT_ID,
      'updated',
      ['customer.group'],
    )
    expect(emitMock).toHaveBeenCalledWith(
      'customer_groups.terms.updated',
      { id: TERMS_ID, groupId: GROUP_ID, organizationId: null, tenantId: TENANT_ID },
      { persistent: true, tenantId: TENANT_ID, organizationId: null },
    )
  })

  it('declares customer_groups.terms.updated as a module event', () => {
    const { eventsConfig } = jest.requireActual('../../events') as typeof import('../../events')
    expect(eventsConfig.events.map((event) => event.id)).toContain('customer_groups.terms.updated')
  })
})
