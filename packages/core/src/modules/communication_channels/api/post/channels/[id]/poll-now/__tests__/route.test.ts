/** @jest-environment node */

// Regression for https://github.com/open-mercato/open-mercato/issues/4980 — the
// route used to enqueue a poll job for every connected channel and answer
// `202 { ok: true }`, including for channels the poll worker skips by definition
// (`capabilities.realtimePush !== false`). The UI turned that into a toast
// promising messages "in a few seconds" that could never arrive.

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const channelId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

const findOneWithDecryptionMock = jest.fn()
const getAuthFromRequestMock = jest.fn()
const loadAclMock = jest.fn()
const assertCanManageChannelMock = jest.fn()
const enqueueMock = jest.fn()
const validateRouteMutationGuardMock = jest.fn()
const afterSuccessMock = jest.fn()
const translateMock = jest.fn((key: string, fallback?: string) => fallback ?? key)

class ChannelAccessDeniedErrorMock extends Error {}

const em = { fork: () => em }

/** In-memory fake matching the `has`/`set` subset of `CacheStrategy` used by the poll lease. */
let cacheEntries = new Map<string, number>()
const cacheStore = {
  async has(key: string) {
    return cacheEntries.has(key)
  },
  async set(key: string, _value: unknown, _options?: { ttl?: number; tags?: string[] }) {
    cacheEntries.set(key, 1)
  },
}

let cacheRegistered = true
let cacheOverride: { has: (key: string) => Promise<boolean>; set: (...args: unknown[]) => Promise<void> } | null = null
const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return em
    if (name === 'rbacService') return { loadAcl: loadAclMock }
    if (name === 'cache') {
      if (!cacheRegistered) throw new Error('cache not registered')
      return cacheOverride ?? cacheStore
    }
    throw new Error(`Unexpected container resolve: ${name}`)
  }),
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => getAuthFromRequestMock(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

// Without this the route's `resolveTranslations()` throws on an unregistered
// module registry — the exact gap that made the app-level storage_s3 suite red
// in #4926. Mocking it also lets the tests assert the locale key, not the copy.
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (key: string, fallback?: string) => translateMock(key, fallback),
  }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...args),
}))

jest.mock('../../../../../../lib/access-control', () => ({
  ChannelAccessDeniedError: ChannelAccessDeniedErrorMock,
  assertCanManageChannel: (...args: unknown[]) => assertCanManageChannelMock(...args),
}))

jest.mock('../../../../../../lib/queue', () => ({
  COMMUNICATION_CHANNELS_QUEUES: { poll: 'communication-channels-poll' },
  getCommunicationChannelsQueue: () => ({ enqueue: (...args: unknown[]) => enqueueMock(...args) }),
}))

jest.mock('../../../../../../lib/route-mutation-guard', () => ({
  validateRouteMutationGuard: (...args: unknown[]) => validateRouteMutationGuardMock(...args),
}))

import { POST } from '../route'
import { pollLeaseCacheKey } from '../../../../../../lib/poll-lease'

function invoke() {
  return POST(
    new Request(`http://localhost/api/communication_channels/channels/${channelId}/poll-now`, {
      method: 'POST',
    }),
    { params: { id: channelId } },
  )
}

function channel(capabilities: Record<string, unknown> | null) {
  return {
    id: channelId,
    userId,
    providerKey: capabilities?.realtimePush === false ? 'imap' : 'discord',
    isActive: true,
    status: 'connected',
    capabilities,
  }
}

