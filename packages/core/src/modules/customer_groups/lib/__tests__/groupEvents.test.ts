const emitMock = jest.fn(async (..._args: unknown[]) => {})
jest.mock('../../events', () => ({
  emitCustomerGroupsEvent: (...args: unknown[]) => emitMock(...args),
}))

import { emitCustomerGroupLifecycleEvent } from '../groupEvents'

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
