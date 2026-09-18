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
  {
    id: 'eudr:eudr_plot',
    label: 'EUDR Plot',
    description: 'Geolocation plot linked to an EUDR supplier.',
    labelField: 'name',
    showInSidebar: false,
    fields: [],
  },
  {
    id: 'eudr:eudr_risk_assessment',
    label: 'EUDR Risk Assessment',
    description: 'Country and supply-chain risk assessment for an EUDR statement.',
    labelField: 'conclusion',
    showInSidebar: false,
    fields: [],
  },
  {
    id: 'eudr:eudr_mitigation_action',
    label: 'EUDR Mitigation Action',
    description: 'Risk mitigation task for an EUDR assessment.',
    labelField: 'title',
    showInSidebar: false,
    fields: [],
  },
]

export default entities
