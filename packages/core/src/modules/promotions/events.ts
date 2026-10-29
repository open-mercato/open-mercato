import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'promotions.promotion.created', label: 'Promotion Created', entity: 'promotion', category: 'crud' },
  { id: 'promotions.promotion.updated', label: 'Promotion Updated', entity: 'promotion', category: 'crud' },
  { id: 'promotions.promotion.deleted', label: 'Promotion Deleted', entity: 'promotion', category: 'crud' },
  { id: 'promotions.code.created', label: 'Promotional Code Created', entity: 'code', category: 'crud' },
  { id: 'promotions.code.updated', label: 'Promotional Code Updated', entity: 'code', category: 'crud' },
  { id: 'promotions.code.deleted', label: 'Promotional Code Deleted', entity: 'code', category: 'crud' },
  { id: 'promotions.code.used', label: 'Promotional Code Used', entity: 'code', category: 'lifecycle' },
  { id: 'promotions.code.exhausted', label: 'Promotional Code Pool Exhausted', entity: 'code', category: 'lifecycle' },
  { id: 'promotions.generated_code.created', label: 'Generated Codes Batch Created', entity: 'generated_code', category: 'lifecycle' },
  { id: 'promotions.usage.registered', label: 'Promotion Usage Registered', entity: 'usage', category: 'lifecycle' },
  { id: 'promotions.usage.reverted', label: 'Promotion Usage Reverted', entity: 'usage', category: 'lifecycle' },
  { id: 'promotions.promotion.budget_exhausted', label: 'Promotion Budget Exhausted', entity: 'promotion', category: 'lifecycle' },
  { id: 'promotions.promotion.expiring_soon', label: 'Promotion Expiring Soon', entity: 'promotion', category: 'lifecycle' },
  { id: 'promotions.evaluation.completed', label: 'Promotion Evaluation Completed', entity: 'evaluation', category: 'system', excludeFromTriggers: true },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'promotions',
  events,
})

export const emitPromotionsEvent = eventsConfig.emit

export type PromotionsEventId = typeof events[number]['id']

export default eventsConfig
