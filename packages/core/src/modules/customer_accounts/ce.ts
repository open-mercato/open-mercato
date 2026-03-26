export const entities = [
  {
    id: 'customer_accounts:customer_user',
    label: 'Customer User',
    description: 'A customer-facing user account linked to CRM person/company entities.',
    labelField: 'displayName',
    showInSidebar: false,
    defaultEditor: false,
    fields: [],
  },
  {
    id: 'customer_accounts:customer_role',
    label: 'Customer Role',
    description: 'A role definition for customer portal access control.',
    labelField: 'name',
    showInSidebar: false,
    defaultEditor: false,
    fields: [],
  },
]

export default entities
