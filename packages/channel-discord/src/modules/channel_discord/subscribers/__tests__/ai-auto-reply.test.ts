/**
 * Unit coverage for the AI auto-reply subscriber's control flow (issue #4778).
 *
 * The AI runtime is stubbed here on purpose: `@open-mercato/ai-assistant` is a
 * soft-optional peer, so a unit test that imported the real runtime would couple
 * this package to it and break the decoupling property the subscriber exists to
 * respect. What the stub cannot prove — that the REAL agent policy accepts the
 * call the subscriber makes — is proven separately, against the real
 * `agent-policy` / `agent-runtime`, in
 * `packages/channel-discord/src/modules/channel_discord/__tests__/ai-auto-reply.policy.integration.test.ts`.
 *
 * The three tiers this file pins down:
 *   - easy + the model is confident and asks for no human → auto-send;
 *   - anything else → a proposal a human approves, never a send;
 *   - peer absent / channel not armed / malformed output → clean no-op.
 */
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
}))
jest.mock('@open-mercato/core/modules/communication_channels/lib/system-user', () => ({
  COMMUNICATION_CHANNELS_SYSTEM_USER_ID: '00000000-0000-0000-0000-000000000000',
  resolveCommunicationChannelsSystemUserId: jest.fn(async () => 'system-user-id'),
}))
jest.mock('@open-mercato/ai-assistant', () => ({ runAiAgentObject: jest.fn() }), { virtual: true })

import handler from '../ai-auto-reply'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { composeMessageSchema } from '@open-mercato/core/modules/messages/data/validators'
import { listNonEmailSenderChannelTypes } from '@open-mercato/core/modules/messages/lib/channel-sender-identity'
import { CHANNEL_DISCORD_AUTO_REPLY_AGENT_ID } from '../../ai-agents'
import { DISCORD_CHANNEL_TYPE } from '../../lib/channel-identity'
import { CHANNEL_DISCORD_AI_PROPOSAL_MESSAGE_TYPE } from '../../message-types'

const findOne = findOneWithDecryption as unknown as jest.Mock
const aiMod = jest.requireMock('@open-mercato/ai-assistant') as { runAiAgentObject: jest.Mock }

type ResolveMap = {
  commandBus?: { execute: jest.Mock }
  aiPresent?: boolean
  threadAssignee?: string | null
}

function makeCtx(map: ResolveMap) {
  const forked = {
    findOne: jest.fn(async () =>
      map.threadAssignee ? { assignedUserId: map.threadAssignee } : null,
    ),
  }
  const em = { fork: () => forked }
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
  return { ctx: { resolve }, commandBus, resolve, forked }
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
    userId: null,
    channelState: { aiAutoReplyEnabled: true, aiAgentId: CHANNEL_DISCORD_AUTO_REPLY_AGENT_ID },
    ...overrides,
  }
}

function messageRow(body: string) {
  return { id: 'm-1', threadId: 'thread-1', subject: 'Discord', type: 'channel.discord', body }
}

