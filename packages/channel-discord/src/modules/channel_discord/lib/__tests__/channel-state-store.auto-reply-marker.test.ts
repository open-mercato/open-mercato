/**
 * The persisted "this armed channel produced nothing, and here is why" marker.
 *
 * The auto-reply subscriber degrades every failure to a no-op on purpose — a
 * broken model, a policy denial or a malformed object must never become a send.
 * Being silent about it is the defect: the settings page and the integration
 * panel keep reading "Auto-reply on" while the channel answers nothing, and a
 * `logger.warn` inside a background subscriber is not somewhere an operator
 * looks. These cases pin the write, the clear, and the two properties that keep
 * it from becoming a cost of its own.
 */
const findOneWithDecryptionMock = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...args),
}))

jest.mock('@open-mercato/core/modules/communication_channels/data/entities', () => ({
  CommunicationChannel: class CommunicationChannel {},
}))

import { recordDiscordAutoReplyOutcome } from '../channel-state-store'

const tenantId = '11111111-1111-4111-8111-111111111111'
const channelId = '33333333-3333-4333-8333-333333333333'
const NOW = new Date('2026-08-03T10:00:00.000Z')

const flush = jest.fn(async () => {})
const em = { fork: () => ({ flush }) } as never

function channelWithState(channelState: Record<string, unknown>) {
  return { id: channelId, channelState }
}

const scope = { tenantId, organizationId: null }

beforeEach(() => {
  jest.clearAllMocks()
})

describe('recordDiscordAutoReplyOutcome', () => {
  it('writes the reason and a first-seen stamp onto the channel', async () => {
    const channel = channelWithState({ aiAutoReplyEnabled: true, aiAgentId: 'customers.support' })
    findOneWithDecryptionMock.mockResolvedValue(channel)

    const result = await recordDiscordAutoReplyOutcome({
      em,
      channelId,
      scope,
      failure: 'agent customers.support: agent_features_denied',
      now: NOW,
    })

    expect(result).toBe('written')
    expect(flush).toHaveBeenCalledTimes(1)
    expect(channel.channelState).toEqual({
      aiAutoReplyEnabled: true,
      aiAgentId: 'customers.support',
      aiAutoReplyLastError: 'agent customers.support: agent_features_denied',
      aiAutoReplyLastErrorAt: NOW.toISOString(),
    })
  })

  it('leaves the arming keys exactly as they were', async () => {
    const channel = channelWithState({ aiAutoReplyEnabled: true, aiAgentId: 'agent-7', sessionId: 'sess-1' })
    findOneWithDecryptionMock.mockResolvedValue(channel)

    await recordDiscordAutoReplyOutcome({ em, channelId, scope, failure: 'boom', now: NOW })

    const state = channel.channelState as Record<string, unknown>
    expect(state.aiAutoReplyEnabled).toBe(true)
    expect(state.aiAgentId).toBe('agent-7')
    expect(state.sessionId).toBe('sess-1')
  })

  it('does not rewrite the row while the same failure keeps repeating', async () => {
    // Otherwise a broken channel pays a row update per inbound message — the
    // channels already misbehaving would be the ones generating the write load.
    findOneWithDecryptionMock.mockResolvedValue(
      channelWithState({ aiAutoReplyLastError: 'boom', aiAutoReplyLastErrorAt: '2026-08-01T00:00:00.000Z' }),
    )

    const result = await recordDiscordAutoReplyOutcome({ em, channelId, scope, failure: 'boom', now: NOW })

    expect(result).toBe('unchanged')
    expect(flush).not.toHaveBeenCalled()
  })

  it('replaces the marker when the reason changes', async () => {
    const channel = channelWithState({ aiAutoReplyLastError: 'boom', aiAutoReplyLastErrorAt: '2026-08-01T00:00:00.000Z' })
    findOneWithDecryptionMock.mockResolvedValue(channel)

    const result = await recordDiscordAutoReplyOutcome({ em, channelId, scope, failure: 'different', now: NOW })

    expect(result).toBe('written')
    expect((channel.channelState as Record<string, unknown>).aiAutoReplyLastError).toBe('different')
    expect((channel.channelState as Record<string, unknown>).aiAutoReplyLastErrorAt).toBe(NOW.toISOString())
  })

  it('clears the marker once an attempt succeeds', async () => {
    const channel = channelWithState({
      aiAutoReplyEnabled: true,
      aiAutoReplyLastError: 'boom',
      aiAutoReplyLastErrorAt: '2026-08-01T00:00:00.000Z',
    })
    findOneWithDecryptionMock.mockResolvedValue(channel)

    const result = await recordDiscordAutoReplyOutcome({ em, channelId, scope, failure: null, now: NOW })

    expect(result).toBe('written')
    expect(channel.channelState).toEqual({ aiAutoReplyEnabled: true })
  })

  it('costs nothing to clear a channel that is already healthy', async () => {
    findOneWithDecryptionMock.mockResolvedValue(channelWithState({ aiAutoReplyEnabled: true }))

    const result = await recordDiscordAutoReplyOutcome({ em, channelId, scope, failure: null, now: NOW })

    expect(result).toBe('unchanged')
    expect(flush).not.toHaveBeenCalled()
  })

  it('truncates a runaway reason instead of growing the JSONB column without bound', async () => {
    const channel = channelWithState({})
    findOneWithDecryptionMock.mockResolvedValue(channel)

    await recordDiscordAutoReplyOutcome({ em, channelId, scope, failure: 'x'.repeat(5_000), now: NOW })

    expect((channel.channelState as Record<string, string>).aiAutoReplyLastError).toHaveLength(500)
  })

  it('only ever touches a row inside its own tenant/organization scope', async () => {
    findOneWithDecryptionMock.mockResolvedValue(null)

    const result = await recordDiscordAutoReplyOutcome({ em, channelId, scope, failure: 'boom', now: NOW })

    expect(result).toBe('not_found')
    expect(findOneWithDecryptionMock.mock.calls[0][2]).toEqual({
      id: channelId,
      tenantId,
      organizationId: null,
      deletedAt: null,
    })
  })
})
