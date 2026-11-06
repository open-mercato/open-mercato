import {
  COMMUNICATION_CHANNELS_POLL_LEASE_CACHE_TAG,
  getPollLeaseTtlMs,
  pollLeaseCacheKey,
  tryAcquirePollLease,
  type PollLeaseStore,
} from '../poll-lease'

// Regression for #8713 — the scheduled poll tick and the manual poll-now
// route each enqueued a `poll-channel` job for a channel independently, with
// no visibility into whether a job for that channel was already
// queued/running. This exercises the enqueue-time dedupe guard in isolation
// from its two call sites (poll-tick, poll-now route — covered separately).

function createMemoryStore(): PollLeaseStore & {
  entries: Map<string, { value: unknown; expiresAt: number | null }>
} {
  const entries = new Map<string, { value: unknown; expiresAt: number | null }>()
  return {
    entries,
    async has(key: string) {
      const entry = entries.get(key)
      if (!entry) return false
      if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
        entries.delete(key)
        return false
      }
      return true
    },
    async set(key: string, value: unknown, options?: { ttl?: number; tags?: string[] }) {
      entries.set(key, {
        value,
        expiresAt: options?.ttl ? Date.now() + options.ttl : null,
      })
    },
  }
}

describe('pollLeaseCacheKey', () => {
  it('is tenant- and channel-scoped and stable', () => {
    const key = pollLeaseCacheKey('tenant-1', 'channel-1')
    expect(key).toBe(`${COMMUNICATION_CHANNELS_POLL_LEASE_CACHE_TAG}:tenant-1:channel-1`)
  })
})

describe('getPollLeaseTtlMs', () => {
  const previous = process.env.COMMUNICATION_CHANNELS_POLL_LEASE_TTL_MS

  afterEach(() => {
    if (previous === undefined) delete process.env.COMMUNICATION_CHANNELS_POLL_LEASE_TTL_MS
    else process.env.COMMUNICATION_CHANNELS_POLL_LEASE_TTL_MS = previous
  })

  it('defaults to 60s when unset', () => {
    delete process.env.COMMUNICATION_CHANNELS_POLL_LEASE_TTL_MS
    expect(getPollLeaseTtlMs()).toBe(60_000)
  })

  it('honours a valid positive override', () => {
    process.env.COMMUNICATION_CHANNELS_POLL_LEASE_TTL_MS = '5000'
    expect(getPollLeaseTtlMs()).toBe(5000)
  })

  it('falls back to the default on a non-numeric or non-positive override', () => {
    process.env.COMMUNICATION_CHANNELS_POLL_LEASE_TTL_MS = 'not-a-number'
    expect(getPollLeaseTtlMs()).toBe(60_000)
    process.env.COMMUNICATION_CHANNELS_POLL_LEASE_TTL_MS = '0'
    expect(getPollLeaseTtlMs()).toBe(60_000)
    process.env.COMMUNICATION_CHANNELS_POLL_LEASE_TTL_MS = '-10'
    expect(getPollLeaseTtlMs()).toBe(60_000)
  })
})

describe('tryAcquirePollLease', () => {
  it('acquires the lease on first call for a channel', async () => {
    const store = createMemoryStore()
    const acquired = await tryAcquirePollLease(store, { tenantId: 't1', channelId: 'c1' }, 1000)
    expect(acquired).toBe(true)
    expect(await store.has(pollLeaseCacheKey('t1', 'c1'))).toBe(true)
  })

  it('refuses a second acquire for the same channel while the lease is live', async () => {
    const store = createMemoryStore()
    const first = await tryAcquirePollLease(store, { tenantId: 't1', channelId: 'c1' }, 10_000)
    const second = await tryAcquirePollLease(store, { tenantId: 't1', channelId: 'c1' }, 10_000)
    expect(first).toBe(true)
    expect(second).toBe(false)
  })

  it('does not block a different channel or a different tenant', async () => {
    const store = createMemoryStore()
    await tryAcquirePollLease(store, { tenantId: 't1', channelId: 'c1' }, 10_000)
    expect(await tryAcquirePollLease(store, { tenantId: 't1', channelId: 'c2' }, 10_000)).toBe(true)
    expect(await tryAcquirePollLease(store, { tenantId: 't2', channelId: 'c1' }, 10_000)).toBe(true)
  })

  it('allows re-acquiring once the lease TTL has elapsed', async () => {
    const store = createMemoryStore()
    await tryAcquirePollLease(store, { tenantId: 't1', channelId: 'c1' }, 1)
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(await tryAcquirePollLease(store, { tenantId: 't1', channelId: 'c1' }, 10_000)).toBe(true)
  })
})
