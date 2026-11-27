/**
 * Module emitters dispatch on the event bus of the current request scope.
 *
 * Every request container bootstraps its own bus and parks it as the global
 * bus, so emitting through the global bus ran subscribers against whichever
 * container was built last in the process — under concurrency, another
 * request's (#2963). Inside a request scope the emitter must use the bus of
 * the container built in that scope; outside a scope it keeps the global bus.
 */

import {
  bindRequestScopeContainer,
  runInRequestScope,
  type RequestScopeContainer,
} from '../../../lib/di/request-scope'
import { createModuleEvents, setGlobalEventBus } from '../factory'

type RecordedEmit = { bus: string; eventId: string; payload: unknown }

const emitted: RecordedEmit[] = []

function makeBus(label: string) {
  return {
    emit: async (eventId: string, payload: unknown) => {
      emitted.push({ bus: label, eventId, payload })
    },
  }
}

function makeContainer(bus: unknown): RequestScopeContainer {
  return {
    resolve: <T = unknown>(name: string): T => {
      if (name === 'eventBus') return bus as T
      throw new Error(`[internal] unexpected resolve of ${name}`)
    },
  }
}

function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

const eventsConfig = createModuleEvents({
  moduleId: 'scoped_emit_test',
  events: [
    { id: 'scoped_emit_test.widget.created', label: 'Widget Created', entity: 'widget', category: 'crud' },
  ] as const,
})

const EVENT_ID = 'scoped_emit_test.widget.created'

describe('createModuleEvents emit inside a request scope', () => {
  beforeEach(() => {
    emitted.length = 0
    setGlobalEventBus(makeBus('global'))
  })

  it('uses the global bus outside any request scope', async () => {
    await eventsConfig.emit(EVENT_ID, { id: 'outside' })
    expect(emitted).toEqual([{ bus: 'global', eventId: EVENT_ID, payload: { id: 'outside' } }])
  })

  it('uses the global bus inside a scope that has no container yet', async () => {
    await runInRequestScope(() => eventsConfig.emit(EVENT_ID, { id: 'unbound' }))
    expect(emitted.map((entry) => entry.bus)).toEqual(['global'])
  })

  it('uses the bus of the container bound to the scope', async () => {
    await runInRequestScope(async () => {
      bindRequestScopeContainer(makeContainer(makeBus('request-a')))
      await eventsConfig.emit(EVENT_ID, { id: 'a' })
    })
    expect(emitted.map((entry) => entry.bus)).toEqual(['request-a'])
  })

  it('falls back to the global bus when the scoped container cannot resolve one', async () => {
    await runInRequestScope(async () => {
      bindRequestScopeContainer({
        resolve: () => {
          throw new Error('[internal] eventBus not registered')
        },
      })
      await eventsConfig.emit(EVENT_ID, { id: 'throws' })
    })
    await runInRequestScope(async () => {
      bindRequestScopeContainer(makeContainer({ notABus: true }))
      await eventsConfig.emit(EVENT_ID, { id: 'invalid' })
    })
    expect(emitted.map((entry) => entry.bus)).toEqual(['global', 'global'])
  })

  it('keeps concurrent requests on their own bus even after another request re-parks the global bus', async () => {
    const requestA = runInRequestScope(async () => {
      const busA = makeBus('request-a')
      bindRequestScopeContainer(makeContainer(busA))
      setGlobalEventBus(busA)
      await tick()
      await tick()
      await eventsConfig.emit(EVENT_ID, { id: 'a' })
    })
    const requestB = runInRequestScope(async () => {
      await tick()
      const busB = makeBus('request-b')
      bindRequestScopeContainer(makeContainer(busB))
      setGlobalEventBus(busB)
      await eventsConfig.emit(EVENT_ID, { id: 'b' })
    })
    await Promise.all([requestA, requestB])
    const byPayloadId = Object.fromEntries(
      emitted.map((entry) => [(entry.payload as { id: string }).id, entry.bus]),
    )
    expect(byPayloadId).toEqual({ a: 'request-a', b: 'request-b' })
  })
})
