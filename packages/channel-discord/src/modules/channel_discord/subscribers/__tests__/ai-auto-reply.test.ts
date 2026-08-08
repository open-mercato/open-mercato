/**
 * Unit coverage for the AI auto-reply subscriber's own control flow.
 *
 * ⚠️ What these tests do NOT prove (review of #4391, @pkarw 2026-07-30 Major 2):
 * the AI runtime below is a stub, so nothing here says an armed subscriber would
 * actually be allowed to run. It would not: every agent this repository ships is
 * chat-mode and feature-gated, and `runAiAgentObject` is refused by the real
 * agent policy for the `features: []` call this subscriber makes. That gap is
 * why the release de-scopes AI auto-reply (→ open-mercato/open-mercato#4778),
 * which owns the configurable agent identity and the coverage that drives the
 * real policy instead of a stub.
 *
 * The stub is not a shortcut: `@open-mercato/ai-assistant` is a genuinely
 * soft-optional peer — deliberately absent from this package's dependencies and
 * peerDependencies so the module-decoupling contract holds — hence
 * `{ virtual: true }`. A test that imported the real runtime here would break
 * the very decoupling property it is meant to protect.
 *
 * The complementary guarantee — that no product surface can arm this subscriber
 * in the first place — is executable, and lives in `ai-auto-reply.dormancy.test.ts`.
 */
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

describe('channel_discord ai-auto-reply subscriber — gating, driven from a hand-armed channel', () => {
  beforeEach(() => {
    findOne.mockReset()
    aiMod.runAiAgentObject.mockClear()
    aiMod.runAiAgentObject.mockResolvedValue({ mode: 'generate', object: { reply: 'We are open 9-5.' } })
  })

  // Asserts the wiring, NOT a shipped capability: the channel below is armed by
  // hand with state no product surface writes, and the agent call is stubbed.
  it('(easy) routes a stubbed draft through the generic hub compose command', async () => {
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
