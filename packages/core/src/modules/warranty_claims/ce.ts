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
  {
    id: 'warranty_claims:warranty_claim_registration',
    label: 'Warranty Registration',
    description: 'Product/serial registration = entitlement base.',
    labelField: 'serialNumber',
    showInSidebar: false,
    fields: [],
  },
  {
    id: 'warranty_claims:warranty_vendor_policy',
    label: 'Warranty Vendor Policy',
    description: 'Per-vendor warranty policy for supplier recovery.',
    labelField: 'vendorName',
    showInSidebar: false,
    fields: [],
  },
  {
    id: 'warranty_claims:warranty_troubleshooting_guide',
    label: 'Warranty Troubleshooting Guide',
    description: 'Guided troubleshooting decision tree.',
    labelField: 'title',
    showInSidebar: false,
    fields: [],
  },
]

export default entities
