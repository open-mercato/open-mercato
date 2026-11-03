import {
  dataTableExtensionHost,
  defineModuleExtensionPoints,
} from '@open-mercato/shared/modules/widgets/extension-points'

export const extensionPoints = defineModuleExtensionPoints({
  moduleId: 'warranty_claims',
  hosts: {
    claimsTable: dataTableExtensionHost({ tableId: 'warranty_claims.claims.list', source: 'backend/page.tsx' }),
    registrationsTable: dataTableExtensionHost({ tableId: 'warranty_claims.registrations.list', source: 'backend/warranty_claims/registrations/page.tsx' }),
    vendorPoliciesTable: dataTableExtensionHost({ tableId: 'warranty_claims.vendor_policies.list', source: 'backend/warranty_claims/vendor-policies/page.tsx' }),
    troubleshootingGuidesTable: dataTableExtensionHost({ tableId: 'warranty_claims.troubleshooting_guides.list', source: 'backend/warranty_claims/troubleshooting-guides/page.tsx' }),
  },
})

export default extensionPoints
