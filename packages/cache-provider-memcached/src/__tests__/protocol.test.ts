import { EventEmitter } from 'node:events'
import {
  createMemcachedClient,
  isMemcachedConnectionError,
  planKeyBatches,
  MAX_COMMAND_BYTES,
  MemcachedProtocolError,
  type MemcachedSocket,
  type MemcachedTransport,
} from '../protocol'

class ScriptedSocket extends EventEmitter {
  public readonly writes: Buffer[] = []
  public destroyed = false

  write(data: Buffer): boolean {
    this.writes.push(Buffer.from(data))
    return true
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.emit('close')
  }

  written(): string {
    return Buffer.concat(this.writes).toString('latin1')
  }

  reply(text: string | Buffer, chunkSize = 0): void {
    const data = typeof text === 'string' ? Buffer.from(text, 'latin1') : text
    if (chunkSize <= 0) {
      this.emit('data', data)
      return
    }
    for (let offset = 0; offset < data.length; offset += chunkSize) {
      this.emit('data', data.subarray(offset, offset + chunkSize))
    }
  }
}

function scriptedTransport() {
  const sockets: ScriptedSocket[] = []
  const transport: MemcachedTransport = {
    async open() {
      const socket = new ScriptedSocket()
      sockets.push(socket)
      return socket as unknown as MemcachedSocket
    },
    describe: () => 'scripted',
  }
  return { transport, sockets }
}

const flush = () => new Promise((resolve) => setImmediate(resolve))

