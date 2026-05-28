// Spec C § Phase C4 — microsoft-renew-subscriptions cron worker.
//
// Mirrors gmail-renew-watch.test.ts: scope filtering + lead-time threshold +
// pushStatus filter + failed-status path (no event) + happy-path event.

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(),
}))
jest.mock('../../commands/push-renew', () => ({
  pushRenew: jest.fn(),
}))
jest.mock('../../events', () => ({
  emitCommunicationChannelsEvent: jest.fn().mockResolvedValue(undefined),
}))

import type { JobContext, QueuedJob } from '@open-mercato/queue'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { pushRenew } from '../../commands/push-renew'
import { emitCommunicationChannelsEvent } from '../../events'
import handle, {
  type MicrosoftRenewSubscriptionsPayload,
} from '../microsoft-renew-subscriptions'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'

function buildJob(
  scope: MicrosoftRenewSubscriptionsPayload['scope'],
): QueuedJob<MicrosoftRenewSubscriptionsPayload> {
  return {
    id: 'job-1',
    queue: 'communication-channels-microsoft-renew-subscriptions',
    payload: { scope },
    enqueuedAt: new Date(),
    attempts: 1,
  } as unknown as QueuedJob<MicrosoftRenewSubscriptionsPayload>
}

function buildCtx(): JobContext & { resolve: <T>(name: string) => T } {
  const em = { fork: jest.fn().mockReturnThis() }
  return {
    resolve: jest.fn((token: string) => {
      if (token === 'em') return em
      throw new Error(`unexpected resolve: ${token}`)
    }),
  } as unknown as JobContext & { resolve: <T>(name: string) => T }
}

function buildChannel(overrides: Record<string, unknown>) {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    providerKey: 'microsoft',
    tenantId: TENANT,
    organizationId: ORG,
    userId: 'user-x',
    isActive: true,
    deletedAt: null,
    channelState: {
      pushStatus: 'active',
      subscriptionId: 'sub-abc',
      subscriptionExpiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
    },
    ...overrides,
  }
}

afterEach(() => {
  jest.clearAllMocks()
  delete process.env.OM_PUSH_RENEWAL_MICROSOFT_LEAD_HOURS
})

describe('microsoft-renew-subscriptions worker', () => {
  it('filters em.find by scope.tenantId + scope.organizationId from job payload', async () => {
    ;(findWithDecryption as jest.Mock).mockResolvedValue([])
    await handle(buildJob({ tenantId: TENANT, organizationId: ORG }), buildCtx())
    const [, , where, , scope] = (findWithDecryption as jest.Mock).mock.calls[0]
    expect(where).toMatchObject({
      providerKey: 'microsoft',
      tenantId: TENANT,
      organizationId: ORG,
    })
    expect(scope).toEqual({ tenantId: TENANT, organizationId: ORG })
  })

  it('renews subscriptions within the lead window and emits push.renewed', async () => {
    const nearExpiry = new Date(Date.now() + 1 * 60 * 60 * 1000).toISOString() // 1h
    ;(findWithDecryption as jest.Mock).mockResolvedValue([
      buildChannel({
        channelState: {
          pushStatus: 'active',
          subscriptionId: 'sub-1',
          subscriptionExpiresAt: nearExpiry,
        },
      }),
    ])
    ;(pushRenew as jest.Mock).mockResolvedValue({
      channelId: 'c',
      pushStatus: 'active',
    })

    await handle(buildJob({ tenantId: TENANT, organizationId: ORG }), buildCtx())

    expect(pushRenew).toHaveBeenCalledTimes(1)
    expect(emitCommunicationChannelsEvent).toHaveBeenCalledWith(
      'communication_channels.push.renewed',
      expect.objectContaining({ tenantId: TENANT, organizationId: ORG }),
      expect.objectContaining({ persistent: false }),
    )
  })

  it('skips channels whose expiry is beyond the lead window', async () => {
    const farExpiry = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString() // 48h
    ;(findWithDecryption as jest.Mock).mockResolvedValue([
      buildChannel({
        channelState: {
          pushStatus: 'active',
          subscriptionId: 'sub-1',
          subscriptionExpiresAt: farExpiry,
        },
      }),
    ])
    await handle(buildJob({ tenantId: TENANT, organizationId: ORG }), buildCtx())
    expect(pushRenew).not.toHaveBeenCalled()
  })

  it('skips channels missing subscriptionId / subscriptionExpiresAt', async () => {
    ;(findWithDecryption as jest.Mock).mockResolvedValue([
      buildChannel({
        channelState: { pushStatus: 'active', subscriptionId: 'sub-1' }, // no expiry
      }),
      buildChannel({
        channelState: {
          pushStatus: 'active',
          subscriptionExpiresAt: new Date().toISOString(),
        }, // no subscriptionId
      }),
    ])
    await handle(buildJob({ tenantId: TENANT, organizationId: ORG }), buildCtx())
    expect(pushRenew).not.toHaveBeenCalled()
  })

  it('skips channels whose pushStatus is not active', async () => {
    ;(findWithDecryption as jest.Mock).mockResolvedValue([
      buildChannel({
        channelState: {
          pushStatus: 'failed',
          subscriptionId: 'sub-1',
          subscriptionExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        },
      }),
    ])
    await handle(buildJob({ tenantId: TENANT, organizationId: ORG }), buildCtx())
    expect(pushRenew).not.toHaveBeenCalled()
  })

  it('does NOT emit push.renewed when pushRenew returns failed', async () => {
    const nearExpiry = new Date(Date.now() + 1 * 60 * 60 * 1000).toISOString()
    ;(findWithDecryption as jest.Mock).mockResolvedValue([
      buildChannel({
        channelState: {
          pushStatus: 'active',
          subscriptionId: 'sub-1',
          subscriptionExpiresAt: nearExpiry,
        },
      }),
    ])
    ;(pushRenew as jest.Mock).mockResolvedValue({
      channelId: 'c',
      pushStatus: 'failed',
      error: { code: 'graph_403', message: 'expired auth' },
    })
    await handle(buildJob({ tenantId: TENANT, organizationId: ORG }), buildCtx())
    expect(pushRenew).toHaveBeenCalledTimes(1)
    expect(emitCommunicationChannelsEvent).not.toHaveBeenCalled()
  })

  it('legacy unscoped payload falls back to a global sweep', async () => {
    ;(findWithDecryption as jest.Mock).mockResolvedValue([])
    await handle(
      buildJob(undefined as unknown as MicrosoftRenewSubscriptionsPayload['scope']),
      buildCtx(),
    )
    const [, , where, , scope] = (findWithDecryption as jest.Mock).mock.calls[0]
    expect(where).not.toHaveProperty('tenantId')
    expect(scope).toBeUndefined()
  })
})
