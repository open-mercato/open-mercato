import { createEventBus } from '@open-mercato/events/index'
import type { SubscriberDescriptor } from '@open-mercato/events/types'

/**
 * `dispatchQueued` is the events worker's only way to reach subscribers. The
 * worker used to keep its own registry built from `getCliModules()`, which is
 * populated exclusively by the `mercato` bin - so a worker started any other way
 * dispatched nothing and completed the job silently. Selection now lives here, on
 * the bus that already holds every registered subscriber, which also guarantees
 * the inline-skip and the worker dispatch read one single-delivery decision.
 */
describe('EventBus.dispatchQueued', () => {
  const origFlag = process.env.OM_EVENTS_SINGLE_DELIVERY

  afterEach(() => {
    if (origFlag === undefined) {
      delete process.env.OM_EVENTS_SINGLE_DELIVERY
    }
    else {
      process.env.OM_EVENTS_SINGLE_DELIVERY = origFlag
    }
  })

  function makeBus(subs: SubscriberDescriptor[]) {
    const bus = createEventBus({ resolve: ((name: string) => name) as never })
    bus.registerModuleSubscribers(subs)
    return bus
  }

  function makeSub(
    id: string,
    event: string,
    persistent: boolean,
    sink: string[],
  ): SubscriberDescriptor {
    return { id, event, persistent, handler: () => { sink.push(id) } }
  }

  test('single-delivery on: pattern-matches and keeps persistent subscribers only', async () => {
    process.env.OM_EVENTS_SINGLE_DELIVERY = 'true'
    const calls: string[] = []
    const bus = makeBus([
      makeSub('exact-persistent', 'user.created', true, calls),
      makeSub('exact-ephemeral', 'user.created', false, calls),
      makeSub('wildcard-persistent', '*', true, calls),
      makeSub('wildcard-ephemeral', '*', false, calls),
      makeSub('other-event', 'user.deleted', true, calls),
    ])

    const results = await bus.dispatchQueued('user.created', { id: '1' })

    expect(calls.sort()).toEqual(['exact-persistent', 'wildcard-persistent'])
    expect(results.map((r) => r.subscriberId).sort()).toEqual(['exact-persistent', 'wildcard-persistent'])
    expect(results.every((r) => r.error === undefined)).toBe(true)
  })

  test('single-delivery off: exact-match dispatch of every subscriber for the event', async () => {
    process.env.OM_EVENTS_SINGLE_DELIVERY = 'false'
    const calls: string[] = []
    const bus = makeBus([
      makeSub('exact-persistent', 'user.created', true, calls),
      makeSub('exact-ephemeral', 'user.created', false, calls),
      makeSub('wildcard-persistent', '*', true, calls),
    ])

    await bus.dispatchQueued('user.created', {})

    expect(calls.sort()).toEqual(['exact-ephemeral', 'exact-persistent'])
  })

  test('returns handler failures instead of swallowing them', async () => {
    process.env.OM_EVENTS_SINGLE_DELIVERY = 'true'
    const bus = makeBus([
      {
        id: 'boom',
        event: 'user.created',
        persistent: true,
        handler: () => { throw new Error('handler exploded') },
      },
      { id: 'ok', event: 'user.created', persistent: true, handler: () => {} },
    ])

    const results = await bus.dispatchQueued('user.created', {})

    const failed = results.find((r) => r.subscriberId === 'boom')
    const succeeded = results.find((r) => r.subscriberId === 'ok')
    expect((failed?.error as Error).message).toBe('handler exploded')
    expect(succeeded?.error).toBeUndefined()
  })

  test('reports a rejection with an undefined reason as a failure', async () => {
    // `Promise.allSettled` sets `reason: undefined` for `throw undefined` and
    // `Promise.reject()`, so an outcome inferred from `error !== undefined` would
    // score this as a success and let the worker complete the job.
    process.env.OM_EVENTS_SINGLE_DELIVERY = 'true'
    const bus = makeBus([
      {
        id: 'throws-undefined',
        event: 'user.created',
        persistent: true,
        handler: () => { throw undefined },
      },
      {
        id: 'rejects-undefined',
        event: 'user.created',
        persistent: true,
        handler: () => Promise.reject(),
      },
    ])

    const results = await bus.dispatchQueued('user.created', {})

    expect(results.map((r) => ({ id: r.subscriberId, ok: r.ok })).sort((a, b) => a.id.localeCompare(b.id)))
      .toEqual([
        { id: 'rejects-undefined', ok: false },
        { id: 'throws-undefined', ok: false },
      ])
    expect(results.every((r) => r.error === undefined)).toBe(true)
  })

  test('forwards trusted scope and the concrete event name to wildcard subscribers', async () => {
    process.env.OM_EVENTS_SINGLE_DELIVERY = 'true'
    const seen: Array<Record<string, unknown>> = []
    const bus = makeBus([
      {
        id: 'wildcard',
        event: '*',
        persistent: true,
        handler: (_payload, ctx) => {
          seen.push({
            eventName: ctx.eventName,
            tenantId: ctx.tenantId,
            organizationId: ctx.organizationId,
          })
        },
      },
    ])

    await bus.dispatchQueued('customers.deal.won', {}, { tenantId: 't1', organizationId: 'o1' })

    expect(seen).toEqual([{ eventName: 'customers.deal.won', tenantId: 't1', organizationId: 'o1' }])
  })

  test('falls back to the registered pattern when a subscriber has no id', async () => {
    process.env.OM_EVENTS_SINGLE_DELIVERY = 'true'
    const bus = createEventBus({ resolve: ((name: string) => name) as never })
    bus.on('user.created', () => {}, { persistent: true })

    const results = await bus.dispatchQueued('user.created', {})

    expect(results).toEqual([{ subscriberId: 'user.created', ok: true }])
  })

  test('returns an empty result set when nothing matches', async () => {
    process.env.OM_EVENTS_SINGLE_DELIVERY = 'true'
    const bus = makeBus([makeSub('other', 'user.deleted', true, [])])

    expect(await bus.dispatchQueued('user.created', {})).toEqual([])
  })
})
