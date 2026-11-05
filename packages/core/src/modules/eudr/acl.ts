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
  { id: 'eudr.plots.view', title: 'View EUDR plots', module: 'eudr' },
  {
    id: 'eudr.plots.manage',
    title: 'Manage EUDR plots',
    module: 'eudr',
    dependsOn: ['eudr.plots.view'],
  },
  { id: 'eudr.risk.view', title: 'View EUDR risk assessments', module: 'eudr' },
  {
    id: 'eudr.risk.manage',
    title: 'Manage EUDR risk assessments',
    module: 'eudr',
    dependsOn: ['eudr.risk.view'],
  },
]

export default features
