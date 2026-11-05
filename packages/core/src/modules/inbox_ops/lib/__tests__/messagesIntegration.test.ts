/** @jest-environment node */

import { resolveMessageSenderUserId } from '../messagesIntegration'

const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000'

function createMockKysely(result: { id: string } | null) {
  const chain: any = {}
  chain.select = jest.fn().mockReturnValue(chain)
  chain.where = jest.fn().mockReturnValue(chain)
  chain.executeTakeFirst = jest.fn().mockResolvedValue(result)
  return {
    selectFrom: jest.fn().mockReturnValue(chain),
    _chain: chain,
  }
}

function createMockEm(result: { id: string } | null = null) {
  const db = createMockKysely(result)
  return { getKysely: jest.fn().mockReturnValue(db), _db: db } as any
}

const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }

describe('resolveMessageSenderUserId', () => {
  it('returns user ID when email matches a user in the database', async () => {
    const em = createMockEm({ id: 'user-found' })

    const result = await resolveMessageSenderUserId(
      em, 'jane@example.com', ['admin-1'], scope,
    )

    expect(result).toBe('user-found')
  })

  it('falls back to first recipient when email lookup finds no match', async () => {
    const em = createMockEm(null)

    const result = await resolveMessageSenderUserId(
      em, 'unknown@example.com', ['admin-1', 'admin-2'], scope,
    )

    expect(result).toBe('admin-1')
  })

  it('returns SYSTEM_USER_ID when no email match and no recipients', async () => {
    const em = createMockEm(null)

    const result = await resolveMessageSenderUserId(
      em, 'nobody@example.com', [], scope,
    )

    expect(result).toBe(SYSTEM_USER_ID)
  })

  it('falls back gracefully when the db query throws', async () => {
    const em = {
      getKysely: jest.fn().mockImplementation(() => {
        throw new Error('DB connection failed')
      }),
    } as any

    const result = await resolveMessageSenderUserId(
      em, 'jane@example.com', ['fallback-admin'], scope,
    )

    expect(result).toBe('fallback-admin')
  })

  it('normalizes email to lowercase for lookup', async () => {
    const em = createMockEm({ id: 'user-ci' })

    await resolveMessageSenderUserId(
      em, '  Jane@Example.COM  ', ['admin-1'], scope,
    )

    expect((em as any)._db.selectFrom).toHaveBeenCalledWith('users')
    expect((em as any)._db._chain.where).toHaveBeenCalledWith('email', '=', 'jane@example.com')
  })
})
