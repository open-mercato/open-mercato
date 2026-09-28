import { clearOtherDefaultGroups } from '../crud'
import { CustomerGroup } from '../../../data/entities'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const GROUP_ID = '22222222-2222-4222-8222-222222222222'

describe('clearOtherDefaultGroups', () => {
  it('unsets every other default group for the tenant', async () => {
    const em = { nativeUpdate: jest.fn().mockResolvedValue(1) }

    await clearOtherDefaultGroups(em as any, TENANT_ID)

    expect(em.nativeUpdate).toHaveBeenCalledWith(
      CustomerGroup,
      { tenantId: TENANT_ID, isDefault: true, deletedAt: null },
      { isDefault: false },
    )
  })

  it('excludes the group being saved so it does not unset itself', async () => {
    const em = { nativeUpdate: jest.fn().mockResolvedValue(1) }

    await clearOtherDefaultGroups(em as any, TENANT_ID, GROUP_ID)

    expect(em.nativeUpdate).toHaveBeenCalledWith(
      CustomerGroup,
      { tenantId: TENANT_ID, isDefault: true, deletedAt: null, id: { $ne: GROUP_ID } },
      { isDefault: false },
    )
  })
})