function agentOutput(overrides: Record<string, unknown> = {}) {
  return {
    mode: 'generate',
    object: {
      reply: 'We are open 9-5.',
      summary: 'Asks about opening hours.',
      confidence: 0.9,
      requiresHuman: false,
      ...overrides,
    },
  }
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

describe('channel_discord ai-auto-reply subscriber — routing', () => {
  beforeEach(() => {
    findOne.mockReset()
    aiMod.runAiAgentObject.mockReset()
    aiMod.runAiAgentObject.mockResolvedValue(agentOutput())
  })

  it('(easy, confident) sends through the generic hub compose command', async () => {
    findOne.mockResolvedValueOnce(channelRow()).mockResolvedValueOnce(messageRow('What are your opening hours?'))
    const { ctx, commandBus } = makeCtx({ aiPresent: true })

    await handler(basePayload, ctx)

    expect(aiMod.runAiAgentObject).toHaveBeenCalledTimes(1)
    expect(commandBus.execute).toHaveBeenCalledTimes(1)
    const [commandId, args] = commandBus.execute.mock.calls[0]
    expect(commandId).toBe('messages.messages.compose')
    expect(args.input.body).toContain('We are open 9-5.')
    expect(args.input.parentMessageId).toBe('thread-1')
    expect(args.input.visibility).toBe('public')
    expect(args.input.isDraft).toBe(false)
  })

  /**
   * #5601. Every test above asserted the subscriber's *decision* to send and
   * stopped at the command-bus boundary, so all of them stayed green while no
   * automatic reply was ever delivered: the composed payload named no channel
   * type, `channelTypeRequiresExternalEmail` fails closed on an absent one, and
   * the hub demanded an address a Discord sender does not have.
   *
   * The payload is therefore checked against the hub's REAL `composeMessageSchema`
   * rather than against a hand-written expectation — the same validator the
   * command runs, so this fails for the reason production failed.
   */
  it('composes a payload the hub’s own validator accepts, with no address anywhere', async () => {
    const threadId = '5a1c6f4e-0f2a-4d0b-9d31-6a2c6f2b9f01'
    findOne
      .mockResolvedValueOnce(channelRow())
      .mockResolvedValueOnce({ ...messageRow('What are your opening hours?'), threadId })
    const { ctx, commandBus } = makeCtx({ aiPresent: true })

    await handler(basePayload, ctx)

    const [, args] = commandBus.execute.mock.calls[0]
    expect(args.input.sourceChannelType).toBe('discord')
    expect(args.input.externalEmail).toBeUndefined()

    const parsed = composeMessageSchema.safeParse(args.input)
    expect(
      parsed.success ? [] : parsed.error.issues.map((issue) => issue.path.join('.')),
    ).toEqual([])
  })

  /**
   * The waiver is the hub's to grant, not the caller's: `'discord'` has to be a
   * type `NON_EMAIL_SENDER_CHANNEL_TYPES` positively recognizes. Asserting the
   * literal alone would still pass if that list ever dropped the entry.
   */
  it('names a channel type the hub actually recognizes as address-free', () => {
    expect(listNonEmailSenderChannelTypes()).toContain(DISCORD_CHANNEL_TYPE)
  })

  it('runs the agent under a real service principal, never features: [] and never super-admin', async () => {
    findOne.mockResolvedValueOnce(channelRow()).mockResolvedValueOnce(messageRow('What are your opening hours?'))
    const { ctx } = makeCtx({ aiPresent: true })

    await handler(basePayload, ctx)

    const [call] = aiMod.runAiAgentObject.mock.calls
    expect(call[0].agentId).toBe(CHANNEL_DISCORD_AUTO_REPLY_AGENT_ID)
    expect(call[0].authContext.features).toContain('channel_discord.ai_auto_reply.run')
    expect(call[0].authContext.features.length).toBeGreaterThan(0)
    expect(call[0].authContext.isSuperAdmin).toBe(false)
    expect(call[0].authContext.tenantId).toBe('t-1')
    expect(call[0].authContext.organizationId).toBe('o-1')
  })

  it('(complex) drafts a proposal for a human and NEVER auto-sends', async () => {
    findOne
      .mockResolvedValueOnce(channelRow())
      .mockResolvedValueOnce(messageRow('I want a refund on my order'))
      .mockResolvedValueOnce(channelRow())
    const { ctx, commandBus } = makeCtx({ aiPresent: true, threadAssignee: 'agent-user-1' })

    await handler(basePayload, ctx)

    // The agent still runs — the proposal has to contain a drafted reply.
    expect(aiMod.runAiAgentObject).toHaveBeenCalledTimes(1)
    expect(commandBus.execute).toHaveBeenCalledTimes(1)
    const [, args] = commandBus.execute.mock.calls[0]
    expect(args.input.type).toBe(CHANNEL_DISCORD_AI_PROPOSAL_MESSAGE_TYPE)
    expect(args.input.visibility).toBe('internal')
    expect(args.input.recipients).toEqual([{ userId: 'agent-user-1', type: 'to' }])
    expect(args.input.sourceEntityId).toBe('m-1')
    expect(args.input.body).toContain('We are open 9-5.')
  })

  it('(complex, nobody assigned) stores the proposal as a draft rather than losing it', async () => {
    findOne
      .mockResolvedValueOnce(channelRow())
      .mockResolvedValueOnce(messageRow('I want a refund on my order'))
      .mockResolvedValueOnce(channelRow())
    const { ctx, commandBus } = makeCtx({ aiPresent: true, threadAssignee: null })

    await handler(basePayload, ctx)

    const [, args] = commandBus.execute.mock.calls[0]
    expect(args.input.isDraft).toBe(true)
    expect(args.input.recipients).toEqual([])
    expect(args.input.visibility).toBe('internal')
  })

  it('(easy, model asks for a human) proposes instead of sending', async () => {
    aiMod.runAiAgentObject.mockResolvedValue(agentOutput({ requiresHuman: true }))
    findOne
      .mockResolvedValueOnce(channelRow())
      .mockResolvedValueOnce(messageRow('What are your opening hours?'))
      .mockResolvedValueOnce(channelRow())
    const { ctx, commandBus } = makeCtx({ aiPresent: true, threadAssignee: 'agent-user-1' })

    await handler(basePayload, ctx)

    const [, args] = commandBus.execute.mock.calls[0]
    expect(args.input.type).toBe(CHANNEL_DISCORD_AI_PROPOSAL_MESSAGE_TYPE)
  })

  it('(easy, low confidence) proposes instead of sending', async () => {
    aiMod.runAiAgentObject.mockResolvedValue(agentOutput({ confidence: 0.4 }))
    findOne
      .mockResolvedValueOnce(channelRow())
      .mockResolvedValueOnce(messageRow('What are your opening hours?'))
      .mockResolvedValueOnce(channelRow())
    const { ctx, commandBus } = makeCtx({ aiPresent: true, threadAssignee: 'agent-user-1' })

    await handler(basePayload, ctx)

    const [, args] = commandBus.execute.mock.calls[0]
    expect(args.input.type).toBe(CHANNEL_DISCORD_AI_PROPOSAL_MESSAGE_TYPE)
  })

  it('(malformed agent output) degrades to a no-op instead of sending something unvalidated', async () => {
    aiMod.runAiAgentObject.mockResolvedValue({ mode: 'generate', object: { reply: 'hi' } })
    findOne.mockResolvedValueOnce(channelRow()).mockResolvedValueOnce(messageRow('What are your opening hours?'))
    const { ctx, commandBus } = makeCtx({ aiPresent: true })

    await expect(handler(basePayload, ctx)).resolves.toBeUndefined()
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
