/**
 * What an armed Discord channel does when the agent call keeps being refused.
 *
 * The subscriber degrades to a no-op, and that part is right — a broken model
 * must never become a send. The part that was wrong is that the no-op was
 * *silent*: the settings surface still read "Auto-reply on", the channel answered
 * nothing, and the only trace was a `logger.warn` in a background subscriber. A
 * save-time feature check narrows the window but cannot close it, because a role
 * edited after the channel was armed makes that verdict stale.
 *
 * So the contract here is: every failure leaves a reason on the channel, the next
 * success clears it, and neither the marker write nor its failure can turn a
 * degraded no-op into a thrown handler.
 */
const recordDiscordAutoReplyOutcomeMock = jest.fn(async () => 'written' as const)

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
}))
jest.mock('@open-mercato/core/modules/communication_channels/lib/system-user', () => ({
  COMMUNICATION_CHANNELS_SYSTEM_USER_ID: '00000000-0000-0000-0000-000000000000',
  resolveCommunicationChannelsSystemUserId: jest.fn(async () => 'system-user-id'),
}))
jest.mock('@open-mercato/ai-assistant', () => ({ runAiAgentObject: jest.fn() }), { virtual: true })
jest.mock('../../lib/channel-state-store', () => ({
  recordDiscordAutoReplyOutcome: (...args: unknown[]) => recordDiscordAutoReplyOutcomeMock(...(args as [])),
}))

import handler from '../ai-auto-reply'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CHANNEL_DISCORD_AUTO_REPLY_AGENT_ID } from '../../ai-agents'

const findOne = findOneWithDecryption as unknown as jest.Mock
const aiMod = jest.requireMock('@open-mercato/ai-assistant') as { runAiAgentObject: jest.Mock }

const payload = {
  providerKey: 'discord' as const,
  messageId: 'm-1',
  channelId: 'c-1',
  tenantId: 't-1',
  organizationId: 'o-1',
  direction: 'inbound' as const,
}

function makeCtx() {
  const forked = { findOne: jest.fn(async () => null) }
  const em = { fork: () => forked }
  const commandBus = { execute: jest.fn(async () => ({ result: { id: 'reply-msg', threadId: null } })) }
  const resolve = jest.fn((name: string) => {
    if (name === 'em') return em
    if (name === 'mcpToolRegistry') return {}
    if (name === 'commandBus') return commandBus
    return {}
  })
  return { ctx: { resolve }, commandBus }
}

function channelRow(channelState: Record<string, unknown>) {
  return { id: 'c-1', tenantId: 't-1', organizationId: 'o-1', userId: null, channelState }
}

const armed = { aiAutoReplyEnabled: true, aiAgentId: CHANNEL_DISCORD_AUTO_REPLY_AGENT_ID }

function messageRow() {
  return { id: 'm-1', threadId: 'thread-1', subject: 'Discord', type: 'channel.discord', body: 'Are you open?' }
}

beforeEach(() => {
  jest.clearAllMocks()
  recordDiscordAutoReplyOutcomeMock.mockResolvedValue('written')
})

describe('channel_discord ai-auto-reply — failure visibility', () => {
  it('parks the reason on the channel when the runtime refuses the agent', async () => {
    findOne.mockResolvedValueOnce(channelRow(armed)).mockResolvedValueOnce(messageRow())
    aiMod.runAiAgentObject.mockRejectedValue(new Error('agent_features_denied'))
    const { ctx, commandBus } = makeCtx()

    await expect(handler(payload, ctx)).resolves.toBeUndefined()

    // Still a no-op — nothing was sent and no proposal was filed.
    expect(commandBus.execute).not.toHaveBeenCalled()
    expect(recordDiscordAutoReplyOutcomeMock).toHaveBeenCalledTimes(1)
    const call = recordDiscordAutoReplyOutcomeMock.mock.calls[0][0] as {
      channelId: string
      scope: { tenantId: string; organizationId: string | null }
      failure: string | null
    }
    expect(call.channelId).toBe('c-1')
    expect(call.scope).toEqual({ tenantId: 't-1', organizationId: 'o-1' })
    // The reason names the agent, because "which agent" is the first thing an
    // operator staring at a silent channel needs to know.
    expect(call.failure).toBe(`agent ${CHANNEL_DISCORD_AUTO_REPLY_AGENT_ID}: agent_features_denied`)
  })

  it('clears a stale marker on the next attempt that gets through', async () => {
    findOne
      .mockResolvedValueOnce(channelRow({ ...armed, aiAutoReplyLastError: 'agent x: denied' }))
      .mockResolvedValueOnce(messageRow())
    aiMod.runAiAgentObject.mockResolvedValue({
      mode: 'generate',
      object: { reply: 'We are open 9-5.', summary: 'Hours.', confidence: 0.9, requiresHuman: false },
    })
    const { ctx } = makeCtx()

    await handler(payload, ctx)

    expect(recordDiscordAutoReplyOutcomeMock).toHaveBeenCalledTimes(1)
    expect((recordDiscordAutoReplyOutcomeMock.mock.calls[0][0] as { failure: string | null }).failure).toBeNull()
  })

  it('does not pay a write on a healthy channel that has nothing to clear', async () => {
    findOne.mockResolvedValueOnce(channelRow(armed)).mockResolvedValueOnce(messageRow())
    aiMod.runAiAgentObject.mockResolvedValue({
      mode: 'generate',
      object: { reply: 'We are open 9-5.', summary: 'Hours.', confidence: 0.9, requiresHuman: false },
    })
    const { ctx } = makeCtx()

    await handler(payload, ctx)

    expect(recordDiscordAutoReplyOutcomeMock).not.toHaveBeenCalled()
  })

  it('never lets the marker write itself escalate a no-op into a thrown handler', async () => {
    findOne.mockResolvedValueOnce(channelRow(armed)).mockResolvedValueOnce(messageRow())
    aiMod.runAiAgentObject.mockRejectedValue(new Error('boom'))
    recordDiscordAutoReplyOutcomeMock.mockRejectedValue(new Error('database is down'))
    const { ctx } = makeCtx()

    await expect(handler(payload, ctx)).resolves.toBeUndefined()
  })
})
