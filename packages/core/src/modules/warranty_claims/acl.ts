export const features = [
  { id: 'warranty_claims.claim.view', title: 'View warranty claims', module: 'warranty_claims' },
  {
    id: 'warranty_claims.claim.create',
    title: 'Create warranty claims',
    module: 'warranty_claims',
    dependsOn: ['warranty_claims.claim.view'],
  },
  {
    id: 'warranty_claims.claim.manage',
    title: 'Manage warranty claims',
    module: 'warranty_claims',
    dependsOn: ['warranty_claims.claim.view'],
  },
  {
    id: 'warranty_claims.claim.delete',
    title: 'Delete warranty claims',
    module: 'warranty_claims',
    dependsOn: ['warranty_claims.claim.manage'],
  },
  {
    id: 'warranty_claims.settings.manage',
    title: 'Manage warranty claim settings',
    module: 'warranty_claims',
    dependsOn: ['warranty_claims.claim.manage'],
  },
  {
    id: 'warranty_claims.external.submit',
    title: 'Submit external warranty claims',
    module: 'warranty_claims',
    dependsOn: ['warranty_claims.claim.create'],
  },
  {
    id: 'warranty_claims.external.view',
    title: 'View external warranty claims',
    module: 'warranty_claims',
    dependsOn: ['warranty_claims.claim.view'],
  },
  {
    id: 'warranty_claims.registration.view',
    title: 'View warranty registrations',
    module: 'warranty_claims',
    dependsOn: ['warranty_claims.claim.view'],
  },
  {
    id: 'warranty_claims.registration.manage',
    title: 'Manage warranty registrations',
    module: 'warranty_claims',
    dependsOn: ['warranty_claims.registration.view'],
  },
  {
    id: 'warranty_claims.vendor_policy.manage',
    title: 'Manage warranty vendor policies',
    module: 'warranty_claims',
    dependsOn: ['warranty_claims.claim.manage'],
  },
  {
    id: 'warranty_claims.troubleshooting.manage',
    title: 'Manage warranty troubleshooting guides',
    module: 'warranty_claims',
    dependsOn: ['warranty_claims.settings.manage'],
  },
  {
    id: 'warranty_claims.receiving.manage',
    title: 'Manage warranty receiving and grading',
    module: 'warranty_claims',
    dependsOn: ['warranty_claims.claim.manage'],
  },
]

export default features
