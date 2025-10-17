export const entities = [
  {
    id: 'customers:customer_person_profile',
    label: 'Customer Person',
    description: 'Individual contact record within the CRM.',
    labelField: 'displayName',
    showInSidebar: false,
    fields: [],
  },
  {
    id: 'customers:customer_company_profile',
    label: 'Customer Company',
    description: 'Organization or account tracked within the CRM.',
    labelField: 'displayName',
    showInSidebar: false,
    fields: [],
  },
  {
    id: 'customers:customer_deal',
    label: 'Customer Deal',
    description: 'Sales opportunity with value, stage, and close date.',
    labelField: 'title',
    showInSidebar: false,
    fields: [],
  },
  {
    id: 'customers:customer_activity',
    label: 'Customer Activity',
    description: 'Timeline events and touchpoints logged against people or companies.',
    labelField: 'subject',
    showInSidebar: false,
    defaultEditor: 'false',
    fields: [],
  },
]

export default entities
