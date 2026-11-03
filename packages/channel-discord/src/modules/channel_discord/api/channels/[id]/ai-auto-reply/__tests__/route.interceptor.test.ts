/** @jest-environment node */

/**
 * Command-interceptor HTTP-status coverage for the Discord AI auto-reply route (#5097).
 *
 * This route reached `develop` after the transport rollout branch opened, and it is
 * the first command-bus route in `packages/channel-discord` — a package the core
 * coverage guard does not scan. Its `catch` maps `isCrudHttpError` and rethrows
 * everything else, so without the interceptor branch a deliberate 422 business block
 * would leave the handler as an unhandled error rather than reaching the caller.
 *
 * The two cases mirror the other rethrow-shaped routes (`warranty_claims` portal
 * withdraw, `messages` reply): a rejection carrying a status is answered verbatim,
 * and a statusless one keeps the historical rethrow.
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

const getAuthFromRequestMock = jest.fn()
const loadDiscordChannelForRequestMock = jest.fn()
const validateRouteMutationGuardMock = jest.fn()
const resolveDiscordAiPrincipalMock = jest.fn()
const listDiscordEligibleAgentsMock = jest.fn()
const commandBusExecuteMock = jest.fn()
const afterSuccessMock = jest.fn(async () => {})

const em = { fork: () => em }
const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return em
    if (name === 'commandBus') return { execute: commandBusExecuteMock }
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

import { CommandInterceptorError } from '@open-mercato/shared/lib/commands/errors'
import { PUT } from '../route'

const context = { params: { id: channelId } }

function putRequest(): Request {
  return new Request(`http://localhost/api/channel_discord/channels/${channelId}/ai-auto-reply`, {
    method: 'PUT',
    body: JSON.stringify({ aiAutoReplyEnabled: true, aiAgentId: PROVIDER_AGENT.id }),
  })
}

describe('channel_discord ai-auto-reply route — command interceptor HTTP status', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    getAuthFromRequestMock.mockResolvedValue({ sub: userId, tenantId, orgId: organizationId })
    loadDiscordChannelForRequestMock.mockResolvedValue({
      channel: {
        id: channelId,
        displayName: 'Discord bot',
        updatedAt: new Date('2026-08-01T00:00:00.000Z'),
        channelState: { aiAutoReplyEnabled: false },
      },
      organizationIds: [organizationId],
      rbacOrganizationId: organizationId,
    })
    validateRouteMutationGuardMock.mockResolvedValue({ afterSuccess: afterSuccessMock })
    listDiscordEligibleAgentsMock.mockResolvedValue({ available: true, agents: [PROVIDER_AGENT] })
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

  it('surfaces the status and body of an interceptor rejection that carries one', async () => {
    commandBusExecuteMock.mockRejectedValueOnce(
      new CommandInterceptorError('AI auto-reply is disabled for this tenant', {
        status: 422,
        body: { error: 'AI auto-reply is disabled for this tenant' },
      }),
    )

    const response = await PUT(putRequest(), context)

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({
      error: 'AI auto-reply is disabled for this tenant',
    })
    // The route's success side effect must not run for a blocked mutation.
    expect(afterSuccessMock).not.toHaveBeenCalled()
  })

  it('still rethrows a rejection that carries no status', async () => {
    const rejection = new CommandInterceptorError('Blocked without a status')
    commandBusExecuteMock.mockRejectedValueOnce(rejection)

    await expect(PUT(putRequest(), context)).rejects.toBe(rejection)
  })
})
