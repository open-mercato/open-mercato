export const features = [
  { id: 'security.profile.view', title: 'View security profile', module: 'security' },
  {
    id: 'security.profile.password',
    title: 'Change own password',
    module: 'security',
    dependsOn: ['security.profile.view'],
  },
  {
    id: 'security.profile.manage',
    title: 'Manage security profile',
    module: 'security',
    dependsOn: ['security.profile.view'],
  },
  {
    id: 'security.mfa.manage',
    title: 'Manage MFA settings',
    module: 'security',
    dependsOn: ['security.profile.view'],
  },
  {
    id: 'security.admin.manage',
    title: 'Manage security policies',
    module: 'security',
    dependsOn: ['security.profile.view', 'auth.users.list'],
  },
  { id: 'security.sudo.view', title: 'View sudo protection', module: 'security' },
  {
    id: 'security.sudo.manage',
    title: 'Manage sudo protection',
    module: 'security',
    dependsOn: ['security.sudo.view'],
  },
]

export default features
