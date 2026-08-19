import { createRefCountedClientCache } from '../refcounted-client-cache'

type FakeClient = { id: string; disposed: boolean }

const flush = async () => {
  // Let queued microtasks (deferred disposals) run.
  await Promise.resolve()
  await Promise.resolve()
}

function buildCache(max: number) {
  const created: FakeClient[] = []
  const cache = createRefCountedClientCache<FakeClient>({
    max,
    dispose: (client) => {
      client.disposed = true
    },
  })
  const factory = (id: string) => async () => {
    const client: FakeClient = { id, disposed: false }
    created.push(client)
    return client
  }
  return { cache, created, factory }
}

describe('createRefCountedClientCache', () => {
  it('reuses the cached client for the same key and only creates once', async () => {
    const { cache, created, factory } = buildCache(4)
    const first = await cache.acquire('k', factory('k'))
    first.release()
    const second = await cache.acquire('k', factory('k'))
    second.release()
    expect(created).toHaveLength(1)
    expect(cache.size()).toBe(1)
  })

  it('LRU-evicts and disposes the least-recently-used client past the cap', async () => {
    const { cache, created, factory } = buildCache(2)
    ;(await cache.acquire('a', factory('a'))).release()
    ;(await cache.acquire('b', factory('b'))).release()
    ;(await cache.acquire('c', factory('c'))).release()
    await flush()
    expect(cache.size()).toBe(2)
    expect(created.find((client) => client.id === 'a')?.disposed).toBe(true)
    expect(created.find((client) => client.id === 'b')?.disposed).toBe(false)
    expect(created.find((client) => client.id === 'c')?.disposed).toBe(false)
  })

  it('defers disposal of an evicted client until its last in-flight borrow releases', async () => {
    const { cache, created, factory } = buildCache(1)
    // Borrow 'a' and DO NOT release — simulate a send still in flight.
    const inFlight = await cache.acquire('a', factory('a'))
    // A borrow of a new key evicts 'a' while it is still held.
    ;(await cache.acquire('b', factory('b'))).release()
    await flush()
    const clientA = created.find((client) => client.id === 'a')
    expect(clientA?.disposed).toBe(false) // fenced: not disposed while borrowed
    // Once the in-flight borrow releases, the evicted client is disposed.
    inFlight.release()
    await flush()
    expect(clientA?.disposed).toBe(true)
  })

  it('drops a rejected factory result without disposing and lets the next borrow retry', async () => {
    const cache = createRefCountedClientCache<FakeClient>({ max: 2, dispose: () => {} })
    await expect(
      cache.acquire('bad', async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    expect(cache.size()).toBe(0)
    const ok = await cache.acquire('bad', async () => ({ id: 'bad', disposed: false }))
    ok.release()
    expect(cache.size()).toBe(1)
  })

  it('release is idempotent', async () => {
    const { cache, created, factory } = buildCache(1)
    const inFlight = await cache.acquire('a', factory('a'))
    ;(await cache.acquire('b', factory('b'))).release()
    inFlight.release()
    inFlight.release()
    await flush()
    // Double release must not double-dispose or throw; exactly one dispose of 'a'.
    expect(created.filter((client) => client.id === 'a' && client.disposed)).toHaveLength(1)
  })
})
