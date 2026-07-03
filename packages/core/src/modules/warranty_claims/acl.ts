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
]

export default features
