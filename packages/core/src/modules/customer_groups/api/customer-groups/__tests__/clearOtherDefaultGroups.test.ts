import { clearOtherDefaultGroups } from '../crud'
import { CustomerGroup } from '../../../data/entities'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const GROUP_ID = '22222222-2222-4222-8222-222222222222'

describe('clearOtherDefaultGroups', () => {
  it('unsets every other default group for the tenant and bumps updatedAt', async () => {
    const em = { find: jest.fn().mockResolvedValue([]), nativeUpdate: jest.fn().mockResolvedValue(1) }

    await clearOtherDefaultGroups(em as never, TENANT_ID)

    expect(em.nativeUpdate).toHaveBeenCalledWith(
      CustomerGroup,
      { tenantId: TENANT_ID, isDefault: true, deletedAt: null },
      { isDefault: false, updatedAt: expect.any(Date) },
    )
  })

  it('excludes the group being saved so it does not unset itself', async () => {
    const em = { find: jest.fn().mockResolvedValue([]), nativeUpdate: jest.fn().mockResolvedValue(1) }

    await clearOtherDefaultGroups(em as never, TENANT_ID, GROUP_ID)

    expect(em.nativeUpdate).toHaveBeenCalledWith(
      CustomerGroup,
      { tenantId: TENANT_ID, isDefault: true, deletedAt: null, id: { $ne: GROUP_ID } },
      { isDefault: false, updatedAt: expect.any(Date) },
    )
  })

  it('returns the ids of the default groups it cleared', async () => {
    const OTHER_ID = '33333333-3333-4333-8333-333333333333'
    const em = { find: jest.fn().mockResolvedValue([{ id: OTHER_ID }]), nativeUpdate: jest.fn().mockResolvedValue(1) }

    const cleared = await clearOtherDefaultGroups(em as never, TENANT_ID, GROUP_ID)

    expect(cleared).toEqual([OTHER_ID])
    expect(em.find).toHaveBeenCalledWith(
      CustomerGroup,
      { tenantId: TENANT_ID, isDefault: true, deletedAt: null, id: { $ne: GROUP_ID } },
      { fields: ['id'] },
    )
  })
})
