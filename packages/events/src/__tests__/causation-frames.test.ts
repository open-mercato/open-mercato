import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { createEventBus } from '@open-mercato/events/index'
import handle from '@open-mercato/events/modules/events/workers/events.worker'
import type { EventBus, SubscriberDescriptor } from '@open-mercato/events/types'
import { createQueue } from '@open-mercato/queue/factory'
import {
  getAmbientCausation,
  runWithCausation,
  type CausationEnvelope,
} from '@open-mercato/shared/lib/causation/server'

jest.mock('@open-mercato/queue', () => jest.requireActual('@open-mercato/queue/factory'))

jest.mock('@open-mercato/shared/lib/logger', () => {
  const mocked = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(),
  }
  mocked.child.mockImplementation(() => mocked)
  return { createLogger: jest.fn(() => mocked) }
})

const ENTRY: CausationEnvelope = {
  correlationId: '11111111-1111-4111-8111-111111111111',
  frames: [{ kind: 'user' }],
  causedByLogId: '22222222-2222-4222-8222-222222222222',
}

const POLLER: CausationEnvelope = {
  correlationId: '33333333-3333-4333-8333-333333333333',
  frames: [{ kind: 'system', id: 'poller' }],
}

function makeBus(subscribers: SubscriberDescriptor[] = []): EventBus {
  const bus = createEventBus({ resolve: ((name: string) => name) as never, queueStrategy: 'local' })
  bus.registerModuleSubscribers(subscribers)
  return bus
}

function capturingSubscriber(
  id: string,
  event: string,
  sink: Map<string, CausationEnvelope | null>,
  options: { persistent?: boolean; delayMs?: number } = {},
): SubscriberDescriptor {
  return {
    id,
    event,
    persistent: options.persistent,
    handler: async () => {
      if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs))
      sink.set(id, getAmbientCausation())
    },
  }
}

