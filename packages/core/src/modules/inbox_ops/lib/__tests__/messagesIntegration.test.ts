/** @jest-environment node */

import { resolveMessageSenderUserId } from '../messagesIntegration'

const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000'

function createMockKnex(result: { id: string } | null) {
  const chain = {
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    whereNull: jest.fn().mockReturnThis(),
    first: jest.fn().mockResolvedValue(result),
  }
  return jest.fn().mockReturnValue(chain)
}

function createMockEm(knexResult: { id: string } | null = null) {
  return { getKnex: jest.fn().mockReturnValue(createMockKnex(knexResult)) } as any
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

  it('falls back gracefully when knex query throws', async () => {
    const em = {
      getKnex: jest.fn().mockImplementation(() => {
        throw new Error('DB connection failed')
      }),
    } as any

    const result = await resolveMessageSenderUserId(
      em, 'jane@example.com', ['fallback-admin'], scope,
    )

    expect(result).toBe('fallback-admin')
  })

  it('normalizes email to lowercase for lookup', async () => {
    const mockKnex = createMockKnex({ id: 'user-ci' })
    const em = { getKnex: jest.fn().mockReturnValue(mockKnex) } as any

    await resolveMessageSenderUserId(
      em, '  Jane@Example.COM  ', ['admin-1'], scope,
    )

    expect(mockKnex).toHaveBeenCalledWith('users')
    const chain = mockKnex.mock.results[0].value
    expect(chain.where).toHaveBeenCalledWith('email', 'jane@example.com')
  })
})
