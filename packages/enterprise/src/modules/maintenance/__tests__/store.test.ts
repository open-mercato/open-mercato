import fs from 'node:fs'
import path from 'node:path'
import { createFileMaintenanceStore } from '../lib/store/file'
import { parseRedisDurability } from '../lib/store/redis'
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

describe('redis durability detection', () => {
  it('accepts AOF or a configured RDB save policy', () => {
    expect(parseRedisDurability('aof_enabled:1\r\n', null)).toBe(true)
    expect(parseRedisDurability('aof_enabled:0\r\n', ['save', '3600 1'])).toBe(true)
    expect(parseRedisDurability('aof_enabled:0\r\n', ['save', ''])).toBe(false)
    expect(parseRedisDurability('aof_enabled:0\r\n', null)).toBe(false)
  })
})
