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

// Import after mocks so registerCommand resolves to the mock above.
// eslint-disable-next-line @typescript-eslint/no-var-requires
require('../tokens')

const consumeCommand = registeredHandlers.find((h) => h.id === 'messages.tokens.consume')
if (!consumeCommand) {
  throw new Error('messages.tokens.consume command was not registered')
}

type TokenRecord = {
  messageId: string
  recipientUserId: string
  token: string
  expiresAt: Date
  useCount: number
  usedAt: Date | null
}

function buildCtx(tokenRecord: TokenRecord | null) {
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

  const em: Partial<EntityManager> & { findOne: jest.Mock; flush: jest.Mock } = {
    findOne: jest.fn(async (cls: unknown, where: Record<string, unknown>) => {
      if (cls === MessageAccessToken) {
        if (!tokenRecord) return null
        if (where.token === tokenRecord.token) return tokenRecord
        return null
      }
      if (cls === Message) {
        return message
      }
      if (cls === MessageRecipient) {
        return recipient
      }
      return null
    }) as unknown as jest.Mock,
    flush: jest.fn(async () => {}),
  }

  const container = {
    resolve: (name: string) => {
      if (name !== 'em') throw new Error(`unexpected DI resolve: ${name}`)
      return { fork: () => em }
    },
  }
  return { ctx: { container }, em, tokenRecord }
}

describe('messages.tokens.consume command', () => {
  beforeEach(() => jest.clearAllMocks())

  it('looks up the access token by HMAC hash of the raw request token', async () => {
    const rawToken = 'raw-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const stored: TokenRecord = {
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
