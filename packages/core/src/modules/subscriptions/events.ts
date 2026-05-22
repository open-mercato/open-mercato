import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'subscriptions.access.changed', label: 'Subscription Access Changed', category: 'lifecycle', entity: 'subscription' },
  { id: 'subscriptions.plan.synced', label: 'Subscription Plan Synced', category: 'system', entity: 'plan', excludeFromTriggers: true },
] as const

export const eventsConfig = createModuleEvents({ moduleId: 'subscriptions', events })
export const emitSubscriptionsEvent = eventsConfig.emit
export type SubscriptionsEventId = typeof events[number]['id']
export default eventsConfig
