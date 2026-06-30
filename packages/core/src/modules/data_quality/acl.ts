export const features = [
  { id: 'data_quality.view', title: 'View data quality overview', module: 'data_quality' },
  { id: 'data_quality.check.view', title: 'View data quality checks', module: 'data_quality' },
  {
    id: 'data_quality.check.manage',
    title: 'Manage data quality checks',
    module: 'data_quality',
    dependsOn: ['data_quality.check.view'],
  },
  { id: 'data_quality.suite.view', title: 'View data quality suites', module: 'data_quality' },
  {
    id: 'data_quality.suite.manage',
    title: 'Manage data quality suites',
    module: 'data_quality',
    dependsOn: ['data_quality.suite.view'],
  },
  { id: 'data_quality.scan.view', title: 'View data quality scans', module: 'data_quality' },
  {
    id: 'data_quality.scan.run',
    title: 'Run data quality scans',
    module: 'data_quality',
    dependsOn: ['data_quality.scan.view'],
  },
  { id: 'data_quality.finding.view', title: 'View data quality findings', module: 'data_quality' },
  {
    id: 'data_quality.finding.manage',
    title: 'Manage data quality findings',
    module: 'data_quality',
    dependsOn: ['data_quality.finding.view'],
  },
]

export default features