describe('communication_channels poll-now route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    cacheEntries = new Map()
    cacheRegistered = true
    cacheOverride = null
    getAuthFromRequestMock.mockResolvedValue({ sub: userId, tenantId, orgId: organizationId })
    loadAclMock.mockResolvedValue({ isSuperAdmin: true, features: ['*'], organizations: null })
    assertCanManageChannelMock.mockImplementation(() => {})
    validateRouteMutationGuardMock.mockResolvedValue({ afterSuccess: afterSuccessMock })
  })

  it('enqueues a poll job for a hub-polled channel', async () => {
    findOneWithDecryptionMock.mockResolvedValue(channel({ realtimePush: false }))

    const response = await invoke()

    expect(response.status).toBe(202)
    expect(enqueueMock).toHaveBeenCalledTimes(1)
    expect(enqueueMock.mock.calls[0][0]).toMatchObject({ channelId })
  })

  it('refuses a push-driven channel instead of queueing work the worker skips', async () => {
    findOneWithDecryptionMock.mockResolvedValue(channel({ realtimePush: true }))

    const response = await invoke()

    expect(response.status).toBe(409)
    expect(enqueueMock).not.toHaveBeenCalled()
    const body = (await response.json()) as { error: string }
    expect(body.error).toMatch(/push-driven/i)
    expect(translateMock).toHaveBeenCalledWith(
      'communication_channels.errors.pollNowPushDriven',
      expect.any(String),
    )
  })

  it('refuses a channel with no declared capabilities, matching the poll worker default', async () => {
    findOneWithDecryptionMock.mockResolvedValue(channel(null))

    const response = await invoke()

    expect(response.status).toBe(409)
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('still refuses a disabled channel before the capability check', async () => {
    findOneWithDecryptionMock.mockResolvedValue({
      ...channel({ realtimePush: false }),
      isActive: false,
    })

    const response = await invoke()

    expect(response.status).toBe(409)
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  // Regression for #8713 — poll-now used to enqueue unconditionally, even
  // when a poll-channel job was already queued/running for this channel
  // (e.g. the scheduled tick just enqueued one), causing a wasteful duplicate
  // provider fetch.
  describe('enqueue-time dedupe guard (#8713)', () => {
    it('refuses with 409 when a poll lease is already held for the channel', async () => {
      findOneWithDecryptionMock.mockResolvedValue(channel({ realtimePush: false }))
      cacheEntries.set(pollLeaseCacheKey(tenantId, channelId), 1)

      const response = await invoke()

      expect(response.status).toBe(409)
      expect(enqueueMock).not.toHaveBeenCalled()
      const body = (await response.json()) as { error: string }
      expect(body.error).toMatch(/already queued|running/i)
      expect(translateMock).toHaveBeenCalledWith(
        'communication_channels.errors.pollNowAlreadyQueued',
        expect.any(String),
      )
    })

    it('acquires the lease and enqueues when none is held', async () => {
      findOneWithDecryptionMock.mockResolvedValue(channel({ realtimePush: false }))

      const response = await invoke()

      expect(response.status).toBe(202)
      expect(enqueueMock).toHaveBeenCalledTimes(1)
      expect(cacheEntries.has(pollLeaseCacheKey(tenantId, channelId))).toBe(true)
    })

    it('does not block the request when the DI container has no cache registered', async () => {
      findOneWithDecryptionMock.mockResolvedValue(channel({ realtimePush: false }))
      cacheRegistered = false

      const response = await invoke()

      expect(response.status).toBe(202)
      expect(enqueueMock).toHaveBeenCalledTimes(1)
    })

    // Regression for the cache-I/O failure path flagged in review: a cache
    // that IS registered but rejects at I/O time (e.g. a Redis outage) must
    // fail open the same way a missing registration does — enqueue the poll
    // rather than answering 409 for an operator-triggered retry.
    it('still enqueues when the registered cache rejects on has()', async () => {
      findOneWithDecryptionMock.mockResolvedValue(channel({ realtimePush: false }))
      cacheOverride = {
        has: jest.fn(async () => {
          throw new Error('redis connection reset')
        }),
        set: jest.fn(async () => {}),
      }

      const response = await invoke()

      expect(response.status).toBe(202)
      expect(enqueueMock).toHaveBeenCalledTimes(1)
    })

    it('still enqueues when the registered cache rejects on set()', async () => {
      findOneWithDecryptionMock.mockResolvedValue(channel({ realtimePush: false }))
      cacheOverride = {
        has: jest.fn(async () => false),
        set: jest.fn(async () => {
          throw new Error('redis connection reset')
        }),
      }

      const response = await invoke()

      expect(response.status).toBe(202)
      expect(enqueueMock).toHaveBeenCalledTimes(1)
    })
  })
})
