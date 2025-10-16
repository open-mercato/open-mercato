export const entities = [
  {
    id: 'customers:person',
    label: 'Customer Person',
    description: 'Individual contact record within the CRM.',
    labelField: 'displayName',
    showInSidebar: true,
    fields: [],
  },
  {
    id: 'customers:company',
    label: 'Customer Company',
    description: 'Organization or account tracked within the CRM.',
    labelField: 'displayName',
    showInSidebar: true,
    fields: [],
  },
  {
    id: 'customers:deal',
    label: 'Customer Deal',
    description: 'Sales opportunity with value, stage, and close date.',
    labelField: 'title',
    showInSidebar: true,
    fields: [],
  },
  {
    id: 'customers:activity',
    label: 'Customer Activity',
    description: 'Timeline events and touchpoints logged against people or companies.',
    labelField: 'subject',
    showInSidebar: false,
    defaultEditor: 'markdown',
    fields: [],
  },
]

export default entities
