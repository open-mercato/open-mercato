// Spec C § Phase C4 — gmail-renew-watch cron worker.
//
// Asserts: scope filtering, lead-time threshold, pushStatus filter, the
// failed-status path (no event emitted), and the happy-path event emission.

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
import handle, { type GmailRenewWatchPayload } from '../gmail-renew-watch'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const OTHER_TENANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OTHER_ORG = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

function buildJob(scope: GmailRenewWatchPayload['scope']): QueuedJob<GmailRenewWatchPayload> {
  return {
    id: 'job-1',
    queue: 'communication-channels-gmail-renew-watch',
    payload: { scope },
    enqueuedAt: new Date(),
    attempts: 1,
  } as unknown as QueuedJob<GmailRenewWatchPayload>
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
    providerKey: 'gmail',
    tenantId: TENANT,
    organizationId: ORG,
    userId: 'user-x',
    isActive: true,
    deletedAt: null,
    channelState: {
      pushStatus: 'active',
      watchExpirationMs: Date.now() + 60 * 60 * 1000,
    },
    ...overrides,
  }
}

const FUTURE_FAR = Date.now() + 7 * 24 * 60 * 60 * 1000
const FUTURE_NEAR = Date.now() + 1 * 60 * 60 * 1000 // 1h — well inside the 24h default lead

afterEach(() => {
  jest.clearAllMocks()
  delete process.env.OM_PUSH_RENEWAL_GMAIL_LEAD_HOURS
})

describe('gmail-renew-watch worker', () => {
  it('filters em.find by scope.tenantId + scope.organizationId from job payload', async () => {
    ;(findWithDecryption as jest.Mock).mockResolvedValue([])
    await handle(buildJob({ tenantId: TENANT, organizationId: ORG }), buildCtx())
    const [, , where, , scope] = (findWithDecryption as jest.Mock).mock.calls[0]
    expect(where).toMatchObject({
      providerKey: 'gmail',
      tenantId: TENANT,
      organizationId: ORG,
    })
    expect(scope).toEqual({ tenantId: TENANT, organizationId: ORG })
  })

  it('renews channels within the lead window and emits push.renewed', async () => {
    ;(findWithDecryption as jest.Mock).mockResolvedValue([
      buildChannel({
        channelState: { pushStatus: 'active', watchExpirationMs: FUTURE_NEAR },
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
    ;(findWithDecryption as jest.Mock).mockResolvedValue([
      buildChannel({
        channelState: { pushStatus: 'active', watchExpirationMs: FUTURE_FAR },
      }),
    ])
    await handle(buildJob({ tenantId: TENANT, organizationId: ORG }), buildCtx())
    expect(pushRenew).not.toHaveBeenCalled()
    expect(emitCommunicationChannelsEvent).not.toHaveBeenCalled()
  })

  it('skips channels whose pushStatus is not active', async () => {
    ;(findWithDecryption as jest.Mock).mockResolvedValue([
      buildChannel({
        channelState: { pushStatus: 'failed', watchExpirationMs: FUTURE_NEAR },
      }),
      buildChannel({
        channelState: { pushStatus: 'inactive', watchExpirationMs: FUTURE_NEAR },
      }),
    ])
    await handle(buildJob({ tenantId: TENANT, organizationId: ORG }), buildCtx())
    expect(pushRenew).not.toHaveBeenCalled()
  })

  it('does NOT emit push.renewed when pushRenew returns failed', async () => {
    ;(findWithDecryption as jest.Mock).mockResolvedValue([
      buildChannel({
        channelState: { pushStatus: 'active', watchExpirationMs: FUTURE_NEAR },
      }),
    ])
    ;(pushRenew as jest.Mock).mockResolvedValue({
      channelId: 'c',
      pushStatus: 'failed',
      error: { code: 'pubsub_topic_missing', message: 'topic required' },
    })
    await handle(buildJob({ tenantId: TENANT, organizationId: ORG }), buildCtx())
    expect(pushRenew).toHaveBeenCalledTimes(1)
    expect(emitCommunicationChannelsEvent).not.toHaveBeenCalled()
  })

  it('skips channels missing organizationId', async () => {
    ;(findWithDecryption as jest.Mock).mockResolvedValue([
      buildChannel({
        organizationId: null,
        channelState: { pushStatus: 'active', watchExpirationMs: FUTURE_NEAR },
      }),
    ])
    await handle(buildJob({ tenantId: TENANT, organizationId: ORG }), buildCtx())
    expect(pushRenew).not.toHaveBeenCalled()
  })

  it('does not interleave channels from a different tenant scope', async () => {
    ;(findWithDecryption as jest.Mock).mockResolvedValue([
      buildChannel({
        tenantId: OTHER_TENANT,
        organizationId: OTHER_ORG,
        channelState: { pushStatus: 'active', watchExpirationMs: FUTURE_NEAR },
      }),
    ])
    await handle(buildJob({ tenantId: TENANT, organizationId: ORG }), buildCtx())
    // findWithDecryption was called with TENANT/ORG filters — the mock returned
    // an off-scope row anyway; the worker still calls pushRenew with the
    // channel's own scope. The contract test is the WHERE filter assertion in
    // the first test; here we confirm pushRenew uses the channel.tenantId
    // (which is OTHER_TENANT) — i.e. the worker doesn't cross-pollinate scopes.
    expect(pushRenew).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: expect.objectContaining({ tenantId: OTHER_TENANT }),
      }),
    )
  })

  it('legacy unscoped payload falls back to a global sweep', async () => {
    ;(findWithDecryption as jest.Mock).mockResolvedValue([])
    await handle(buildJob(undefined as unknown as GmailRenewWatchPayload['scope']), buildCtx())
    const [, , where, , scope] = (findWithDecryption as jest.Mock).mock.calls[0]
    expect(where).not.toHaveProperty('tenantId')
    expect(scope).toBeUndefined()
  })
})
