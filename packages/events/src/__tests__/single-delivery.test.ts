import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { createEventBus } from '@open-mercato/events/index'
import type { SubscriberDescriptor } from '@open-mercato/events/types'

/**
 * Regression coverage for issue #2960: persistent subscribers must run on
 * exactly one path under the OM_EVENTS_SINGLE_DELIVERY flag, and the default-off
 * behavior must be preserved byte-for-byte.
 */
describe('Event bus single-delivery (OM_EVENTS_SINGLE_DELIVERY)', () => {
  const origCwd = process.cwd()
  const origFlag = process.env.OM_EVENTS_SINGLE_DELIVERY
  let tmp: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'events-single-delivery-'))
    process.chdir(tmp)
    delete process.env.QUEUE_STRATEGY
    delete process.env.EVENTS_STRATEGY
  })

  afterEach(() => {
    process.chdir(origCwd)
    if (origFlag === undefined) delete process.env.OM_EVENTS_SINGLE_DELIVERY
    else process.env.OM_EVENTS_SINGLE_DELIVERY = origFlag
    try { fs.rmSync(tmp, { recursive: true, force: true }) } catch {}
  })

  function makeSub(
    id: string,
    event: string,
    persistent: boolean,
    sink: string[],
  ): SubscriberDescriptor {
    return { id, event, persistent, handler: () => { sink.push(id) } }
  }

  test('default (unset): a persistent subscriber is skipped inline (single-delivery is default-on)', async () => {
    delete process.env.OM_EVENTS_SINGLE_DELIVERY
    const calls: string[] = []
    const bus = createEventBus({ resolve: ((name: string) => name) as never })
    bus.registerModuleSubscribers([
      makeSub('persistent-sub', 'demo', true, calls),
      makeSub('ephemeral-sub', 'demo', false, calls),
    ])

    await bus.emit('demo', { a: 1 }, { persistent: true })

    // Default-on: the persistent subscriber is deferred to the worker; only the
    // ephemeral subscriber runs inline.
    expect(calls).toEqual(['ephemeral-sub'])
  })

  test('flag explicitly OFF (legacy opt-out): a persistent subscriber still runs inline', async () => {
    process.env.OM_EVENTS_SINGLE_DELIVERY = 'false'
    const calls: string[] = []
    const bus = createEventBus({ resolve: ((name: string) => name) as never })
    bus.registerModuleSubscribers([makeSub('persistent-sub', 'demo', true, calls)])

    await bus.emit('demo', { a: 1 }, { persistent: true })

    // Legacy dual-dispatch: inline delivery is preserved when explicitly opted out.
    expect(calls).toEqual(['persistent-sub'])
  })

  test('flag ON: a persistent subscriber is skipped inline (deferred to the worker)', async () => {
    process.env.OM_EVENTS_SINGLE_DELIVERY = 'true'
    const calls: string[] = []
    const bus = createEventBus({ resolve: ((name: string) => name) as never })
    bus.registerModuleSubscribers([
      makeSub('persistent-sub', 'demo', true, calls),
      makeSub('ephemeral-sub', 'demo', false, calls),
    ])

    await bus.emit('demo', { a: 1 }, { persistent: true })

    // Only the ephemeral subscriber runs inline; the persistent one is dispatched
    // by the events worker from the queue, so it is skipped here.
    expect(calls).toEqual(['ephemeral-sub'])
  })

  test('flag ON: a non-persistent emit still delivers persistent subscribers inline', async () => {
    process.env.OM_EVENTS_SINGLE_DELIVERY = 'true'
    const calls: string[] = []
    const bus = createEventBus({ resolve: ((name: string) => name) as never })
    bus.registerModuleSubscribers([makeSub('persistent-sub', 'demo', true, calls)])

    // Non-persistent emit is never enqueued, so inline delivery is the only path.
    await bus.emit('demo', { a: 1 })

    expect(calls).toEqual(['persistent-sub'])
  })

  test('flag ON: persistent emit is still enqueued for the worker', async () => {
    process.env.OM_EVENTS_SINGLE_DELIVERY = 'true'
    const queuePath = path.join(path.resolve('.mercato/queue', 'events'), 'queue.json')
    const calls: string[] = []
    const bus = createEventBus({ resolve: ((name: string) => name) as never })
    bus.registerModuleSubscribers([makeSub('persistent-sub', 'demo', true, calls)])

    await bus.emit('demo', { a: 1 }, { persistent: true })

    expect(calls).toEqual([])
    const list = JSON.parse(fs.readFileSync(queuePath, 'utf8'))
    expect(Array.isArray(list)).toBe(true)
    expect(list.length).toBeGreaterThanOrEqual(1)
  })
})

