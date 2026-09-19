import { createModuleEvents } from '@open-mercato/shared/modules/events'

/**
 * Markets module events.
 *
 * `clientBroadcast` is on so an open browser tab picks up a market change over SSE instead of
 * showing yesterday's formats until someone reloads.
 */
const events = [
  {
    id: 'markets.market_display_profile.created',
    label: 'Market Display Profile Created',
    entity: 'market_display_profile',
    category: 'crud',
    clientBroadcast: true,
  },
  {
    id: 'markets.market_display_profile.updated',
    label: 'Market Display Profile Updated',
    entity: 'market_display_profile',
    category: 'crud',
    clientBroadcast: true,
  },
  {
    id: 'markets.market_display_profile.deleted',
    label: 'Market Display Profile Deleted',
    entity: 'market_display_profile',
    category: 'crud',
    clientBroadcast: true,
  },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'markets',
  events,
})

export const emitMarketsEvent = eventsConfig.emit

export type MarketsEventId = typeof events[number]['id']

export default eventsConfig
