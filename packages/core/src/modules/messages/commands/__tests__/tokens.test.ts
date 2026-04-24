import type { EntityManager } from '@mikro-orm/postgresql'
import { hashAuthToken } from '../../../auth/lib/tokenHash'
import { MessageAccessToken, Message, MessageRecipient } from '../../data/entities'

type RegisteredHandler = {
  id: string
  execute: (input: unknown, ctx: unknown) => Promise<unknown>
}

const registeredHandlers: RegisteredHandler[] = []

jest.mock('@open-mercato/shared/lib/commands', () => ({
  registerCommand: (handler: RegisteredHandler) => {
    registeredHandlers.push(handler)
  },
}))

jest.mock('../../events', () => ({
  emitMessagesEvent: jest.fn(async () => {}),
}))

// eslint-disable-next-line @typescript-eslint/no-var-requires
require('../tokens')

const consumeCommand = registeredHandlers.find((h) => h.id === 'messages.token.consume')
if (!consumeCommand) {
  throw new Error('messages.token.consume command was not registered')
}

type TokenRecord = {
  id: string
  messageId: string
  recipientUserId: string
  token: string
  expiresAt: Date
  useCount: number
  usedAt: Date | null
}

function createKyselyChain(updateResult: number) {
  const builder = {
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    executeTakeFirst: jest
      .fn()
      .mockResolvedValue({ numUpdatedRows: BigInt(updateResult) }),
  }
  const db = { updateTable: jest.fn().mockReturnValue(builder) }
  return { builder, db }
}

function buildCtx(tokenRecord: TokenRecord | null, knexUpdateResult = 1) {
  const message = {
    id: tokenRecord?.messageId ?? 'message-1',
    deletedAt: null,
    tenantId: 'tenant-1',
    organizationId: 'org-1',
  }
  const recipient = {
    status: 'unread' as 'unread' | 'read',
    readAt: null as Date | null,
  }
  const { builder, db } = createKyselyChain(knexUpdateResult)

  const em: Partial<EntityManager> & { findOne: jest.Mock; flush: jest.Mock; getKysely: jest.Mock; clear: jest.Mock } = {
    findOne: jest.fn(async (cls: unknown, where: Record<string, unknown>) => {
      if (cls === MessageAccessToken) {
        if (!tokenRecord) return null
        if (where.token === tokenRecord.token) return tokenRecord
        if (where.id === tokenRecord.id) return tokenRecord
        return null
      }
      if (cls === Message) return message
      if (cls === MessageRecipient) return recipient
      return null
    }) as unknown as jest.Mock,
    flush: jest.fn(async () => {}),
    getKysely: jest.fn().mockReturnValue(db),
    clear: jest.fn(),
  }

  const container = {
    resolve: (name: string) => {
      if (name !== 'em') throw new Error(`unexpected DI resolve: ${name}`)
      return { fork: () => em }
    },
  }
  return { ctx: { container }, em, db, builder }
}

