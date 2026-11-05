/** @jest-environment node */

/**
 * Arming contract for the AI auto-reply settings route (issue #4778).
 *
 * The route already refused an absent AI peer and a non-object-mode agent. Shape
 * is not authorization, though: `runAiAgentObject` → `checkAgentPolicy` also runs
 * the agent's `requiredFeatures` against the principal from
 * `lib/ai-service-principal.ts`, which carries only the provider grant unless the
 * tenant created a channel-bot user with a wider role. An agent that passes the
 * shape check and fails the feature check stored a setting that could only fail
 * later, in a background subscriber where nobody sees it — the channel read
 * "Auto-reply on" and answered nothing, forever.
 *
 * `missingAgentFeatures` is deliberately NOT mocked here: the point of the test
 * is that the route asks the platform's real feature-policy question, wildcard
 * grants included.
 */
const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const channelId = '33333333-3333-4333-8333-333333333333'
const userId = '44444444-4444-4444-8444-444444444444'

const PROVIDER_AGENT = {
  id: 'channel_discord.auto_reply',
  label: 'Discord auto-reply',
  description: '',
  requiredFeatures: ['channel_discord.ai_auto_reply.run'],
}
const FOREIGN_AGENT = {
  id: 'customers.support',
  label: 'Customer support',
  description: '',
  requiredFeatures: ['customers.view', 'customers.manage'],
}

const getAuthFromRequestMock = jest.fn()
const loadDiscordChannelForRequestMock = jest.fn()
const validateRouteMutationGuardMock = jest.fn()
const resolveDiscordAiPrincipalMock = jest.fn()
const listDiscordEligibleAgentsMock = jest.fn()
const commandBusExecuteMock = jest.fn()

const em = { fork: () => em }
const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return em
    if (name === 'commandBus') return { execute: commandBusExecuteMock }
    if (name === 'rbacService') throw new Error('not registered in this test')
    throw new Error(`Unexpected container resolve: ${name}`)
  }),
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => getAuthFromRequestMock(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/core/modules/communication_channels/lib/route-mutation-guard', () => ({
  validateRouteMutationGuard: (...args: unknown[]) => validateRouteMutationGuardMock(...args),
}))

jest.mock('../../../../../lib/channel-access', () => ({
  loadDiscordChannelForRequest: (...args: unknown[]) => loadDiscordChannelForRequestMock(...args),
}))

jest.mock('../../../../../lib/ai-service-principal', () => ({
  resolveDiscordAiPrincipal: (...args: unknown[]) => resolveDiscordAiPrincipalMock(...args),
}))

// Only the registry lookup is stubbed; the feature comparison under test is real.
jest.mock('../../../../../lib/ai-agent-directory', () => {
  const actual = jest.requireActual('../../../../../lib/ai-agent-directory')
  return {
    ...actual,
    listDiscordEligibleAgents: (...args: unknown[]) => listDiscordEligibleAgentsMock(...args),
    findDiscordEligibleAgent: async (agentId: string) => {
      const directory = await listDiscordEligibleAgentsMock()
      if (!directory.available) return null
      return directory.agents.find((agent: { id: string }) => agent.id === agentId) ?? null
    },
  }
})

import { GET, PUT } from '../route'

const channel = {
  id: channelId,
  displayName: 'Discord bot',
  updatedAt: new Date('2026-08-01T00:00:00.000Z'),
  channelState: { aiAutoReplyEnabled: false },
}

