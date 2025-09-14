export type EventPayload = any

export type SubscriberMeta = {
  event: string
  persistent?: boolean
  id?: string
}

export type SubscriberContext = {
  resolve: <T = any>(name: string) => T
}

export type SubscriberHandler = (payload: EventPayload, ctx: SubscriberContext) => Promise<void> | void

export type SubscriberDescriptor = {
  id: string
  event: string
  persistent?: boolean
  handler: SubscriberHandler
}

export type QueuedEvent = {
  id: number
  event: string
  payload: EventPayload
  persistent?: boolean
  createdAt: string
}

export type EventStrategy = {
  emit: (evt: Omit<QueuedEvent, 'id' | 'createdAt'> & { createdAt?: string }) => Promise<void>
  on: (event: string, handler: SubscriberHandler) => void
  registerModuleSubscribers: (subs: SubscriberDescriptor[]) => void
  processOffline: (opts?: { limit?: number }) => Promise<{ processed: number; lastId?: number }>
}

export type EventBus = EventStrategy & {
  emitEvent: (event: string, payload: EventPayload, opts?: { persistent?: boolean }) => Promise<void>
}

