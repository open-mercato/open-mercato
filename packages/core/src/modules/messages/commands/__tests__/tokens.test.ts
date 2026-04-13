import { Message, MessageAccessToken, MessageRecipient } from '../../data/entities'
import { hashOpaqueToken } from '@open-mercato/shared/lib/security/token'

const registerCommand = jest.fn()

jest.mock('@open-mercato/shared/lib/commands', () => ({
  registerCommand: (...args: unknown[]) => registerCommand(...args),
}))

describe('messages token commands', () => {
  beforeEach(() => {
    registerCommand.mockClear()
    jest.resetModules()
  })

  it('consumes token by hash and skips plaintext lookup when hash matches', async () => {
    jest.isolateModules(() => {
      require('../tokens')
    })
    const command = registerCommand.mock.calls[0][0]
    const token = 'raw-message-token'
    const tokenHash = hashOpaqueToken(token)
    const accessToken = {
      token: tokenHash,
      tokenHash,
      messageId: 'message-1',
      recipientUserId: 'user-1',
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
      useCount: 0,
    }
    const recipient = {
      messageId: 'message-1',
      recipientUserId: 'user-1',
      status: 'read',
      deletedAt: null,
    }
    const message = {
      id: 'message-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      deletedAt: null,
    }
    const em = {
      fork: jest.fn(() => em),
      findOne: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
        const entityName = (entity as { name?: string }).name
        if (entityName === MessageAccessToken.name && where.tokenHash === tokenHash) return accessToken
        if (entityName === Message.name) return message
        if (entityName === MessageRecipient.name) return recipient
        return null
      }),
      flush: jest.fn(async () => undefined),
    }

    const result = await command.execute({ token }, {
      container: { resolve: () => em },
    })

    expect(result).toEqual({ messageId: 'message-1', recipientUserId: 'user-1' })
    expect((em.findOne.mock.calls[0][0] as { name?: string }).name).toBe(MessageAccessToken.name)
    expect(em.findOne.mock.calls[0][1]).toEqual({ tokenHash })
    expect(em.findOne.mock.calls).not.toEqual(
      expect.arrayContaining([
        [expect.objectContaining({ name: MessageAccessToken.name }), { token }],
      ]),
    )
    expect(accessToken.token).toBe(tokenHash)
    expect(accessToken.tokenHash).toBe(tokenHash)
  })

  it('supports legacy plaintext token rows and upgrades them to hash on consume', async () => {
    jest.isolateModules(() => {
      require('../tokens')
    })
    const command = registerCommand.mock.calls[0][0]
    const token = 'legacy-message-token'
    const tokenHash = hashOpaqueToken(token)
    const accessToken = {
      token,
      tokenHash: null,
      messageId: 'message-1',
      recipientUserId: 'user-1',
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
      useCount: 0,
    }
    const recipient = {
      messageId: 'message-1',
      recipientUserId: 'user-1',
      status: 'read',
      deletedAt: null,
    }
    const message = {
      id: 'message-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      deletedAt: null,
    }
    const em = {
      fork: jest.fn(() => em),
      findOne: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
        const entityName = (entity as { name?: string }).name
        if (entityName === MessageAccessToken.name && where.tokenHash === tokenHash) return null
        if (entityName === MessageAccessToken.name && where.token === token) return accessToken
        if (entityName === Message.name) return message
        if (entityName === MessageRecipient.name) return recipient
        return null
      }),
      flush: jest.fn(async () => undefined),
    }

    const result = await command.execute({ token }, {
      container: { resolve: () => em },
    })

    expect(result).toEqual({ messageId: 'message-1', recipientUserId: 'user-1' })
    expect((em.findOne.mock.calls[0][0] as { name?: string }).name).toBe(MessageAccessToken.name)
    expect(em.findOne.mock.calls[0][1]).toEqual({ tokenHash })
    expect((em.findOne.mock.calls[1][0] as { name?: string }).name).toBe(MessageAccessToken.name)
    expect(em.findOne.mock.calls[1][1]).toEqual({ token })
    expect(accessToken.token).toBe(tokenHash)
    expect(accessToken.tokenHash).toBe(tokenHash)
  })
})