/**
 * Regression coverage for the onboarding stall: `enqueueQueryIndexRebuild` emits
 * a persistent `query_index.reindex` with `deliverInline: false` so the heavy
 * rebuild runs solely in the events worker, never inline in the onboarding
 * request. A bare `{ persistent: true }` dual-dispatches and ran the reindex
 * inline (reusing the request's committed em), which is exactly the bug.
 */
describe('Event bus enqueue-only persistent emit (deliverInline: false)', () => {
  const origCwd = process.cwd()
  const origFlag = process.env.OM_EVENTS_SINGLE_DELIVERY
  let tmp: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'events-enqueue-only-'))
    process.chdir(tmp)
    delete process.env.QUEUE_STRATEGY
    delete process.env.EVENTS_STRATEGY
    // Prove the skip is driven by deliverInline, not the single-delivery flag.
    delete process.env.OM_EVENTS_SINGLE_DELIVERY
  })

  afterEach(() => {
    process.chdir(origCwd)
    if (origFlag === undefined) delete process.env.OM_EVENTS_SINGLE_DELIVERY
    else process.env.OM_EVENTS_SINGLE_DELIVERY = origFlag
    try { fs.rmSync(tmp, { recursive: true, force: true }) } catch {}
  })

  function pushHandler(id: string, event: string, persistent: boolean, sink: string[]): SubscriberDescriptor {
    return { id, event, persistent, handler: () => { sink.push(id) } }
  }

  test('skips inline delivery of every subscriber but still enqueues for the worker', async () => {
    const queuePath = path.join(path.resolve('.mercato/queue', 'events'), 'queue.json')
    const calls: string[] = []
    const bus = createEventBus({ resolve: ((name: string) => name) as never })
    bus.registerModuleSubscribers([
      pushHandler('persistent-sub', 'query_index.reindex', true, calls),
      pushHandler('ephemeral-sub', 'query_index.reindex', false, calls),
    ])

    await bus.emit('query_index.reindex', { entityType: 'catalog:product' }, { persistent: true, deliverInline: false })

    // Nothing ran inline — the worker is the sole dispatcher.
    expect(calls).toEqual([])
    const list = JSON.parse(fs.readFileSync(queuePath, 'utf8'))
    expect(Array.isArray(list)).toBe(true)
    expect(list.length).toBeGreaterThanOrEqual(1)
  })

  test('deliverInline: false has no effect on a non-persistent emit', async () => {
    const calls: string[] = []
    const bus = createEventBus({ resolve: ((name: string) => name) as never })
    bus.registerModuleSubscribers([pushHandler('sub', 'demo', false, calls)])

    // Not persistent → nothing is enqueued, so inline is the only path and runs.
    await bus.emit('demo', { a: 1 }, { deliverInline: false })

    expect(calls).toEqual(['sub'])
  })

  test('deliverInline unset under legacy opt-out preserves inline dual-dispatch', async () => {
    // Isolate the deliverInline default from the single-delivery default by
    // explicitly opting out: a persistent emit with deliverInline unset still
    // runs inline (legacy dual-dispatch).
    process.env.OM_EVENTS_SINGLE_DELIVERY = 'false'
    const calls: string[] = []
    const bus = createEventBus({ resolve: ((name: string) => name) as never })
    bus.registerModuleSubscribers([pushHandler('persistent-sub', 'demo', true, calls)])

    await bus.emit('demo', { a: 1 }, { persistent: true })

    expect(calls).toEqual(['persistent-sub'])
  })
})
