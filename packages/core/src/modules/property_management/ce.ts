export const entities = [
  {
    id: 'property_management:building',
    label: 'Building',
    description: 'A building managed in Property Management.',
    labelField: 'name',
    showInSidebar: false,
    fields: [],
  },
  {
    id: 'property_management:unit',
    label: 'Unit',
    description: 'A leasable or bookable unit on a floor.',
    labelField: 'name',
    showInSidebar: false,
    fields: [],
  },
  {
    id: 'property_management:lease',
    label: 'Lease',
    description: 'A lease of a unit.',
    labelField: 'reference',
    showInSidebar: false,
    fields: [],
  },
]

export default entities
