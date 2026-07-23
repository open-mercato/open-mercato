jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
}))
jest.mock('@open-mercato/core/modules/communication_channels/lib/system-user', () => ({
  resolveCommunicationChannelsSystemUserId: jest.fn(async () => 'system-user-id'),
}))
jest.mock(
  '@open-mercato/ai-assistant',
  () => ({ runAiAgentObject: jest.fn(async () => ({ mode: 'generate', object: { reply: 'We are open 9-5.' } })) }),
  { virtual: true },
)

import handler from '../ai-auto-reply'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'

const findOne = findOneWithDecryption as unknown as jest.Mock
const aiMod = jest.requireMock('@open-mercato/ai-assistant') as { runAiAgentObject: jest.Mock }

type ResolveMap = {
  commandBus?: { execute: jest.Mock }
  aiPresent?: boolean
}

function makeCtx(map: ResolveMap) {
  const em = { fork: () => ({}) }
  const commandBus =
    map.commandBus ?? { execute: jest.fn(async () => ({ result: { id: 'reply-msg', threadId: null } })) }
  const resolve = jest.fn((name: string) => {
    if (name === 'em') return em
    if (name === 'mcpToolRegistry') {
      if (map.aiPresent === false) throw new Error('ai_assistant not registered')
      return {}
    }
    if (name === 'commandBus') return commandBus
    return {}
  })
  return { ctx: { resolve }, commandBus, resolve }
}

const basePayload = {
  providerKey: 'discord' as const,
  messageId: 'm-1',
  channelId: 'c-1',
  tenantId: 't-1',
  organizationId: 'o-1',
  direction: 'inbound' as const,
}

function channelRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c-1',
    tenantId: 't-1',
    organizationId: 'o-1',
    channelState: { aiAutoReplyEnabled: true, aiAgentId: 'customers.support' },
    ...overrides,
  }
}

function messageRow(body: string) {
  return { id: 'm-1', threadId: 'thread-1', subject: 'Discord', body }
}

describe('channel_discord ai-auto-reply subscriber — cheap early returns', () => {
  it('no-ops for a non-discord provider without touching the container', async () => {
    const resolve = jest.fn(() => {
      throw new Error('resolver should not be called')
    })
    await expect(
      handler({ providerKey: 'gmail', messageId: 'm', channelId: 'c', tenantId: 't', direction: 'inbound' }, { resolve }),
    ).resolves.toBeUndefined()
    expect(resolve).not.toHaveBeenCalled()
  })

  it('no-ops for an outbound message', async () => {
    const resolve = jest.fn(() => {
      throw new Error('resolver should not be called')
    })
    await expect(
      handler(
        { providerKey: 'discord', messageId: 'm', channelId: 'c', tenantId: 't', direction: 'outbound' },
        { resolve },
      ),
    ).resolves.toBeUndefined()
    expect(resolve).not.toHaveBeenCalled()
  })

  it('no-ops when required payload fields are missing', async () => {
    const resolve = jest.fn(() => {
      throw new Error('resolver should not be called')
    })
    await expect(handler({ providerKey: 'discord', direction: 'inbound' }, { resolve })).resolves.toBeUndefined()
    expect(resolve).not.toHaveBeenCalled()
  })
})

describe('channel_discord ai-auto-reply subscriber — end-to-end gating', () => {
  beforeEach(() => {
    findOne.mockReset()
    aiMod.runAiAgentObject.mockClear()
    aiMod.runAiAgentObject.mockResolvedValue({ mode: 'generate', object: { reply: 'We are open 9-5.' } })
  })

  it('(easy) drafts and sends via the generic hub compose command', async () => {
    findOne.mockResolvedValueOnce(channelRow()).mockResolvedValueOnce(messageRow('What are your opening hours?'))
    const { ctx, commandBus } = makeCtx({ aiPresent: true })

    await handler(basePayload, ctx)

    expect(aiMod.runAiAgentObject).toHaveBeenCalledTimes(1)
    expect(commandBus.execute).toHaveBeenCalledTimes(1)
    const [commandId, args] = commandBus.execute.mock.calls[0]
    expect(commandId).toBe('messages.messages.compose')
    expect(args.input.body).toContain('We are open 9-5.')
    expect(args.input.parentMessageId).toBe('thread-1')
  })

  it('(complex) is propose-only — NEVER auto-sends', async () => {
    findOne.mockResolvedValueOnce(channelRow()).mockResolvedValueOnce(messageRow('I want a refund on my order'))
    const { ctx, commandBus } = makeCtx({ aiPresent: true })

    await handler(basePayload, ctx)

    expect(aiMod.runAiAgentObject).not.toHaveBeenCalled()
    expect(commandBus.execute).not.toHaveBeenCalled()
  })

  it('(no ai_assistant) is a clean no-op — no message load, no send', async () => {
    findOne.mockResolvedValueOnce(channelRow())
    const { ctx, commandBus } = makeCtx({ aiPresent: false })

    await expect(handler(basePayload, ctx)).resolves.toBeUndefined()

    expect(findOne).toHaveBeenCalledTimes(1) // channel only; message never fetched
    expect(aiMod.runAiAgentObject).not.toHaveBeenCalled()
    expect(commandBus.execute).not.toHaveBeenCalled()
  })

  it('(disabled) no-ops when per-channel auto-reply is OFF (default)', async () => {
    findOne.mockResolvedValueOnce(channelRow({ channelState: {} }))
    const { ctx, commandBus } = makeCtx({ aiPresent: true })

    await handler(basePayload, ctx)

    expect(findOne).toHaveBeenCalledTimes(1)
    expect(commandBus.execute).not.toHaveBeenCalled()
  })

  it('loads the channel scoped by tenant + organization', async () => {
    findOne.mockResolvedValueOnce(channelRow()).mockResolvedValueOnce(messageRow('hi there'))
    const { ctx } = makeCtx({ aiPresent: true })

    await handler(basePayload, ctx)

    const [, entityArg, where, , dscope] = findOne.mock.calls[0]
    expect(entityArg).toBeDefined()
    expect(where).toMatchObject({ id: 'c-1', tenantId: 't-1', organizationId: 'o-1', deletedAt: null })
    expect(dscope).toEqual({ tenantId: 't-1', organizationId: 'o-1' })
  })
})
