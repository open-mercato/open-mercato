// Spec C § Phase C5 — push-unregister best-effort teardown.

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
}))
jest.mock('../../lib/adapter-registry-singleton', () => ({
  getChannelAdapterRegistry: jest.fn(),
}))
jest.mock('../../lib/credential-refresh', () => ({
  refreshCredentialsIfNeeded: jest.fn().mockResolvedValue({
    refreshed: false,
    credentials: { accessToken: 'tok' },
  }),
}))
jest.mock('../../events', () => ({
  emitCommunicationChannelsEvent: jest.fn().mockResolvedValue(undefined),
}))

import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { getChannelAdapterRegistry } from '../../lib/adapter-registry-singleton'
import { emitCommunicationChannelsEvent } from '../../events'
import { pushUnregister } from '../push-unregister'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const USER = '33333333-3333-4333-8333-333333333333'
const CHANNEL = '44444444-4444-4444-8444-444444444444'

function buildContainer(opts: { flushSpy?: jest.Mock } = {}) {
  const flushSpy = opts.flushSpy ?? jest.fn().mockResolvedValue(undefined)
  const em = { fork: jest.fn().mockReturnThis(), flush: flushSpy }
  const integrationCredentialsService = {
    resolve: jest.fn().mockResolvedValue({ accessToken: 'tok' }),
  }
  const container = {
    resolve: jest.fn((token: string) => {
      if (token === 'em') return em
      if (token === 'integrationCredentialsService') return integrationCredentialsService
      throw new Error(`unexpected resolve: ${token}`)
    }),
  } as unknown as Parameters<typeof pushUnregister>[0]['container']
  return { container, flushSpy }
}

function buildActiveGmailChannel(overrides: Record<string, unknown> = {}) {
  return {
    id: CHANNEL,
    providerKey: 'gmail',
    credentialsRef: 'channel_gmail',
    userId: USER,
    pollIntervalSeconds: 1800,
    channelState: {
      pushStatus: 'active',
      historyId: '12345',
      watchExpirationMs: 1717000000000,
    },
    ...overrides,
  }
}

afterEach(() => {
  jest.clearAllMocks()
})

describe('pushUnregister', () => {
  it('returns noop when the channel row is missing', async () => {
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue(null)
    const { container } = buildContainer()
    const result = await pushUnregister({
      container,
      scope: { tenantId: TENANT, organizationId: ORG, userId: USER },
      input: { channelId: CHANNEL },
    })
    expect(result.status).toBe('noop')
    expect(emitCommunicationChannelsEvent).not.toHaveBeenCalled()
  })

  it('returns noop when the adapter has no unregisterPush method', async () => {
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue(buildActiveGmailChannel())
    ;(getChannelAdapterRegistry as jest.Mock).mockReturnValue({
      get: jest.fn().mockReturnValue({ providerKey: 'imap' }),
    })
    const { container } = buildContainer()
    const result = await pushUnregister({
      container,
      scope: { tenantId: TENANT, organizationId: ORG, userId: USER },
      input: { channelId: CHANNEL },
    })
    expect(result.status).toBe('noop')
  })

  it('returns noop when pushStatus is already inactive', async () => {
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue(
      buildActiveGmailChannel({
        channelState: { pushStatus: 'inactive' },
      }),
    )
    ;(getChannelAdapterRegistry as jest.Mock).mockReturnValue({
      get: jest.fn().mockReturnValue({
        providerKey: 'gmail',
        unregisterPush: jest.fn(),
      }),
    })
    const { container } = buildContainer()
    const result = await pushUnregister({
      container,
      scope: { tenantId: TENANT, organizationId: ORG, userId: USER },
      input: { channelId: CHANNEL },
    })
    expect(result.status).toBe('noop')
  })

  it('on happy path: calls adapter, clears push markers, restores 60s poll, emits deactivated', async () => {
    const channel = buildActiveGmailChannel()
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue(channel)
    const unregisterPushSpy = jest.fn().mockResolvedValue(undefined)
    ;(getChannelAdapterRegistry as jest.Mock).mockReturnValue({
      get: jest.fn().mockReturnValue({
        providerKey: 'gmail',
        unregisterPush: unregisterPushSpy,
      }),
    })
    const { container, flushSpy } = buildContainer()

    const result = await pushUnregister({
      container,
      scope: { tenantId: TENANT, organizationId: ORG, userId: USER },
      input: { channelId: CHANNEL },
    })

    expect(result.status).toBe('unregistered')
    expect(unregisterPushSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: CHANNEL,
        channelState: expect.objectContaining({ historyId: '12345' }),
      }),
    )
    expect(channel.channelState).toMatchObject({
      pushStatus: 'inactive',
      watchExpirationMs: null,
    })
    // Push teardown restores the polling-only default cadence (matches connect's
    // `POLLING_ONLY_DEFAULT_INTERVAL_SECONDS`), not the old hard-coded 60.
    expect(channel.pollIntervalSeconds).toBe(300)
    expect(flushSpy).toHaveBeenCalled()
    expect(emitCommunicationChannelsEvent).toHaveBeenCalledWith(
      'communication_channels.push.deactivated',
      expect.objectContaining({ channelId: CHANNEL, reason: 'unregistered' }),
      expect.objectContaining({ persistent: true }),
    )
  })

  it('returns failed (best-effort) when the adapter throws — does not propagate', async () => {
    const channel = buildActiveGmailChannel()
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue(channel)
    ;(getChannelAdapterRegistry as jest.Mock).mockReturnValue({
      get: jest.fn().mockReturnValue({
        providerKey: 'gmail',
        unregisterPush: jest.fn().mockRejectedValue(new Error('subscription gone')),
      }),
    })
    const { container } = buildContainer()
    const result = await pushUnregister({
      container,
      scope: { tenantId: TENANT, organizationId: ORG, userId: USER },
      input: { channelId: CHANNEL },
    })
    expect(result.status).toBe('failed')
    expect(result.error?.code).toBe('adapter_unregister_failed')
    expect(emitCommunicationChannelsEvent).not.toHaveBeenCalled()
  })
})
