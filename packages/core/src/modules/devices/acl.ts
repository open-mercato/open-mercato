export const features = [
  { id: 'devices.view', title: 'View own devices', module: 'devices' },
  { id: 'devices.manage', title: 'Manage own devices', module: 'devices' },
  {
    id: 'devices.admin',
    title: 'Manage devices across users',
    module: 'devices',
    // Managing devices across users means naming the owner, and the admin screens name them by
    // person rather than by UUID: the register form's owner picker and the owner column on both
    // list and detail resolve through `GET /api/auth/users`, which `auth.users.list` gates.
    dependsOn: ['auth.users.list'],
  },
]

export default features