describe('memcached protocol client', () => {
  it('parses a meta-get hit delivered one byte at a time', async () => {
    const { transport, sockets } = scriptedTransport()
    const client = createMemcachedClient({ transport, poolSize: 1 })
    const pending = client.metaGet('bucket:1')
    await flush()
    expect(sockets[0].written()).toBe('mg bucket:1 v c f\r\n')
    sockets[0].reply('VA 5 c42 f7\r\nhe\r\no\r\n', 1)
    await expect(pending).resolves.toEqual({ value: Buffer.from('he\r\no'), cas: '42', flags: 7 })
    const miss = client.metaGet('bucket:2')
    await flush()
    sockets[0].reply('EN\r\n')
    await expect(miss).resolves.toBeNull()
    await client.close()
  })

  it('pipelines requests and resolves replies in order', async () => {
    const { transport, sockets } = scriptedTransport()
    const client = createMemcachedClient({ transport, poolSize: 1 })
    const first = client.metaSet('k', Buffer.from('v'), { cas: '9' })
    const second = client.metaSet('k', Buffer.from('w'), { mode: 'add', ttlSeconds: 30 })
    const third = client.metaDelete('k', { cas: '3' })
    await flush()
    expect(sockets[0].written()).toBe('ms k 1 C9\r\nv\r\nms k 1 T30 ME\r\nw\r\nmd k C3\r\n')
    sockets[0].reply('EX\r\nNS\r\nHD\r\n')
    await expect(first).resolves.toBe('exists')
    await expect(second).resolves.toBe('not_stored')
    await expect(third).resolves.toBe('deleted')
    await client.close()
  })

  it('collects a quiet multi-get and keeps the connection in sync', async () => {
    const { transport, sockets } = scriptedTransport()
    const client = createMemcachedClient({ transport, poolSize: 1 })
    const pending = client.metaGetMany(['a', 'b', 'c'])
    await flush()
    expect(sockets[0].written()).toBe('mg a v c f k q\r\nmg b v c f k q\r\nmg c v c f k q\r\nmn\r\n')
    sockets[0].reply('VA 1 c1 ka\r\nA\r\nVA 2 c2 kc\r\nCC\r\nMN\r\n', 3)
    const found = await pending
    expect(Array.from(found.keys())).toEqual(['a', 'c'])
    expect(found.get('c')?.value.toString()).toBe('CC')
    await client.close()
  })

  it('maps an oversize server rejection without dropping the connection', async () => {
    const { transport, sockets } = scriptedTransport()
    const client = createMemcachedClient({ transport, poolSize: 1 })
    const big = client.metaSet('k', Buffer.alloc(10))
    const next = client.version()
    await flush()
    sockets[0].reply('SERVER_ERROR object too large for cache\r\nVERSION 1.6.45\r\n')
    await expect(big).rejects.toMatchObject({ code: 'item_too_large' })
    await expect(next).resolves.toBe('1.6.45')
    expect(sockets).toHaveLength(1)
    expect(sockets[0].destroyed).toBe(false)
    await client.close()
  })

  it('resets the connection after a client error and reconnects on the next command', async () => {
    const { transport, sockets } = scriptedTransport()
    const client = createMemcachedClient({ transport, poolSize: 1 })
    const failing = client.version()
    const queued = client.noop()
    await flush()
    sockets[0].reply('CLIENT_ERROR bad command line format\r\n')
    await expect(failing).rejects.toMatchObject({ code: 'client_error' })
    expect(isMemcachedConnectionError(await queued.catch((error: unknown) => error))).toBe(true)
    expect(sockets[0].destroyed).toBe(true)
    const retried = client.version()
    await flush()
    expect(sockets).toHaveLength(2)
    sockets[1].reply('VERSION 1.6.45\r\n')
    await expect(retried).resolves.toBe('1.6.45')
    await client.close()
  })

  it('times out a stalled command and fails every in-flight request', async () => {
    const { transport, sockets } = scriptedTransport()
    const client = createMemcachedClient({ transport, poolSize: 1, commandTimeoutMs: 30 })
    const stalled = client.metaGet('k')
    const behind = client.metaGet('j')
    await expect(stalled).rejects.toMatchObject({ code: 'timeout' })
    await expect(behind).rejects.toMatchObject({ code: 'timeout' })
    expect(sockets[0].destroyed).toBe(true)
    await client.close()
  })

  it('rejects unsolicited replies and closed clients', async () => {
    const { transport, sockets } = scriptedTransport()
    const client = createMemcachedClient({ transport, poolSize: 1 })
    const pending = client.version()
    await flush()
    sockets[0].reply('VERSION 1\r\nHD\r\n')
    await expect(pending).resolves.toBe('1')
    expect(sockets[0].destroyed).toBe(true)
    await client.close()
    await client.close()
    await expect(client.version()).rejects.toMatchObject({ code: 'closed' })
  })

  it('validates keys and stats groups before writing anything', async () => {
    const { transport, sockets } = scriptedTransport()
    const client = createMemcachedClient({ transport, poolSize: 1 })
    await expect(client.metaGet('has space')).rejects.toMatchObject({ code: 'invalid_key' })
    await expect(client.metaGet('x'.repeat(251))).rejects.toMatchObject({ code: 'invalid_key' })
    await expect(client.metaGet('')).rejects.toMatchObject({ code: 'invalid_key' })
    await expect(client.stats('settings\r\nflush_all')).rejects.toBeInstanceOf(MemcachedProtocolError)
    expect(sockets).toHaveLength(0)
    await client.close()
  })

  it('bounds batched commands to 16 KiB and the key-count limit', () => {
    const keys = Array.from({ length: 2000 }, (_, index) => `ns-${'n'.repeat(40)}:v1:b4096:${index}`)
    const lineBytes = (key: string) => key.length + 16
    const batches = planKeyBatches(keys, lineBytes, MAX_COMMAND_BYTES, 512)
    expect(batches.flat()).toEqual(keys)
    for (const batch of batches) {
      expect(batch.reduce((total, key) => total + lineBytes(key), 0)).toBeLessThanOrEqual(MAX_COMMAND_BYTES)
      expect(batch.length).toBeLessThanOrEqual(512)
    }
    expect(planKeyBatches(keys.slice(0, 10), lineBytes, MAX_COMMAND_BYTES, 3).map((batch) => batch.length)).toEqual([3, 3, 3, 1])
    expect(() => planKeyBatches(['x'.repeat(300)], lineBytes, 256, 10)).toThrow(MemcachedProtocolError)
  })
})
