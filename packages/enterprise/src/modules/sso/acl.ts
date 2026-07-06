export const features = [
  { id: 'sso.config.view', title: 'View SSO configuration', module: 'sso' },
  {
    id: 'sso.config.manage',
    title: 'Manage SSO configuration',
    module: 'sso',
    dependsOn: ['sso.config.view'],
  },
  {
    id: 'sso.scim.manage',
    title: 'Manage SCIM provisioning tokens',
    module: 'sso',
    dependsOn: ['sso.config.manage'],
  },
]

export default features
