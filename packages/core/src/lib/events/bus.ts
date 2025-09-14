import { createLocalStrategy } from './strategies/local'
import { createRedisStrategy } from './strategies/redis'
import type { EventBus, EventPayload, EventStrategy, SubscriberDescriptor, SubscriberHandler } from './types'

export type CreateBusOptions = {
  resolve: <T = any>(name: string) => T
  strategy?: 'local' | 'redis'
}

export function createEventBus(opts: CreateBusOptions): EventBus {
  const listeners = new Map<string, Set<SubscriberHandler>>()

  const deliver = async (event: string, payload: any) => {
    const set = listeners.get(event)
    if (!set || !set.size) return
    for (const h of set) await Promise.resolve(h(payload, { resolve: opts.resolve }))
  }

  const mode = opts.strategy || (process.env.EVENTS_STRATEGY === 'redis' ? 'redis' : 'local')
  const strategy: EventStrategy = mode === 'redis'
    ? createRedisStrategy(process.env.REDIS_URL || process.env.EVENTS_REDIS_URL, deliver)
    : createLocalStrategy(undefined, deliver)

  const on = (event: string, handler: SubscriberHandler) => {
    if (!listeners.has(event)) listeners.set(event, new Set())
    listeners.get(event)!.add(handler)
  }

  const registerModuleSubscribers = (subs: SubscriberDescriptor[]) => {
    for (const s of subs) on(s.event, s.handler)
  }

  const emitEvent = async (event: string, payload: EventPayload, opts2?: { persistent?: boolean }) => {
    await strategy.emit({ event, payload, persistent: opts2?.persistent })
  }

  return {
    emit: strategy.emit,
    on,
    registerModuleSubscribers,
    processOffline: strategy.processOffline,
    clearQueue: strategy.clearQueue,
    clearProcessed: strategy.clearProcessed,
    emitEvent,
  }
}
