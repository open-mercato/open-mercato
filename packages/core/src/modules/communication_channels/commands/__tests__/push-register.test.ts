// Spec C § Phase C5 — push-register orchestration.

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
}))
jest.mock('../../lib/adapter-registry-singleton', () => ({
  getChannelAdapterRegistry: jest.fn(),
}))
jest.mock('../../lib/credential-refresh', () => ({
  refreshCredentialsIfNeeded: jest.fn(),
}))
jest.mock('../../events', () => ({
  emitCommunicationChannelsEvent: jest.fn().mockResolvedValue(undefined),
}))

import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { getChannelAdapterRegistry } from '../../lib/adapter-registry-singleton'
import { refreshCredentialsIfNeeded } from '../../lib/credential-refresh'
import { emitCommunicationChannelsEvent } from '../../events'
import { pushRegister } from '../push-register'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const USER = '33333333-3333-4333-8333-333333333333'
const CHANNEL = '44444444-4444-4444-8444-444444444444'

function buildChannel(overrides: Record<string, unknown> = {}) {
  return {
    id: CHANNEL,
    providerKey: 'gmail',
    isActive: true,
    status: 'connected',
    credentialsRef: 'channel_gmail',
    userId: USER,
    channelState: null,
    pollIntervalSeconds: 60,
    ...overrides,
  }
}

function buildContainer(opts: {
  flushSpy?: jest.Mock
  credResolveSpy?: jest.Mock
} = {}) {
  const flushSpy = opts.flushSpy ?? jest.fn().mockResolvedValue(undefined)
  const em = { fork: jest.fn().mockReturnThis(), flush: flushSpy }
  const credResolveSpy =
    opts.credResolveSpy ?? jest.fn().mockResolvedValue({ accessToken: 'tok' })
  const integrationCredentialsService = { resolve: credResolveSpy, save: jest.fn() }
  const container = {
    resolve: jest.fn((token: string) => {
      if (token === 'em') return em
      if (token === 'integrationCredentialsService') return integrationCredentialsService
      throw new Error(`unexpected resolve: ${token}`)
    }),
  } as unknown as Parameters<typeof pushRegister>[0]['container']
  return { container, flushSpy, credResolveSpy }
}

afterEach(() => {
  jest.clearAllMocks()
})