function putRequest(body: unknown): Request {
  return new Request(`http://localhost/api/channel_discord/channels/${channelId}/ai-auto-reply`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

function getRequest(): Request {
  return new Request(`http://localhost/api/channel_discord/channels/${channelId}/ai-auto-reply`)
}

const context = { params: { id: channelId } }

beforeEach(() => {
  jest.clearAllMocks()
  getAuthFromRequestMock.mockResolvedValue({ sub: userId, tenantId, orgId: organizationId })
  loadDiscordChannelForRequestMock.mockResolvedValue({
    channel,
    organizationIds: [organizationId],
    rbacOrganizationId: organizationId,
  })
  validateRouteMutationGuardMock.mockResolvedValue({ afterSuccess: jest.fn(async () => {}) })
  listDiscordEligibleAgentsMock.mockResolvedValue({
    available: true,
    agents: [PROVIDER_AGENT, FOREIGN_AGENT],
  })
  // The default tenant: no channel-bot user, so the provider service principal.
  resolveDiscordAiPrincipalMock.mockResolvedValue({
    tenantId,
    organizationId,
    userId,
    features: ['channel_discord.ai_auto_reply.run'],
    isSuperAdmin: false,
    source: 'provider_service_principal',
  })
  commandBusExecuteMock.mockResolvedValue({
    result: {
      status: 'updated',
      channelId,
      aiAutoReplyEnabled: true,
      aiAgentId: PROVIDER_AGENT.id,
      updatedAt: '2026-08-02T00:00:00.000Z',
    },
  })
})

describe('PUT /channel_discord/channels/{id}/ai-auto-reply — arming checks', () => {
  it('refuses an agent whose required features the auto-reply principal lacks', async () => {
    const response = await PUT(
      putRequest({ aiAutoReplyEnabled: true, aiAgentId: FOREIGN_AGENT.id }),
      context,
    )

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.fieldErrors.aiAgentId).toBe('channel_discord.aiAutoReply.errors.agentFeaturesMissing')
    // The operator has to be told WHICH grants are missing; a bare refusal sends
    // them back to the same dead end.
    expect(body.missingFeatures).toEqual(['customers.view', 'customers.manage'])
    // The refusal happens before anything is stored.
    expect(commandBusExecuteMock).not.toHaveBeenCalled()
  })

  it('arms the provider agent under the service principal with no operator setup', async () => {
    const response = await PUT(
      putRequest({ aiAutoReplyEnabled: true, aiAgentId: PROVIDER_AGENT.id }),
      context,
    )

    expect(response.status).toBe(200)
    expect(commandBusExecuteMock).toHaveBeenCalledTimes(1)
  })

  it('arms a foreign agent once the channel-bot user carries its features', async () => {
    resolveDiscordAiPrincipalMock.mockResolvedValue({
      tenantId,
      organizationId,
      userId,
      features: ['channel_discord.ai_auto_reply.run', 'customers.view', 'customers.manage'],
      isSuperAdmin: false,
      source: 'channel_bot_user',
    })
    commandBusExecuteMock.mockResolvedValue({
      result: {
        status: 'updated',
        channelId,
        aiAutoReplyEnabled: true,
        aiAgentId: FOREIGN_AGENT.id,
        updatedAt: '2026-08-02T00:00:00.000Z',
      },
    })

    const response = await PUT(
      putRequest({ aiAutoReplyEnabled: true, aiAgentId: FOREIGN_AGENT.id }),
      context,
    )

    expect(response.status).toBe(200)
  })

  it('accepts a wildcard role grant, as the runtime would', async () => {
    resolveDiscordAiPrincipalMock.mockResolvedValue({
      tenantId,
      organizationId,
      userId,
      features: ['channel_discord.ai_auto_reply.run', 'customers.*'],
      isSuperAdmin: false,
      source: 'channel_bot_user',
    })

    const response = await PUT(
      putRequest({ aiAutoReplyEnabled: true, aiAgentId: FOREIGN_AGENT.id }),
      context,
    )

    expect(response.status).toBe(200)
  })

  it('never resolves a principal for a disarm, which needs no agent at all', async () => {
    commandBusExecuteMock.mockResolvedValue({
      result: {
        status: 'updated',
        channelId,
        aiAutoReplyEnabled: false,
        aiAgentId: null,
        updatedAt: '2026-08-02T00:00:00.000Z',
      },
    })

    const response = await PUT(putRequest({ aiAutoReplyEnabled: false }), context)

    expect(response.status).toBe(200)
    expect(resolveDiscordAiPrincipalMock).not.toHaveBeenCalled()
  })

  it('masks an unauthorized channel before it discloses anything about agents', async () => {
    const notFound = new Response(JSON.stringify({ error: 'Channel not found' }), { status: 404 })
    loadDiscordChannelForRequestMock.mockResolvedValue({ response: notFound })

    const response = await PUT(
      putRequest({ aiAutoReplyEnabled: true, aiAgentId: FOREIGN_AGENT.id }),
      context,
    )

    expect(response.status).toBe(404)
    expect(listDiscordEligibleAgentsMock).not.toHaveBeenCalled()
    expect(resolveDiscordAiPrincipalMock).not.toHaveBeenCalled()
  })

  it('still reports an absent AI peer rather than a feature problem', async () => {
    listDiscordEligibleAgentsMock.mockResolvedValue({ available: false })

    const response = await PUT(
      putRequest({ aiAutoReplyEnabled: true, aiAgentId: PROVIDER_AGENT.id }),
      context,
    )

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.fieldErrors.aiAutoReplyEnabled).toBe('channel_discord.aiAutoReply.errors.aiUnavailable')
  })

  it('still reports a non-object-mode agent as ineligible on shape', async () => {
    listDiscordEligibleAgentsMock.mockResolvedValue({ available: true, agents: [PROVIDER_AGENT] })

    const response = await PUT(
      putRequest({ aiAutoReplyEnabled: true, aiAgentId: 'some.chat.agent' }),
      context,
    )

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.fieldErrors.aiAgentId).toBe('channel_discord.aiAutoReply.errors.agentNotEligible')
  })
})

describe('GET /channel_discord/channels/{id}/ai-auto-reply — picker data', () => {
  it('marks each offered agent with whether the principal could invoke it', async () => {
    const response = await GET(getRequest(), context)

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.agents).toEqual([
      expect.objectContaining({ id: PROVIDER_AGENT.id, invocable: true, missingFeatures: [] }),
      expect.objectContaining({
        id: FOREIGN_AGENT.id,
        invocable: false,
        missingFeatures: ['customers.view', 'customers.manage'],
      }),
    ])
  })

  it('surfaces the failure marker an armed channel is carrying', async () => {
    loadDiscordChannelForRequestMock.mockResolvedValue({
      channel: {
        ...channel,
        channelState: {
          aiAutoReplyEnabled: true,
          aiAgentId: FOREIGN_AGENT.id,
          aiAutoReplyLastError: 'agent customers.support: agent_features_denied',
          aiAutoReplyLastErrorAt: '2026-08-03T10:00:00.000Z',
        },
      },
      organizationIds: [organizationId],
      rbacOrganizationId: organizationId,
    })

    const response = await GET(getRequest(), context)
    const body = await response.json()

    expect(body.aiAutoReplyEnabled).toBe(true)
    expect(body.aiAutoReplyLastError).toBe('agent customers.support: agent_features_denied')
    expect(body.aiAutoReplyLastErrorAt).toBe('2026-08-03T10:00:00.000Z')
  })
})