describe('event bus causation frames', () => {
  const previousCausation = process.env.OM_CAUSATION
  const previousSingleDelivery = process.env.OM_EVENTS_SINGLE_DELIVERY
  const previousCwd = process.cwd()
  let tmp: string

  beforeEach(() => {
    delete process.env.OM_CAUSATION
    delete process.env.OM_EVENTS_SINGLE_DELIVERY
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'events-causation-'))
    process.chdir(tmp)
  })

  afterEach(() => {
    process.chdir(previousCwd)
    try { fs.rmSync(tmp, { recursive: true, force: true }) } catch {}
  })

  afterAll(() => {
    if (previousCausation === undefined) delete process.env.OM_CAUSATION
    else process.env.OM_CAUSATION = previousCausation
    if (previousSingleDelivery === undefined) delete process.env.OM_EVENTS_SINGLE_DELIVERY
    else process.env.OM_EVENTS_SINGLE_DELIVERY = previousSingleDelivery
  })

  describe('inline delivery', () => {
    it('stacks a subscriber frame under the emitting context and restores it afterwards', async () => {
      const seen = new Map<string, CausationEnvelope | null>()
      const bus = makeBus([capturingSubscriber('sales:order-created-notify', 'sales.order.created', seen)])

      const after = await runWithCausation(ENTRY, async () => {
        await bus.emit('sales.order.created', { id: 'order-1', secret: 'payload-value' })
        return getAmbientCausation()
      })

      expect(seen.get('sales:order-created-notify')).toEqual({
        correlationId: ENTRY.correlationId,
        causedByLogId: ENTRY.causedByLogId,
        frames: [{ kind: 'user' }, { kind: 'subscriber', id: 'sales:order-created-notify', ref: 'sales.order.created' }],
      })
      expect(JSON.stringify(seen.get('sales:order-created-notify'))).not.toContain('payload-value')
      expect(after).toEqual(ENTRY)
    })

    it('uses the emitted event name as ref for wildcard subscribers', async () => {
      const seen = new Map<string, CausationEnvelope | null>()
      const bus = makeBus([capturingSubscriber('audit:any', '*', seen)])

      await runWithCausation(ENTRY, () => bus.emit('customers.deal.won', { id: 'deal-1' }))

      expect(seen.get('audit:any')?.frames.at(-1)).toEqual({ kind: 'subscriber', id: 'audit:any', ref: 'customers.deal.won' })
    })

    it('starts a fresh envelope with the subscriber frame when nothing is ambient', async () => {
      const seen = new Map<string, CausationEnvelope | null>()
      const bus = makeBus([capturingSubscriber('search:reindex', 'catalog.product.updated', seen)])

      await bus.emit('catalog.product.updated', { id: 'product-1' })

      const envelope = seen.get('search:reindex')
      expect(envelope?.frames).toEqual([{ kind: 'subscriber', id: 'search:reindex', ref: 'catalog.product.updated' }])
      expect(typeof envelope?.correlationId).toBe('string')
      expect(getAmbientCausation()).toBeNull()
    })

    it('falls back to the module and pattern for subscribers registered without an id', async () => {
      const seen: Array<CausationEnvelope | null> = []
      const bus = makeBus()
      bus.on('sales.order.created', () => { seen.push(getAmbientCausation()) }, { moduleId: 'sales' })
      bus.on('sales.order.*', () => { seen.push(getAmbientCausation()) })

      await bus.emit('sales.order.created', { id: 'order-1' })

      expect(seen.map((envelope) => envelope?.frames.at(-1))).toEqual([
        { kind: 'subscriber', id: 'sales:sales.order.created', ref: 'sales.order.created' },
        { kind: 'subscriber', id: 'sales.order.*', ref: 'sales.order.created' },
      ])
    })

    it('nests frames when a subscriber emits another event', async () => {
      const seen = new Map<string, CausationEnvelope | null>()
      const bus = makeBus()
      bus.registerModuleSubscribers([
        {
          id: 'sales:order-to-invoice',
          event: 'sales.order.created',
          handler: async () => {
            await bus.emit('sales.invoice.created', { id: 'invoice-1' })
          },
        },
        capturingSubscriber('notifications:invoice', 'sales.invoice.created', seen),
      ])

      await runWithCausation(ENTRY, () => bus.emit('sales.order.created', { id: 'order-1' }))

      expect(seen.get('notifications:invoice')?.frames).toEqual([
        { kind: 'user' },
        { kind: 'subscriber', id: 'sales:order-to-invoice', ref: 'sales.order.created' },
        { kind: 'subscriber', id: 'notifications:invoice', ref: 'sales.invoice.created' },
      ])
    })

    it('isolates concurrent emits from different contexts', async () => {
      const seen: Array<{ orderId: string; envelope: CausationEnvelope | null }> = []
      const bus = makeBus([
        {
          id: 'sales:slow',
          event: 'sales.order.created',
          handler: async (payload) => {
            const orderId = String((payload as { id: string }).id)
            await new Promise((resolve) => setTimeout(resolve, orderId === 'order-1' ? 10 : 1))
            seen.push({ orderId, envelope: getAmbientCausation() })
          },
        },
      ])

      await Promise.all([
        runWithCausation(ENTRY, () => bus.emit('sales.order.created', { id: 'order-1' })),
        runWithCausation(POLLER, () => bus.emit('sales.order.created', { id: 'order-2' })),
      ])

      const byOrder = new Map(seen.map((entry) => [entry.orderId, entry.envelope]))
      expect(byOrder.get('order-1')?.correlationId).toBe(ENTRY.correlationId)
      expect(byOrder.get('order-1')?.frames[0]).toEqual({ kind: 'user' })
      expect(byOrder.get('order-2')?.correlationId).toBe(POLLER.correlationId)
      expect(byOrder.get('order-2')?.frames[0]).toEqual({ kind: 'system', id: 'poller' })
    })

    it('keeps logging-and-continuing on a throwing subscriber', async () => {
      const seen = new Map<string, CausationEnvelope | null>()
      const bus = makeBus([
        { id: 'sales:broken', event: 'sales.order.created', handler: () => { throw new Error('[internal] broken') } },
        capturingSubscriber('sales:healthy', 'sales.order.created', seen),
      ])

      await expect(runWithCausation(ENTRY, () => bus.emit('sales.order.created', { id: 'order-1' }))).resolves.toBeUndefined()
      expect(seen.get('sales:healthy')?.frames.at(-1)).toEqual({ kind: 'subscriber', id: 'sales:healthy', ref: 'sales.order.created' })
    })

    it('rethrows the original error when rethrowHandlerErrors is set', async () => {
      const failure = new Error('[internal] broken')
      const bus = makeBus([{ id: 'sales:broken', event: 'sales.order.created', handler: async () => { throw failure } }])

      await expect(
        runWithCausation(ENTRY, () => bus.emit('sales.order.created', { id: 'order-1' }, { rethrowHandlerErrors: true })),
      ).rejects.toBe(failure)
    })

    it('adds no frame when the kill switch is off', async () => {
      process.env.OM_CAUSATION = 'off'
      const seen = new Map<string, CausationEnvelope | null>()
      const bus = makeBus([capturingSubscriber('sales:notify', 'sales.order.created', seen)])

      await bus.emit('sales.order.created', { id: 'order-1' })
      expect(seen.get('sales:notify')).toBeNull()

      await runWithCausation(ENTRY, () => bus.emit('sales.order.created', { id: 'order-2' }))
      expect(seen.get('sales:notify')).toEqual(ENTRY)
    })
  })

  describe('queued delivery', () => {
    it('wraps every dispatched subscriber in its own frame under the restored context', async () => {
      const seen = new Map<string, CausationEnvelope | null>()
      const bus = makeBus([
        capturingSubscriber('webhooks:outbound', '*', seen, { persistent: true, delayMs: 10 }),
        capturingSubscriber('workflows:trigger', 'sales.order.created', seen, { persistent: true, delayMs: 1 }),
      ])

      const results = await runWithCausation(ENTRY, () => bus.dispatchQueued!('sales.order.created', { id: 'order-1' }))

      expect(results).toEqual([
        { subscriberId: 'webhooks:outbound', ok: true },
        { subscriberId: 'workflows:trigger', ok: true },
      ])
      expect(seen.get('webhooks:outbound')?.frames).toEqual([
        { kind: 'user' },
        { kind: 'subscriber', id: 'webhooks:outbound', ref: 'sales.order.created' },
      ])
      expect(seen.get('workflows:trigger')?.frames).toEqual([
        { kind: 'user' },
        { kind: 'subscriber', id: 'workflows:trigger', ref: 'sales.order.created' },
      ])
      expect(seen.get('workflows:trigger')?.correlationId).toBe(ENTRY.correlationId)
    })

    it('returns failures exactly as before, including synchronous throws', async () => {
      const asyncFailure = new Error('[internal] async failure')
      const syncFailure = new Error('[internal] sync failure')
      const bus = makeBus([
        { id: 'sales:async-broken', event: 'sales.order.created', persistent: true, handler: async () => { throw asyncFailure } },
        { id: 'sales:sync-broken', event: 'sales.order.created', persistent: true, handler: () => { throw syncFailure } },
      ])

      const results = await runWithCausation(ENTRY, () => bus.dispatchQueued!('sales.order.created', { id: 'order-1' }))

      expect(results).toEqual([
        { subscriberId: 'sales:async-broken', ok: false, error: asyncFailure },
        { subscriberId: 'sales:sync-broken', ok: false, error: syncFailure },
      ])
    })

    it('round-trips the emitting context through the local queue into the events worker', async () => {
      process.env.OM_EVENTS_SINGLE_DELIVERY = 'true'
      const seen = new Map<string, CausationEnvelope | null>()
      const bus = makeBus([capturingSubscriber('webhooks:outbound', '*', seen, { persistent: true })])

      await runWithCausation(ENTRY, () => bus.emit('sales.order.created', { id: 'order-1' }, { persistent: true }))
      expect(seen.size).toBe(0)

      const queue = createQueue<unknown>('events', 'local')
      const result = await runWithCausation(POLLER, () =>
        queue.process((job, ctx) => handle(job as never, {
          ...ctx,
          resolve: <T = unknown>(name: string): T => {
            if (name === 'eventBus') return bus as unknown as T
            throw new Error(`[internal] No mock for ${name}`)
          },
        }), { limit: 10 }),
      )
      await queue.close()

      expect(result.processed).toBe(1)
      expect(seen.get('webhooks:outbound')).toEqual({
        correlationId: ENTRY.correlationId,
        causedByLogId: ENTRY.causedByLogId,
        frames: [{ kind: 'user' }, { kind: 'subscriber', id: 'webhooks:outbound', ref: 'sales.order.created' }],
      })
    })
  })
})
