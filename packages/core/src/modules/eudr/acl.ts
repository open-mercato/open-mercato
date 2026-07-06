export const features = [
  { id: 'eudr.mappings.view', title: 'View EUDR mappings', module: 'eudr' },
  {
    id: 'eudr.mappings.manage',
    title: 'Manage EUDR mappings',
    module: 'eudr',
    dependsOn: ['eudr.mappings.view'],
  },
  { id: 'eudr.submissions.view', title: 'View EUDR submissions', module: 'eudr' },
  {
    id: 'eudr.submissions.manage',
    title: 'Manage EUDR submissions',
    module: 'eudr',
    dependsOn: ['eudr.submissions.view'],
  },
  { id: 'eudr.statements.view', title: 'View EUDR statements', module: 'eudr' },
  {
    id: 'eudr.statements.manage',
    title: 'Manage EUDR statements',
    module: 'eudr',
    dependsOn: ['eudr.statements.view'],
  },
]

export default features
