import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { createEventBus } from '@open-mercato/events/index'

function readJson(p: string) { return JSON.parse(fs.readFileSync(p, 'utf8')) }

describe('Event bus - local strategy', () => {
  const origCwd = process.cwd()
  let tmp: string
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'events-test-'))
    process.chdir(tmp)
    delete process.env.EVENTS_STRATEGY
  })
  afterEach(() => {
    process.chdir(origCwd)
    try { fs.rmSync(tmp, { recursive: true, force: true }) } catch {}
  })

  test('online delivery via on + emitEvent', async () => {
    const calls: any[] = []
    const bus = createEventBus({ resolve: ((name: string) => name) as any })
    bus.on('demo', async (payload, ctx) => { calls.push({ payload, resolved: ctx.resolve('em') }) })
    await bus.emitEvent('demo', { a: 1 })
    expect(calls).toHaveLength(1)
    expect(calls[0].payload).toEqual({ a: 1 })
    expect(calls[0].resolved).toEqual('em')
  })

  test('persistent events recorded and processed offline', async () => {
    const eventsDir = path.resolve('.events')
    const queuePath = path.join(eventsDir, 'queue.json')
    const statePath = path.join(eventsDir, 'state.json')
    const recv: any[] = []
    const bus = createEventBus({ resolve: ((name: string) => name) as any })
    bus.on('queued', (payload) => { recv.push(payload) })
    await bus.emitEvent('queued', { id: 1 }, { persistent: true })
    await bus.emitEvent('queued', { id: 2 }, { persistent: true })
    const list = readJson(queuePath)
    expect(Array.isArray(list)).toBe(true)
    expect(list.length).toBeGreaterThanOrEqual(2)
    const res = await bus.processOffline()
    expect(res.processed).toBeGreaterThanOrEqual(2)
    const state = readJson(statePath)
    expect(state.lastProcessedId).toBeDefined()
  })

  test('clearQueue and clearProcessed', async () => {
    const eventsDir = path.resolve('.events')
    const queuePath = path.join(eventsDir, 'queue.json')
    const bus = createEventBus({ resolve: ((name: string) => name) as any })
    await bus.emitEvent('q', { n: 1 }, { persistent: true })
    await bus.emitEvent('q', { n: 2 }, { persistent: true })
    const before = readJson(queuePath)
    expect(before.length).toBeGreaterThanOrEqual(2)
    const proc = await bus.processOffline({ limit: 1 })
    expect(proc.processed).toBe(1)
    const cp = await bus.clearProcessed()
    expect(cp.removed).toBeGreaterThanOrEqual(1)
    const afterCP = readJson(queuePath)
    expect(afterCP.length).toBeLessThan(before.length)
    const cq = await bus.clearQueue()
    expect(cq.removed).toBeGreaterThanOrEqual(0)
    const after = readJson(queuePath)
    expect(after.length).toBe(0)
  })
})
