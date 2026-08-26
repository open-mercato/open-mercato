/**
 * Integration coverage against the REAL AI policy and runtime (issue #4778).
 *
 * The re-review of #4391 named exactly this gap: "the subscriber test passes
 * against a fully mocked, nonexistent `customers.support` agent", so nothing
 * proved the call the subscriber makes would survive `checkAgentPolicy`. It
 * would not have — `features: []` fails the agent's feature gate, and every
 * shipped agent was chat-mode, which fails the object-mode gate.
 *
 * So this spec imports the real `agent-policy` and `agent-runtime`, seeds the
 * real registry with the provider's OWN shipped agent definition (imported from
 * `ai-agents.ts`, not re-declared here), and drives the subscriber through them.
 * The only thing stubbed is the model call itself, through the runtime's own
 * documented `generateObject` escape hatch — which runs AFTER every policy gate,
 * tool resolution, prompt composition and schema resolution the production path
 * runs.
 */
import type { PreparedAiSdkObjectOptions } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-runtime'
import {
  runAiAgentObject,
  type RunAiAgentObjectInput,
} from '@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-runtime'
import { checkAgentPolicy } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-policy'
import {
  resetAgentRegistryForTests,
  seedAgentRegistryForTests,
} from '@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-registry'
import type { AiAgentDefinition } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-agent-definition'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
}))
jest.mock('@open-mercato/core/modules/communication_channels/lib/system-user', () => ({
  COMMUNICATION_CHANNELS_SYSTEM_USER_ID: '00000000-0000-0000-0000-000000000000',
  resolveCommunicationChannelsSystemUserId: jest.fn(async () => 'system-user-id'),
}))

const modelReply = {
  reply: 'We open at 9 and close at 5, Monday to Friday.',
  summary: 'Asked about opening hours.',
  confidence: 0.92,
  requiresHuman: false,
}

/**
 * The peer the subscriber dynamically imports. It delegates to the REAL runtime
 * and only supplies the model, so the policy path under test is production's.
 */
jest.mock(
  '@open-mercato/ai-assistant',
  () => ({
    runAiAgentObject: (input: RunAiAgentObjectInput) =>
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require('@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-runtime').runAiAgentObject({
        ...input,
        generateObject: async (_options: PreparedAiSdkObjectOptions) => ({
          object: modelReply,
          finishReason: 'stop',
        }),
      }),
  }),
  { virtual: true },
)

import handler from '../subscribers/ai-auto-reply'
import { aiAgents, CHANNEL_DISCORD_AUTO_REPLY_AGENT_ID } from '../ai-agents'
import { CHANNEL_DISCORD_AI_AUTO_REPLY_RUN_FEATURE } from '../lib/ai-features'
import { PROVIDER_SERVICE_PRINCIPAL_FEATURES } from '../lib/ai-service-principal'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'

const findOne = findOneWithDecryption as unknown as jest.Mock

const shippedAgent = aiAgents[0] as AiAgentDefinition

/**
 * Stand-in for the shape every agent in the repository had when #4391 shipped:
 * chat-mode and gated on a domain feature. Seeded alongside the provider's agent
 * so the "why the old design could not work" half of the contract is asserted,
 * not just asserted about.
 */
const chatModeDomainAgent: AiAgentDefinition = {
  id: 'customers.support',
  moduleId: 'customers',
  label: 'Support assistant',
  description: 'Chat-mode, feature-gated domain agent.',
  systemPrompt: 'You are a support agent.',
  allowedTools: [],
  requiredFeatures: ['customers.people.view'],
}

function principalAuthContext(features: string[] = [...PROVIDER_SERVICE_PRINCIPAL_FEATURES]) {
  return {
    tenantId: '11111111-1111-4111-8111-111111111111',
    organizationId: '22222222-2222-4222-8222-222222222222',
    userId: 'system-user-id',
    features,
    isSuperAdmin: false,
  }
}

describe('channel_discord auto-reply — the real agent policy', () => {
  beforeEach(() => {
    resetAgentRegistryForTests()
    seedAgentRegistryForTests([shippedAgent, chatModeDomainAgent])
  })

  afterAll(() => {
    resetAgentRegistryForTests()
  })

  it('registers an agent the subscriber can actually invoke in object mode', () => {
    const decision = checkAgentPolicy({
      agentId: CHANNEL_DISCORD_AUTO_REPLY_AGENT_ID,
      authContext: {
        userFeatures: [...PROVIDER_SERVICE_PRINCIPAL_FEATURES],
        isSuperAdmin: false,
      },
      requestedExecutionMode: 'object',
    })

    expect(decision.ok).toBe(true)
  })

  it('still denies the featureless call the de-scoped implementation made', () => {
    const decision = checkAgentPolicy({
      agentId: CHANNEL_DISCORD_AUTO_REPLY_AGENT_ID,
      authContext: { userFeatures: [], isSuperAdmin: false },
      requestedExecutionMode: 'object',
    })

    expect(decision.ok).toBe(false)
    if (!decision.ok) expect(decision.code).toBe('agent_features_denied')
  })

  it('denies a chat-mode domain agent in object mode, which is why a dedicated agent exists', () => {
    const decision = checkAgentPolicy({
      agentId: 'customers.support',
      authContext: { userFeatures: ['customers.people.view'], isSuperAdmin: false },
      requestedExecutionMode: 'object',
    })

    expect(decision.ok).toBe(false)
    if (!decision.ok) expect(decision.code).toBe('execution_mode_not_supported')
  })

  it('gates the provider agent on a feature the service principal actually carries', () => {
    expect(shippedAgent.requiredFeatures).toEqual([CHANNEL_DISCORD_AI_AUTO_REPLY_RUN_FEATURE])
    expect(PROVIDER_SERVICE_PRINCIPAL_FEATURES).toContain(CHANNEL_DISCORD_AI_AUTO_REPLY_RUN_FEATURE)
  })
})