describe('messages.token.consume command', () => {
  beforeEach(() => jest.clearAllMocks())

  describe('hashed token lookup', () => {
    it('looks up the access token by HMAC hash of the raw request token', async () => {
      const rawToken = 'raw-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      const stored: TokenRecord = {
        id: 'tok-1',
        messageId: 'message-1',
        recipientUserId: 'user-1',
        token: hashAuthToken(rawToken),
        expiresAt: new Date(Date.now() + 60_000),
        useCount: 0,
        usedAt: null,
      }
      const { ctx, em } = buildCtx(stored)

      const result = await consumeCommand.execute({ token: rawToken }, ctx)

      expect(result).toEqual({ messageId: 'message-1', recipientUserId: 'user-1' })
      expect(em.findOne).toHaveBeenCalledWith(MessageAccessToken, { token: stored.token })
    })

    it('falls back to raw-token lookup for tokens written before hashing rollout', async () => {
      const legacyRawToken = 'legacy-raw-token-3333333333333333333333333333333333333333333333333333'
      const stored: TokenRecord = {
        id: 'tok-1',
        messageId: 'message-1',
        recipientUserId: 'user-1',
        token: legacyRawToken,
        expiresAt: new Date(Date.now() + 60_000),
        useCount: 0,
        usedAt: null,
      }
      const { ctx, em } = buildCtx(stored)

      const result = await consumeCommand.execute({ token: legacyRawToken }, ctx)

      expect(result).toEqual({ messageId: 'message-1', recipientUserId: 'user-1' })
      expect(em.findOne).toHaveBeenNthCalledWith(1, MessageAccessToken, { token: hashAuthToken(legacyRawToken) })
      expect(em.findOne).toHaveBeenNthCalledWith(2, MessageAccessToken, { token: legacyRawToken })
    })

    it('throws when neither hashed nor raw lookup matches', async () => {
      const { ctx } = buildCtx(null)

      await expect(consumeCommand.execute({ token: 'unknown' }, ctx)).rejects.toThrow(
        /Invalid or expired link/,
      )
    })
  })

  describe('atomic token consumption', () => {
    it('performs an atomic conditional UPDATE instead of load-check-increment', async () => {
      const stored: TokenRecord = {
        id: 'tok-1',
        messageId: 'msg-1',
        recipientUserId: 'user-1',
        token: hashAuthToken('valid-token'),
        expiresAt: new Date(Date.now() + 60000),
        useCount: 0,
        usedAt: null,
      }
      const { ctx, db, builder } = buildCtx(stored, 1)

      const result = await consumeCommand.execute({ token: 'valid-token' }, ctx)

      expect(db.updateTable).toHaveBeenCalledWith('message_access_tokens')
      expect(builder.where).toHaveBeenCalledWith('id', '=', 'tok-1')
      expect(builder.where).toHaveBeenCalledWith('use_count', '<', 25)
      expect(builder.where).toHaveBeenCalledWith('expires_at', '>', expect.any(Date))
      expect(builder.set).toHaveBeenCalledWith({
        use_count: expect.anything(),
        used_at: expect.any(Date),
      })
      expect(result).toEqual({ messageId: 'msg-1', recipientUserId: 'user-1' })
    })

    it('throws "This link has expired" when atomic UPDATE fails and token is expired', async () => {
      const stored: TokenRecord = {
        id: 'tok-1',
        messageId: 'msg-1',
        recipientUserId: 'user-1',
        token: hashAuthToken('expired-token'),
        expiresAt: new Date(Date.now() - 60000),
        useCount: 0,
        usedAt: null,
      }
      const { ctx } = buildCtx(stored, 0)

      await expect(consumeCommand.execute({ token: 'expired-token' }, ctx)).rejects.toThrow('This link has expired')
    })

    it('throws "This link can no longer be used" when atomic UPDATE fails due to use count', async () => {
      const stored: TokenRecord = {
        id: 'tok-1',
        messageId: 'msg-1',
        recipientUserId: 'user-1',
        token: hashAuthToken('maxed-token'),
        expiresAt: new Date(Date.now() + 60000),
        useCount: 25,
        usedAt: null,
      }
      const { ctx } = buildCtx(stored, 0)

      await expect(consumeCommand.execute({ token: 'maxed-token' }, ctx)).rejects.toThrow('This link can no longer be used')
    })

    it('rejects concurrent replay — second caller gets 0 affected rows', async () => {
      const stored: TokenRecord = {
        id: 'tok-1',
        messageId: 'msg-1',
        recipientUserId: 'user-1',
        token: hashAuthToken('race-token'),
        expiresAt: new Date(Date.now() + 60000),
        useCount: 24,
        usedAt: null,
      }
      const { ctx } = buildCtx(stored, 0)

      await expect(consumeCommand.execute({ token: 'race-token' }, ctx)).rejects.toThrow('This link can no longer be used')
    })
  })
})
