import {
  getRecipientUserIdsForFeature,
  getRecipientUserIdsForRole,
  getScopedNotificationRecipientUserIds,
} from '../lib/notificationRecipients'

function createQuery(rows: unknown[] = []) {
  const query: Record<string, jest.Mock> = {}
  query.innerJoin = jest.fn(() => query)
  query.where = jest.fn(() => query)
  query.select = jest.fn(() => query)
  query.execute = jest.fn().mockResolvedValue(rows)
  return query
}

describe('getScopedNotificationRecipientUserIds', () => {
  it('filters recipients by id, live status, tenant, and organization', async () => {
    const execute = jest.fn().mockResolvedValue([{ user_id: 'user-1' }])
    const query: Record<string, jest.Mock> = {}
    query.where = jest.fn(() => query)
    query.select = jest.fn(() => query)
    query.execute = execute
    const db = {
      selectFrom: jest.fn(() => query),
    }

    const result = await getScopedNotificationRecipientUserIds(
      db as never,
      'tenant-1',
      'org-1',
      ['user-1', 'user-2'],
    )

    expect(db.selectFrom).toHaveBeenCalledWith('users')
    expect(query.where).toHaveBeenCalledWith('users.id', 'in', ['user-1', 'user-2'])
    expect(query.where).toHaveBeenCalledWith('users.deleted_at', 'is', null)
    expect(query.where).toHaveBeenCalledWith('users.tenant_id', '=', 'tenant-1')
    expect(query.where).toHaveBeenCalledWith('users.organization_id', '=', 'org-1')
    expect(result).toEqual(['user-1'])
  })

  it('does not add an organization predicate when the caller has no organization scope', async () => {
    const query: Record<string, jest.Mock> = {}
    query.where = jest.fn(() => query)
    query.select = jest.fn(() => query)
    query.execute = jest.fn().mockResolvedValue([])
    const db = {
      selectFrom: jest.fn(() => query),
    }

    await getScopedNotificationRecipientUserIds(db as never, 'tenant-1', null, ['user-1'])

    expect(query.where).not.toHaveBeenCalledWith('users.organization_id', '=', expect.anything())
  })

  it('requires a live tenant role when resolving explicit role recipients', async () => {
    const query = createQuery([{ user_id: 'user-1' }])
    const db = { selectFrom: jest.fn(() => query) }

    await expect(getRecipientUserIdsForRole(db as never, 'tenant-1', 'role-1'))
      .resolves.toEqual(['user-1'])

    expect(query.innerJoin).toHaveBeenCalledWith('roles', 'user_roles.role_id', 'roles.id')
    expect(query.where).toHaveBeenCalledWith('roles.deleted_at', 'is', null)
    expect(query.where).toHaveBeenCalledWith('roles.tenant_id', '=', 'tenant-1')
  })

  it('requires live roles and links when resolving feature recipients', async () => {
    const userAclQuery = createQuery([])
    const roleAclQuery = createQuery([{ user_id: 'user-1', features_json: ['documents.view'], is_super_admin: false }])
    const db = {
      selectFrom: jest.fn((table: string) => table === 'user_acls' ? userAclQuery : roleAclQuery),
    }

    await expect(getRecipientUserIdsForFeature(db as never, 'tenant-1', 'documents.view'))
      .resolves.toEqual(['user-1'])

    expect(roleAclQuery.innerJoin).toHaveBeenCalledWith('roles', 'role_acls.role_id', 'roles.id')
    expect(roleAclQuery.where).toHaveBeenCalledWith('role_acls.deleted_at', 'is', null)
    expect(roleAclQuery.where).toHaveBeenCalledWith('user_roles.deleted_at', 'is', null)
    expect(roleAclQuery.where).toHaveBeenCalledWith('roles.deleted_at', 'is', null)
    expect(roleAclQuery.where).toHaveBeenCalledWith('roles.tenant_id', '=', 'tenant-1')
  })
})
