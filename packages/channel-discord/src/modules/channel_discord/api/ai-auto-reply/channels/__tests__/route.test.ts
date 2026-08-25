/** @jest-environment node */

/**
 * One-call listing behind the integration detail panel.
 *
 * The panel used to list channels and then ask the per-channel settings route for
 * each one, so a tenant with 40 Discord channels paid 41 requests and 40 agent
 * registry loads to render 40 booleans. This route exists to make that one query,
 * and the properties worth pinning are the two that would make it a regression
 * rather than a fix: it must not build the agent directory, and it must scope the
 * query the way the hub's own channel list does — a Discord bot channel is
 * normally tenant-scoped (`organization_id IS NULL`), so an equality filter on the
 * caller's selected organization would hide exactly the rows the panel is about.
 */
const tenantId = '11111111-1111-4111-8111-111111111111'
const selectedOrgId = '22222222-2222-4222-8222-222222222222'
const userId = '44444444-4444-4444-8444-444444444444'

const getAuthFromRequestMock = jest.fn()
const findWithDecryptionMock = jest.fn()
const listDiscordEligibleAgentsMock = jest.fn()

const em = { fork: () => em }
const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return em
    throw new Error(`Unexpected container resolve: ${name}`)
  }),
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => getAuthFromRequestMock(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(async () => ({ selectedOrganizationId: selectedOrgId })),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScopeFilter', () => ({
  resolveOrganizationScopeFilter: jest.fn(() => ({
    organizationIds: [selectedOrgId],
    rbacOrganizationId: selectedOrgId,
  })),
}))

jest.mock('../../../../lib/ai-agent-directory', () => ({
  listDiscordEligibleAgents: (...args: unknown[]) => listDiscordEligibleAgentsMock(...args),
}))

import { GET, metadata } from '../route'

const armedChannel = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  displayName: 'Support bot',
  channelState: { aiAutoReplyEnabled: true, aiAgentId: 'channel_discord.auto_reply' },
}
const failingChannel = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  displayName: 'Community bot',
  channelState: {
    aiAutoReplyEnabled: true,
    aiAgentId: 'customers.support',
    aiAutoReplyLastError: 'agent customers.support: agent_features_denied',
    aiAutoReplyLastErrorAt: '2026-08-03T10:00:00.000Z',
  },
}
const idleChannel = {
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  displayName: 'Announcements bot',
  channelState: {},
}

function request(): Request {
  return new Request('http://localhost/api/channel_discord/ai-auto-reply/channels')
}

beforeEach(() => {
  jest.clearAllMocks()
  getAuthFromRequestMock.mockResolvedValue({ sub: userId, tenantId, orgId: selectedOrgId })
  findWithDecryptionMock.mockResolvedValue([armedChannel, failingChannel, idleChannel])
})

describe('GET /channel_discord/ai-auto-reply/channels', () => {
  it('pins its own path so the collection cannot be mistaken for a channel id', () => {
    expect(metadata.path).toBe('/channel_discord/ai-auto-reply/channels')
  })

  it('returns every channel’s auto-reply state from a single query', async () => {
    const response = await GET(request())

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(findWithDecryptionMock).toHaveBeenCalledTimes(1)
    expect(body.items).toEqual([
      {
        channelId: armedChannel.id,
        displayName: 'Support bot',
        aiAutoReplyEnabled: true,
        aiAgentId: 'channel_discord.auto_reply',
        aiAutoReplyLastError: null,
        aiAutoReplyLastErrorAt: null,
      },
      {
        channelId: failingChannel.id,
        displayName: 'Community bot',
        aiAutoReplyEnabled: true,
        aiAgentId: 'customers.support',
        aiAutoReplyLastError: 'agent customers.support: agent_features_denied',
        aiAutoReplyLastErrorAt: '2026-08-03T10:00:00.000Z',
      },
      {
        channelId: idleChannel.id,
        displayName: 'Announcements bot',
        aiAutoReplyEnabled: false,
        aiAgentId: null,
        aiAutoReplyLastError: null,
        aiAutoReplyLastErrorAt: null,
      },
    ])
  })

  it('never loads the agent registry — the panel does not render a picker', async () => {
    await GET(request())
    expect(listDiscordEligibleAgentsMock).not.toHaveBeenCalled()
  })

  it('scopes to Discord, to the tenant, and to shared channels, keeping tenant-wide rows visible', async () => {
    await GET(request())

    const where = findWithDecryptionMock.mock.calls[0][2]
    expect(where).toMatchObject({
      tenantId,
      providerKey: 'discord',
      userId: null,
      deletedAt: null,
    })
    // The org clause must admit `organization_id IS NULL`, or the bot channels
    // this panel configures disappear whenever an org is selected (#5012).
    expect(where.$or).toEqual([
      { organizationId: { $in: [selectedOrgId] } },
      { organizationId: null },
    ])
  })

  it('says so when the result was capped rather than silently under-reporting', async () => {
    const many = Array.from({ length: 201 }, (_, index) => ({
      id: `dddddddd-dddd-4ddd-8ddd-${String(index).padStart(12, '0')}`,
      displayName: `Bot ${index}`,
      channelState: {},
    }))
    findWithDecryptionMock.mockResolvedValue(many)

    const body = await (await GET(request())).json()

    expect(body.truncated).toBe(true)
    expect(body.items).toHaveLength(200)
  })

  it('rejects an unauthenticated caller before touching the database', async () => {
    getAuthFromRequestMock.mockResolvedValue(null)

    const response = await GET(request())

    expect(response.status).toBe(401)
    expect(findWithDecryptionMock).not.toHaveBeenCalled()
  })
})
