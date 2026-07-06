import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'eudr.product_mapping.created', label: 'EUDR Product Mapping Created', entity: 'product_mapping', category: 'crud' },
  { id: 'eudr.product_mapping.updated', label: 'EUDR Product Mapping Updated', entity: 'product_mapping', category: 'crud' },
  { id: 'eudr.product_mapping.deleted', label: 'EUDR Product Mapping Deleted', entity: 'product_mapping', category: 'crud' },
  { id: 'eudr.evidence_submission.created', label: 'EUDR Evidence Submission Created', entity: 'evidence_submission', category: 'crud' },
  { id: 'eudr.evidence_submission.updated', label: 'EUDR Evidence Submission Updated', entity: 'evidence_submission', category: 'crud' },
  { id: 'eudr.evidence_submission.deleted', label: 'EUDR Evidence Submission Deleted', entity: 'evidence_submission', category: 'crud' },
  { id: 'eudr.due_diligence_statement.created', label: 'EUDR Due Diligence Statement Created', entity: 'due_diligence_statement', category: 'crud' },
  { id: 'eudr.due_diligence_statement.updated', label: 'EUDR Due Diligence Statement Updated', entity: 'due_diligence_statement', category: 'crud' },
  { id: 'eudr.due_diligence_statement.deleted', label: 'EUDR Due Diligence Statement Deleted', entity: 'due_diligence_statement', category: 'crud' },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'eudr',
  events,
})

export const emitEudrEvent = eventsConfig.emit

export type EudrEventId = typeof events[number]['id']

export default eventsConfig