describe('channel_discord auto-reply — the real agent runtime', () => {
  const previousOpenAiKey = process.env.OPENAI_API_KEY

  beforeAll(() => {
    // The runtime resolves a model before it hands control to the escape hatch,
    // and the factory fails closed with `no_provider_configured` when nothing is
    // set. No request is made — the stub below replaces the SDK call entirely.
    process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? 'test-key-not-used'
  })

  afterAll(() => {
    if (previousOpenAiKey === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = previousOpenAiKey
    resetAgentRegistryForTests()
  })

  beforeEach(() => {
    resetAgentRegistryForTests()
    seedAgentRegistryForTests([shippedAgent, chatModeDomainAgent])
  })

  it('runs the shipped agent end to end and validates against its declared schema', async () => {
    const result = await runAiAgentObject({
      agentId: CHANNEL_DISCORD_AUTO_REPLY_AGENT_ID,
      input: 'What are your opening hours?',
      authContext: principalAuthContext(),
      generateObject: async () => ({ object: modelReply, finishReason: 'stop' }) as never,
    })

    expect(result.mode).toBe('generate')
    if (result.mode === 'generate') {
      expect(result.object).toEqual(modelReply)
    }
  })

  it('refuses the run when the caller carries no features', async () => {
    await expect(
      runAiAgentObject({
        agentId: CHANNEL_DISCORD_AUTO_REPLY_AGENT_ID,
        input: 'What are your opening hours?',
        authContext: principalAuthContext([]),
        generateObject: async () => ({ object: modelReply, finishReason: 'stop' }) as never,
      }),
    ).rejects.toThrow(/requires features/i)
  })
})

describe('channel_discord auto-reply — the subscriber against the real runtime', () => {
  const previousOpenAiKey = process.env.OPENAI_API_KEY

  beforeAll(() => {
    process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? 'test-key-not-used'
  })

  afterAll(() => {
    if (previousOpenAiKey === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = previousOpenAiKey
    resetAgentRegistryForTests()
  })

  beforeEach(() => {
    resetAgentRegistryForTests()
    seedAgentRegistryForTests([shippedAgent, chatModeDomainAgent])
    findOne.mockReset()
  })

  function makeCtx() {
    const forked = { findOne: jest.fn(async () => null) }
    const em = { fork: () => forked }
    const commandBus = { execute: jest.fn(async () => ({ result: { id: 'reply-msg', threadId: null } })) }
    const resolve = jest.fn((name: string) => {
      if (name === 'em') return em
      if (name === 'mcpToolRegistry') return {}
      if (name === 'commandBus') return commandBus
      throw new Error(`no binding for ${name}`)
    })
    return { ctx: { resolve }, commandBus }
  }

  const payload = {
    providerKey: 'discord' as const,
    messageId: 'm-1',
    channelId: 'c-1',
    tenantId: '11111111-1111-4111-8111-111111111111',
    organizationId: '22222222-2222-4222-8222-222222222222',
    direction: 'inbound' as const,
  }

  it('answers an easy message after passing the real policy gate', async () => {
    findOne
      .mockResolvedValueOnce({
        id: 'c-1',
        userId: null,
        channelState: { aiAutoReplyEnabled: true, aiAgentId: CHANNEL_DISCORD_AUTO_REPLY_AGENT_ID },
      })
      .mockResolvedValueOnce({
        id: 'm-1',
        threadId: 'thread-1',
        subject: 'Discord',
        type: 'channel.discord',
        body: 'What are your opening hours?',
      })
    const { ctx, commandBus } = makeCtx()

    await handler(payload, ctx)

    expect(commandBus.execute).toHaveBeenCalledTimes(1)
    const [commandId, args] = commandBus.execute.mock.calls[0]
    expect(commandId).toBe('messages.messages.compose')
    expect(args.input.body).toBe(modelReply.reply)
    expect(args.input.visibility).toBe('public')
  })

  it('no-ops when the configured agent is one the real policy refuses', async () => {
    findOne
      .mockResolvedValueOnce({
        id: 'c-1',
        userId: null,
        // A chat-mode, domain-gated agent: the exact configuration the old
        // implementation assumed would work.
        channelState: { aiAutoReplyEnabled: true, aiAgentId: 'customers.support' },
      })
      .mockResolvedValueOnce({
        id: 'm-1',
        threadId: 'thread-1',
        subject: 'Discord',
        type: 'channel.discord',
        body: 'What are your opening hours?',
      })
    const { ctx, commandBus } = makeCtx()

    await expect(handler(payload, ctx)).resolves.toBeUndefined()
    expect(commandBus.execute).not.toHaveBeenCalled()
  })
})
