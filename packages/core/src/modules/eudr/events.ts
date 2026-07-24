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
  { id: 'eudr.plot.created', label: 'EUDR Plot Created', entity: 'plot', category: 'crud' },
  { id: 'eudr.plot.updated', label: 'EUDR Plot Updated', entity: 'plot', category: 'crud' },
  { id: 'eudr.plot.deleted', label: 'EUDR Plot Deleted', entity: 'plot', category: 'crud' },
  { id: 'eudr.risk_assessment.created', label: 'EUDR Risk Assessment Created', entity: 'risk_assessment', category: 'crud' },
  { id: 'eudr.risk_assessment.updated', label: 'EUDR Risk Assessment Updated', entity: 'risk_assessment', category: 'crud' },
  { id: 'eudr.risk_assessment.deleted', label: 'EUDR Risk Assessment Deleted', entity: 'risk_assessment', category: 'crud' },
  { id: 'eudr.mitigation_action.created', label: 'EUDR Mitigation Action Created', entity: 'mitigation_action', category: 'crud' },
  { id: 'eudr.mitigation_action.updated', label: 'EUDR Mitigation Action Updated', entity: 'mitigation_action', category: 'crud' },
  { id: 'eudr.mitigation_action.deleted', label: 'EUDR Mitigation Action Deleted', entity: 'mitigation_action', category: 'crud' },
  { id: 'eudr.due_diligence_statement.submitted', label: 'EUDR Due Diligence Statement Submitted', entity: 'due_diligence_statement', category: 'lifecycle' },
  { id: 'eudr.due_diligence_statement.reference_issued', label: 'EUDR Due Diligence Statement Reference Issued', entity: 'due_diligence_statement', category: 'lifecycle' },
  { id: 'eudr.due_diligence_statement.withdrawn', label: 'EUDR Due Diligence Statement Withdrawn', entity: 'due_diligence_statement', category: 'lifecycle' },
  { id: 'eudr.risk_assessment.concluded', label: 'EUDR Risk Assessment Concluded', entity: 'risk_assessment', category: 'lifecycle' },
  { id: 'eudr.mitigation_action.completed', label: 'EUDR Mitigation Action Completed', entity: 'mitigation_action', category: 'lifecycle' },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'eudr',
  events,
})

export const emitEudrEvent = eventsConfig.emit

export type EudrEventId = typeof events[number]['id']

export default eventsConfig
