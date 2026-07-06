export const entities = [
  {
    id: 'eudr:eudr_product_mapping',
    label: 'EUDR Product Mapping',
    description: 'Maps a catalog product to an EUDR-regulated commodity.',
    labelField: 'commodity',
    showInSidebar: false,
    fields: [],
  },
  {
    id: 'eudr:eudr_evidence_submission',
    label: 'EUDR Evidence Submission',
    description: 'Supplier origin evidence package for an EUDR commodity.',
    labelField: 'commodity',
    showInSidebar: false,
    fields: [],
  },
  {
    id: 'eudr:eudr_due_diligence_statement',
    label: 'EUDR Due Diligence Statement',
    description: 'Due diligence statement record with EU IS references.',
    labelField: 'title',
    showInSidebar: false,
    fields: [],
  },
]

export default entities
