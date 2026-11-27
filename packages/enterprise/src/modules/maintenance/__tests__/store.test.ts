import fs from 'node:fs'
import path from 'node:path'
import { createFileMaintenanceStore } from '../lib/store/file'
import { createRedisMaintenanceStore, parseRedisDurability } from '../lib/store/redis'
import { waitForRedisReady } from '../lib/store'
import { createInitialState } from '../lib/state'
import { mutateState, MaintenanceStateConflictError, MaintenanceStateUnsupportedError } from '../lib/transitions'
import { makeTempDir } from './helpers'

describe('file maintenance store', () => {
  it('reports a missing document, then writes with compare-and-set', async () => {
    const store = createFileMaintenanceStore(makeTempDir())
    expect((await store.readState()).kind).toBe('missing')
    const next = { ...createInitialState(), active: true, revision: 1 }
    expect(await store.compareAndSet(0, next)).toBe(true)
    expect(await store.compareAndSet(0, next)).toBe(false)
    const read = await store.readState()
    expect(read.kind === 'ok' && read.state.active).toBe(true)
  })

  it('serializes concurrent mutations so every increment lands', async () => {
    const store = createFileMaintenanceStore(makeTempDir())
    await Promise.all(Array.from({ length: 8 }, () =>
      mutateState(store, (current) => ({ next: { ...current, epoch: current.epoch + 1 }, result: undefined }), 20),
    ))
    const read = await store.readState()
    expect(read.kind === 'ok' && read.state.epoch).toBe(8)
    expect(read.kind === 'ok' && read.state.revision).toBe(8)
  })

  it('reports a lost race after one retry', async () => {
    const store = createFileMaintenanceStore(makeTempDir())
    const racing = { ...store, compareAndSet: async () => false }
    await expect(mutateState(racing, (current) => ({ next: current, result: 1 }))).rejects.toBeInstanceOf(MaintenanceStateConflictError)
  })

  it('treats a corrupted file and an unknown major version as unsupported', async () => {
    const dir = makeTempDir()
    const store = createFileMaintenanceStore(dir)
    fs.writeFileSync(path.join(dir, 'state.json'), '{not json')
    expect((await store.readState()).kind).toBe('unsupported')
    fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ version: 2, active: false, revision: 1, epoch: 1 }))
    expect((await store.readState()).kind).toBe('unsupported')
    await expect(mutateState(store, (current) => ({ next: current, result: 1 }))).rejects.toBeInstanceOf(MaintenanceStateUnsupportedError)
  })

  it('stores and lists process records', async () => {
    const store = createFileMaintenanceStore(makeTempDir())
    await store.writeProcess({
      processId: 'host:1:abc', kind: 'web', host: 'host', pid: 1, startedAt: 'x', ackedGateRevision: 2,
      loadedGeneration: null, inflight: 0, heartbeatAt: new Date().toISOString(),
    }, 1000)
    const records = await store.listProcesses()
    expect(records.map((record) => record.processId)).toEqual(['host:1:abc'])
    await store.removeProcess('host:1:abc')
    expect(await store.listProcesses()).toEqual([])
  })
})

function createWatchingRedisFake() {
  let value: string | null = null
  let watchedSnapshot: string | null | undefined
  const client = {
    get: async () => value,
    set: async () => 'OK',
    del: async () => 1,
    watch: async () => {
      watchedSnapshot = value
      return 'OK'
    },
    unwatch: async () => {
      watchedSnapshot = undefined
      return 'OK'
    },
    multi: () => {
      const writes: string[] = []
      const chain = {
        set: (_key: string, next: string) => {
          writes.push(next)
          return chain
        },
        exec: async () => {
          await new Promise((resolve) => setImmediate(resolve))
          const conflicted = watchedSnapshot !== undefined && watchedSnapshot !== value
          watchedSnapshot = undefined
          if (conflicted) return null
          for (const next of writes) value = next
          return writes.map(() => [null, 'OK'] as [Error | null, unknown])
        },
      }
      return chain
    },
    scan: async () => ['0', []] as [string, string[]],
    mget: async () => [],
    time: async () => ['0', '0'] as [string, string],
    info: async () => '',
    config: async () => null,
    quit: async () => 'OK',
  }
  return client
}

describe('redis maintenance store', () => {
  it('serializes overlapping compare-and-set calls on one connection so no update is lost', async () => {
    const store = createRedisMaintenanceStore(createWatchingRedisFake())
    const base = createInitialState()
    const results = await Promise.all([
      store.compareAndSet(0, { ...base, revision: 1, epoch: 1 }),
      store.compareAndSet(0, { ...base, revision: 1, epoch: 2 }),
    ])
    expect(results.sort()).toEqual([false, true])
    const read = await store.readState()
    expect(read.kind === 'ok' && read.state.revision).toBe(1)
  })

  it('waits for the connection to become ready before resolving', async () => {
    const listeners = new Map<string, (error?: Error) => void>()
    const client = {
      ...createWatchingRedisFake(),
      status: 'connecting',
      once: (event: string, listener: (error?: Error) => void) => listeners.set(event, listener),
      off: (event: string) => listeners.delete(event),
      disconnect: jest.fn(),
    }
    let settled = false
    const waiting = waitForRedisReady(client, 1000).then(() => {
      settled = true
    })
    await new Promise((resolve) => setImmediate(resolve))
    expect(settled).toBe(false)
    listeners.get('ready')?.()
    await waiting
    expect(settled).toBe(true)
    expect(listeners.size).toBe(0)
  })

  it('rejects and disconnects when the connection fails before it is ready', async () => {
    const listeners = new Map<string, (error?: Error) => void>()
    const disconnect = jest.fn()
    const client = {
      ...createWatchingRedisFake(),
      status: 'connecting',
      once: (event: string, listener: (error?: Error) => void) => listeners.set(event, listener),
      off: (event: string) => listeners.delete(event),
      disconnect,
    }
    const waiting = waitForRedisReady(client, 1000)
    listeners.get('error')?.(new Error('ECONNREFUSED'))
    await expect(waiting).rejects.toThrow('ECONNREFUSED')
    expect(disconnect).toHaveBeenCalledTimes(1)
  })
})

describe('redis durability detection', () => {
  it('accepts AOF or a configured RDB save policy', () => {
    expect(parseRedisDurability('aof_enabled:1\r\n', null)).toBe(true)
    expect(parseRedisDurability('aof_enabled:0\r\n', ['save', '3600 1'])).toBe(true)
    expect(parseRedisDurability('aof_enabled:0\r\n', ['save', ''])).toBe(false)
    expect(parseRedisDurability('aof_enabled:0\r\n', null)).toBe(false)
  })
})

describe('default state directory', () => {
  it('anchors to the Next app root when the CLI runs from the monorepo root', () => {
    const { resolveDefaultStateDir } = jest.requireActual('../lib/config') as typeof import('../lib/config')
    const root = makeTempDir()
    const appDir = path.join(root, 'apps', 'web')
    fs.mkdirSync(path.join(appDir, '.mercato', 'generated'), { recursive: true })
    fs.writeFileSync(path.join(appDir, 'next.config.ts'), 'export default {}')
    expect(resolveDefaultStateDir(root)).toBe(path.join(appDir, '.mercato', 'maintenance'))
    expect(resolveDefaultStateDir(appDir)).toBe(path.join(appDir, '.mercato', 'maintenance'))
  })
})
