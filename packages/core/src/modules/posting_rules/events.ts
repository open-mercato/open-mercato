import { createModuleEvents } from '@open-mercato/shared/modules/events'

/**
 * Posting Rules Engine Module Events
 *
 * Only the standard CRUD events the module's commands and CRUD routes
 * already emit for its two user-editable entities (`runCrudCommandWrite` /
 * `makeCrudRoute` with `module: 'posting_rules'`). The engine itself
 * declares no events of its own: nothing downstream reacts to a
 * reclassification in Phase 1 (spec, Events & Subscribers).
 */
const events = [
  { id: 'posting_rules.cost_center.created', label: 'Cost Centre Created', entity: 'cost_center', category: 'crud' },
  { id: 'posting_rules.cost_center.updated', label: 'Cost Centre Updated', entity: 'cost_center', category: 'crud' },
  { id: 'posting_rules.cost_center.deleted', label: 'Cost Centre Deleted', entity: 'cost_center', category: 'crud' },
  { id: 'posting_rules.default_account_posting_rule.created', label: 'Default Account Posting Rule Created', entity: 'default_account_posting_rule', category: 'crud' },
  { id: 'posting_rules.default_account_posting_rule.updated', label: 'Default Account Posting Rule Updated', entity: 'default_account_posting_rule', category: 'crud' },
  { id: 'posting_rules.default_account_posting_rule.deleted', label: 'Default Account Posting Rule Deleted', entity: 'default_account_posting_rule', category: 'crud' },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'posting_rules',
  events,
})

export const emitPostingRulesEvent = eventsConfig.emit

export type PostingRulesEventId = typeof events[number]['id']

export default eventsConfig