describe('pushRegister', () => {
  it('throws 404 when channel is missing', async () => {
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue(null)
    const { container } = buildContainer()
    await expect(
      pushRegister({
        container,
        scope: { tenantId: TENANT, organizationId: ORG, userId: USER },
        input: { channelId: CHANNEL },
      }),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('throws 400 when channel is not connected', async () => {
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue(
      buildChannel({ status: 'error' }),
    )
    const { container } = buildContainer()
    await expect(
      pushRegister({
        container,
        scope: { tenantId: TENANT, organizationId: ORG, userId: USER },
        input: { channelId: CHANNEL },
      }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('throws 400 when no adapter is registered for the provider', async () => {
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue(buildChannel())
    ;(getChannelAdapterRegistry as jest.Mock).mockReturnValue({
      get: jest.fn().mockReturnValue(undefined),
    })
    const { container } = buildContainer()
    await expect(
      pushRegister({
        container,
        scope: { tenantId: TENANT, organizationId: ORG, userId: USER },
        input: { channelId: CHANNEL },
      }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('throws 409 when adapter does not implement registerPush', async () => {
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue(buildChannel())
    ;(getChannelAdapterRegistry as jest.Mock).mockReturnValue({
      get: jest.fn().mockReturnValue({ providerKey: 'imap' }),
    })
    const { container } = buildContainer()
    await expect(
      pushRegister({
        container,
        scope: { tenantId: TENANT, organizationId: ORG, userId: USER },
        input: { channelId: CHANNEL },
      }),
    ).rejects.toMatchObject({ status: 409 })
  })

  it('persists Gmail registration result and emits push.registered on active status', async () => {
    process.env.OM_GMAIL_PUBSUB_TOPIC = 'projects/proj/topics/gmail'
    const channel = buildChannel()
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue(channel)
    const registerPushSpy = jest.fn().mockResolvedValue({
      status: 'active',
      channelStatePatch: {
        pushStatus: 'active',
        historyId: '12345',
        watchExpirationMs: 1717000000000,
        pubsubTopic: 'projects/proj/topics/gmail',
      },
      recommendedPollIntervalSeconds: 1800,
    })
    ;(getChannelAdapterRegistry as jest.Mock).mockReturnValue({
      get: jest.fn().mockReturnValue({ providerKey: 'gmail', registerPush: registerPushSpy }),
    })
    ;(refreshCredentialsIfNeeded as jest.Mock).mockResolvedValue({
      refreshed: false,
      credentials: { accessToken: 'tok' },
    })
    const { container, flushSpy } = buildContainer()

    const result = await pushRegister({
      container,
      scope: { tenantId: TENANT, organizationId: ORG, userId: USER },
      input: { channelId: CHANNEL },
    })

    expect(result.pushStatus).toBe('active')
    expect(channel.channelState).toMatchObject({
      pushStatus: 'active',
      historyId: '12345',
      pubsubTopic: 'projects/proj/topics/gmail',
    })
    expect(channel.pollIntervalSeconds).toBe(1800)
    expect(flushSpy).toHaveBeenCalled()
    expect(emitCommunicationChannelsEvent).toHaveBeenCalledWith(
      'communication_channels.push.registered',
      expect.objectContaining({ channelId: CHANNEL, providerKey: 'gmail' }),
      expect.objectContaining({ persistent: true }),
    )
  })

  it('throws 502 + emits push.failed when the adapter throws', async () => {
    const channel = buildChannel()
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue(channel)
    ;(getChannelAdapterRegistry as jest.Mock).mockReturnValue({
      get: jest.fn().mockReturnValue({
        providerKey: 'gmail',
        registerPush: jest.fn().mockRejectedValue(new Error('pubsub topic missing')),
      }),
    })
    ;(refreshCredentialsIfNeeded as jest.Mock).mockResolvedValue({
      refreshed: false,
      credentials: { accessToken: 'tok' },
    })
    const { container } = buildContainer()
    await expect(
      pushRegister({
        container,
        scope: { tenantId: TENANT, organizationId: ORG, userId: USER },
        input: { channelId: CHANNEL },
      }),
    ).rejects.toMatchObject({ status: 502 })
  })

  it('emits push.failed and skips pollIntervalSeconds flip when adapter returns status:failed', async () => {
    const channel = buildChannel({ pollIntervalSeconds: 60 })
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue(channel)
    ;(getChannelAdapterRegistry as jest.Mock).mockReturnValue({
      get: jest.fn().mockReturnValue({
        providerKey: 'gmail',
        registerPush: jest.fn().mockResolvedValue({
          status: 'failed',
          channelStatePatch: {
            pushStatus: 'failed',
            lastPushError: { code: 'pubsub_topic_missing', message: 'topic required' },
          },
          error: { code: 'pubsub_topic_missing', message: 'topic required' },
        }),
      }),
    })
    ;(refreshCredentialsIfNeeded as jest.Mock).mockResolvedValue({
      refreshed: false,
      credentials: { accessToken: 'tok' },
    })
    const { container } = buildContainer()

    const result = await pushRegister({
      container,
      scope: { tenantId: TENANT, organizationId: ORG, userId: USER },
      input: { channelId: CHANNEL },
    })

    expect(result.pushStatus).toBe('failed')
    expect(result.error?.code).toBe('pubsub_topic_missing')
    expect(channel.pollIntervalSeconds).toBe(60)
    expect(emitCommunicationChannelsEvent).toHaveBeenCalledWith(
      'communication_channels.push.failed',
      expect.objectContaining({ channelId: CHANNEL, error: expect.any(Object) }),
      expect.objectContaining({ persistent: true }),
    )
  })
})
