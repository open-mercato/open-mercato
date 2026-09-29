import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  // Campaign authoring lifecycle
  { id: 'marketing_automation.campaign.created', label: 'Campaign Created', entity: 'campaign', category: 'crud' },
  { id: 'marketing_automation.campaign.updated', label: 'Campaign Updated', entity: 'campaign', category: 'crud' },
  { id: 'marketing_automation.campaign.deleted', label: 'Campaign Deleted', entity: 'campaign', category: 'crud' },
  { id: 'marketing_automation.campaign.saved', label: 'Campaign Graph Saved', entity: 'campaign', category: 'crud' },
  { id: 'marketing_automation.campaign.enabled', label: 'Campaign Enabled', entity: 'campaign', category: 'lifecycle' },
  { id: 'marketing_automation.campaign.disabled', label: 'Campaign Disabled', entity: 'campaign', category: 'lifecycle' },

  // Customer state the module itself maintains, and which a campaign may react to
  { id: 'marketing_automation.customer.score_changed', label: 'Customer Score Changed', entity: 'customer_score', category: 'lifecycle' },

  // A product a customer is waiting for got cheaper
  { id: 'marketing_automation.product.price_dropped', label: 'Watched Product Price Dropped', entity: 'product_watch', category: 'lifecycle' },

  // Somebody arrived on a customer's referral code and then bought something
  { id: 'marketing_automation.referral.converted', label: 'Referral Converted', entity: 'referral', category: 'lifecycle' },

  // Something outside the platform asking a campaign to run
  { id: 'marketing_automation.inbound.received', label: 'Inbound Hook Received', entity: 'inbound_hook', category: 'lifecycle' },

  /**
   * A campaign step asking the outside world to do something.
   *
   * **This is how `send_webhook` works, and the shape is the platform's rather than a choice.** There is no
   * outbound-webhook service to call: the `webhooks` module subscribes to EVERY declared event and delivers it
   * to whichever endpoints an operator subscribed, as `{ type, timestamp, data }`. So a step that emits this is
   * a step that can reach any endpoint, with no new API to design and with the module's retries, signing and
   * delivery log all applying unchanged.
   *
   * The author names a `topic` inside the payload so one endpoint can tell two campaigns apart. `tenantId` in
   * the payload is not decoration either — the outbound dispatcher reads the scope from the payload and silently
   * drops anything without it.
   */
  { id: 'marketing_automation.campaign.signal', label: 'Campaign Signal (outbound webhook)', entity: 'campaign', category: 'lifecycle' },

  // Dispatch lifecycle
  { id: 'marketing_automation.dispatch.skipped', label: 'Dispatch Skipped', entity: 'campaign', category: 'lifecycle' },
  { id: 'marketing_automation.action.executed', label: 'Campaign Action Executed', entity: 'campaign_action', category: 'lifecycle' },
  { id: 'marketing_automation.action.failed', label: 'Campaign Action Failed', entity: 'campaign_action', category: 'lifecycle' },
  { id: 'marketing_automation.scheduled_action.paused', label: 'Action Chain Paused', entity: 'scheduled_action', category: 'lifecycle' },
  { id: 'marketing_automation.scheduled_action.resumed', label: 'Action Chain Resumed', entity: 'scheduled_action', category: 'lifecycle' },
  { id: 'marketing_automation.scheduled_action.dead', label: 'Action Chain Dead-Lettered', entity: 'scheduled_action', category: 'lifecycle' },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'marketing_automation',
  events,
})

/** Type-safe event emitter for the marketing_automation module */
export const emitMarketingAutomationEvent = eventsConfig.emit

/** Event IDs that can be emitted by the marketing_automation module */
export type MarketingAutomationEventId = typeof events[number]['id']

export default eventsConfig
