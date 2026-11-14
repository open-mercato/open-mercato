import { getRecipientUserIdsForFeature } from '@open-mercato/core/modules/notifications/lib/notificationRecipients'

describe('MFA bypass notification audience candidates', () => {
  test('honors exact, wildcard, and super-admin grants while excluding unrelated roles', async () => {
    const query: Record<string, jest.Mock> = {}
    query.innerJoin = jest.fn(() => query)
    query.where = jest.fn(() => query)
    query.select = jest.fn(() => query)
    query.execute = jest.fn()
      .mockResolvedValueOnce([
        { user_id: 'user-wildcard', features_json: ['security.mfa.*'], is_super_admin: false },
        { user_id: 'user-unrelated', features_json: ['security.admin.manage'], is_super_admin: false },
        { user_id: 'user-super', features_json: [], is_super_admin: true },
      ])
      .mockResolvedValueOnce([
        { user_id: 'role-exact', features_json: ['security.mfa.manage'], is_super_admin: false },
        { user_id: 'role-module', features_json: ['security.*'], is_super_admin: false },
        { user_id: 'role-global', features_json: ['*'], is_super_admin: false },
        { user_id: 'role-unrelated', features_json: ['security.mfa.view'], is_super_admin: false },
      ])
    const db = { selectFrom: jest.fn(() => query) }

    await expect(getRecipientUserIdsForFeature(db as never, 'tenant-1', 'security.mfa.manage')).resolves.toEqual([
      'user-wildcard', 'user-super', 'role-exact', 'role-module', 'role-global',
    ])
    expect(query.where).toHaveBeenCalledWith('users.tenant_id', '=', 'tenant-1')
    expect(query.where).toHaveBeenCalledWith('user_acls.tenant_id', '=', 'tenant-1')
    expect(query.where).toHaveBeenCalledWith('role_acls.tenant_id', '=', 'tenant-1')
  })
})
