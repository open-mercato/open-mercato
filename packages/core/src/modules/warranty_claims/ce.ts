export const entities = [
  {
    id: 'warranty_claims:warranty_claim',
    label: 'Warranty Claim',
    description: 'Warranty, return, core-return, or vendor-recovery claim.',
    labelField: 'claimNumber',
    showInSidebar: false,
    fields: [],
  },
  {
    id: 'warranty_claims:warranty_claim_line',
    label: 'Warranty Claim Line',
    description: 'Line-level product, quantity, disposition, and inspection details for a claim.',
    labelField: 'lineNo',
    showInSidebar: false,
    fields: [],
  },
]

export default entities
