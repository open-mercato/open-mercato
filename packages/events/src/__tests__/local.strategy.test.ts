import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { createEventBus } from '@open-mercato/events/index'

function readJson(p: string) { return JSON.parse(fs.readFileSync(p, 'utf8')) }

describe('Event bus', () => {
  const origCwd = process.cwd()
  let tmp: string
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'events-test-'))
    process.chdir(tmp)
    delete process.env.QUEUE_STRATEGY
    delete process.env.EVENTS_STRATEGY
  })
  afterEach(() => {
    process.chdir(origCwd)
    try { fs.rmSync(tmp, { recursive: true, force: true }) } catch {}
  })

  test('online delivery via on + emit', async () => {
    const calls: any[] = []
    const bus = createEventBus({ resolve: ((name: string) => name) as any })
    bus.on('demo', async (payload, ctx) => { calls.push({ payload, resolved: ctx.resolve('em') }) })
    await bus.emit('demo', { a: 1 })
    expect(calls).toHaveLength(1)
    expect(calls[0].payload).toEqual({ a: 1 })
    expect(calls[0].resolved).toEqual('em')
  })

  test('emitEvent alias works for backward compatibility', async () => {
    const calls: any[] = []
    const bus = createEventBus({ resolve: ((name: string) => name) as any })
    bus.on('demo', async (payload) => { calls.push(payload) })
    await bus.emitEvent('demo', { a: 1 })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual({ a: 1 })
  })

  test('persistent events are recorded to queue', async () => {
    const queueDir = path.resolve('.queue', 'events')
    const queuePath = path.join(queueDir, 'queue.json')
    const recv: any[] = []
    const bus = createEventBus({ resolve: ((name: string) => name) as any })
    bus.on('queued', (payload) => { recv.push(payload) })

    // Emit persistent events
    await bus.emit('queued', { id: 1 }, { persistent: true })
    await bus.emit('queued', { id: 2 }, { persistent: true })

    // Events should be delivered immediately
    expect(recv).toHaveLength(2)

    // And also persisted to queue
    const list = readJson(queuePath)
    expect(Array.isArray(list)).toBe(true)
    expect(list.length).toBeGreaterThanOrEqual(2)
  })

  test('clearQueue removes all queued events', async () => {
    const queueDir = path.resolve('.queue', 'events')
    const queuePath = path.join(queueDir, 'queue.json')
    const bus = createEventBus({ resolve: ((name: string) => name) as any })

    await bus.emit('q', { n: 1 }, { persistent: true })
    await bus.emit('q', { n: 2 }, { persistent: true })

    const before = readJson(queuePath)
    expect(before.length).toBeGreaterThanOrEqual(2)

    const result = await bus.clearQueue()
    expect(result.removed).toBeGreaterThanOrEqual(0)

    const after = readJson(queuePath)
    expect(after.length).toBe(0)
  })

  test('registerModuleSubscribers registers handlers', async () => {
    const calls: any[] = []
    const bus = createEventBus({ resolve: ((name: string) => name) as any })

    bus.registerModuleSubscribers([
      { id: 'sub1', event: 'test.event', handler: (p) => { calls.push(p) } },
      { id: 'sub2', event: 'other.event', handler: (p) => { calls.push(p) } },
    ])

    await bus.emit('test.event', { value: 1 })
    await bus.emit('other.event', { value: 2 })

    expect(calls).toHaveLength(2)
    expect(calls[0]).toEqual({ value: 1 })
    expect(calls[1]).toEqual({ value: 2 })
  })

  test('non-persistent events are not queued', async () => {
    const queueDir = path.resolve('.queue', 'events')
    const queuePath = path.join(queueDir, 'queue.json')
    const bus = createEventBus({ resolve: ((name: string) => name) as any })

    await bus.emit('demo', { id: 1 }) // Non-persistent

    // Queue file should not exist or be empty
    if (fs.existsSync(queuePath)) {
      const list = readJson(queuePath)
      expect(list.length).toBe(0)
    }
  })
})
