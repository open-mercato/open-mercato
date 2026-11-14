import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'legal_review.matter.created', label: 'Legal Matter Created', entity: 'matter', category: 'crud' },
  { id: 'legal_review.matter.updated', label: 'Legal Matter Updated', entity: 'matter', category: 'crud' },
  { id: 'legal_review.matter.deleted', label: 'Legal Matter Deleted', entity: 'matter', category: 'crud' },
  { id: 'legal_review.matter.released', label: 'Legal Matter Released', entity: 'matter', category: 'lifecycle' },
] as const

export const eventsConfig = createModuleEvents({ moduleId: 'legal_review', events })
export const emitLegalReviewEvent = eventsConfig.emit
export default eventsConfig
