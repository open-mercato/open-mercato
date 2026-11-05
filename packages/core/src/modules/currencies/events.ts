import { createModuleEvents } from '@open-mercato/shared/modules/events'

/**
 * Currencies Module Events
 *
 * Declares all events that can be emitted by the currencies module.
 */
const events = [
  // Currencies
  { id: 'currencies.currency.created', label: 'Currency Created', entity: 'currency', category: 'crud' },
  { id: 'currencies.currency.updated', label: 'Currency Updated', entity: 'currency', category: 'crud' },
  { id: 'currencies.currency.deleted', label: 'Currency Deleted', entity: 'currency', category: 'crud' },

  // Exchange Rates
  { id: 'currencies.exchange_rate.created', label: 'Exchange Rate Created', entity: 'exchange_rate', category: 'crud' },
  { id: 'currencies.exchange_rate.updated', label: 'Exchange Rate Updated', entity: 'exchange_rate', category: 'crud' },
  { id: 'currencies.exchange_rate.deleted', label: 'Exchange Rate Deleted', entity: 'exchange_rate', category: 'crud' },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'currencies',
  events,
})

/** Type-safe event emitter for currencies module */
export const emitCurrenciesEvent = eventsConfig.emit

/** Event IDs that can be emitted by the currencies module */
export type CurrenciesEventId = typeof events[number]['id']

export default eventsConfig
