import { Cluster, Redis } from 'ioredis'
import { createIoredisClientFactory, RESP_MIN_REFRESH_DELAY_MS } from '../client'
import type { RespCredentials, RespManagedClient } from '../client'
import { createRespSettingsSchema } from '../settings'

const schema = createRespSettingsSchema()
const standalone = schema.parse({ mode: 'standalone', host: '127.0.0.1', port: 1 })
const cluster = schema.parse({ mode: 'cluster', nodes: [{ host: '127.0.0.1', port: 1 }] })

function rotatingProvider(): { provider: jest.Mock<Promise<RespCredentials>, []>; rotate(password: string): void } {
  let current: RespCredentials = { username: 'app', password: 'token-1' }
  const provider = jest.fn(async () => current)
  return { provider, rotate: (password) => { current = { username: 'app', password } } }
}

async function flush(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await Promise.resolve()
}

describe('RESP credential refresh scheduling', () => {
  const managed: RespManagedClient[] = []

  afterEach(() => {
    for (const entry of managed.splice(0)) {
      entry.dispose()
      entry.client.disconnect()
    }
    jest.useRealTimers()
  })

  it('re-evaluates a function schedule after every refresh instead of a fixed interval', async () => {
    jest.useFakeTimers()
    const { provider } = rotatingProvider()
    const delays = [5_000, 1_000, 60_000]
    const schedule = jest.fn(() => delays.shift() ?? 60_000)
    managed.push(await createIoredisClientFactory(standalone, { credentialsProvider: provider, refreshIntervalMs: schedule })())
    expect(provider).toHaveBeenCalledTimes(1)
    await jest.advanceTimersByTimeAsync(4_999)
    expect(provider).toHaveBeenCalledTimes(1)
    await jest.advanceTimersByTimeAsync(1)
    expect(provider).toHaveBeenCalledTimes(2)
    await jest.advanceTimersByTimeAsync(1_000)
    expect(provider).toHaveBeenCalledTimes(3)
    await jest.advanceTimersByTimeAsync(59_999)
    expect(provider).toHaveBeenCalledTimes(3)
    expect(schedule).toHaveBeenCalledTimes(3)
  })

  it('clamps a non-positive function delay and stops after dispose', async () => {
    jest.useFakeTimers()
    const { provider } = rotatingProvider()
    const entry = await createIoredisClientFactory(standalone, { credentialsProvider: provider, refreshIntervalMs: () => -5 })()
    managed.push(entry)
    await jest.advanceTimersByTimeAsync(RESP_MIN_REFRESH_DELAY_MS - 1)
    expect(provider).toHaveBeenCalledTimes(1)
    await jest.advanceTimersByTimeAsync(1)
    expect(provider).toHaveBeenCalledTimes(2)
    entry.dispose()
    await jest.advanceTimersByTimeAsync(RESP_MIN_REFRESH_DELAY_MS * 10)
    expect(provider).toHaveBeenCalledTimes(2)
  })

  it('keeps a fixed numeric interval and treats 0 as disabled', async () => {
    jest.useFakeTimers()
    const fixed = rotatingProvider()
    managed.push(await createIoredisClientFactory(standalone, { credentialsProvider: fixed.provider, refreshIntervalMs: 2_000 })())
    await jest.advanceTimersByTimeAsync(6_000)
    expect(fixed.provider).toHaveBeenCalledTimes(4)
    const disabled = rotatingProvider()
    managed.push(await createIoredisClientFactory(standalone, { credentialsProvider: disabled.provider, refreshIntervalMs: 0 })())
    await jest.advanceTimersByTimeAsync(60_000)
    expect(disabled.provider).toHaveBeenCalledTimes(1)
  })
})

describe('RESP per-connection credentials', () => {
  const managed: RespManagedClient[] = []

  afterEach(() => {
    for (const entry of managed.splice(0)) {
      entry.dispose()
      entry.client.disconnect()
    }
  })

  it('gives a cluster node that joins later the current credentials', async () => {
    const { provider, rotate } = rotatingProvider()
    const entry = await createIoredisClientFactory(cluster, { credentialsProvider: provider })()
    managed.push(entry)
    rotate('token-2')
    const node = new Redis({ lazyConnect: true, username: 'app', password: 'token-1' })
    ;(entry.client as Cluster).emit('+node', node)
    await flush()
    expect(node.options.password).toBe('token-2')
    node.disconnect()
  })

  it('a reconnecting cluster node picks up the rotated credential before it reconnects', async () => {
    const { provider, rotate } = rotatingProvider()
    const entry = await createIoredisClientFactory(cluster, { credentialsProvider: provider })()
    managed.push(entry)
    const node = new Redis({ lazyConnect: true, username: 'app', password: 'token-1' })
    ;(entry.client as Cluster).emit('+node', node)
    await flush()
    rotate('token-3')
    node.emit('reconnecting', 100)
    await flush()
    expect(node.options).toMatchObject({ username: 'app', password: 'token-3' })
    node.disconnect()
  })

  it('re-AUTHs a node that became ready with a credential older than the current one', async () => {
    const { provider, rotate } = rotatingProvider()
    const entry = await createIoredisClientFactory(cluster, { credentialsProvider: provider })()
    managed.push(entry)
    const node = new Redis({ lazyConnect: true, username: 'app', password: 'token-1' })
    const auth = jest.spyOn(node, 'auth').mockImplementation(async () => 'OK')
    ;(entry.client as Cluster).emit('+node', node)
    await flush()
    node.emit('connecting')
    node.status = 'ready'
    node.emit('ready')
    await flush()
    expect(auth).not.toHaveBeenCalled()
    node.emit('connecting')
    rotate('token-4')
    node.emit('ready')
    await flush()
    expect(auth).toHaveBeenCalledWith('app', 'token-4')
    node.status = 'end'
    node.disconnect()
  })

  it('refreshes a standalone client before reconnecting and re-AUTHs a stale ready connection', async () => {
    const { provider, rotate } = rotatingProvider()
    const entry = await createIoredisClientFactory(standalone, { credentialsProvider: provider })()
    managed.push(entry)
    const client = entry.client as Redis
    const auth = jest.spyOn(client, 'auth').mockImplementation(async () => 'OK')
    rotate('token-5')
    client.emit('reconnecting', 100)
    await flush()
    expect(client.options.password).toBe('token-5')
    client.emit('connecting')
    rotate('token-6')
    client.status = 'ready'
    client.emit('ready')
    await flush()
    expect(auth).toHaveBeenCalledWith('app', 'token-6')
    client.status = 'end'
  })
})
