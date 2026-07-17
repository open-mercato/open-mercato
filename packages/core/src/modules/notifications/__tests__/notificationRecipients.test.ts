import { getScopedNotificationRecipientUserIds } from '../lib/notificationRecipients'

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
})
