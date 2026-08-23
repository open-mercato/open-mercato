// Module-level features declaration for RBAC
export const features = [
  { id: 'auth.users.list', title: 'List users', module: 'auth' },
  {
    id: 'auth.users.create',
    title: 'Create users',
    module: 'auth',
    dependsOn: ['auth.users.list', 'auth.roles.list', 'directory.organizations.view'],
  },
  {
    id: 'auth.users.edit',
    title: 'Edit users',
    module: 'auth',
    dependsOn: ['auth.users.list', 'auth.roles.list'],
  },
  {
    id: 'auth.users.delete',
    title: 'Delete users',
    module: 'auth',
    dependsOn: ['auth.users.list'],
  },
  { id: 'auth.roles.list', title: 'List roles', module: 'auth' },
  {
    id: 'auth.roles.manage',
    title: 'Manage roles',
    module: 'auth',
    dependsOn: ['auth.roles.list'],
  },
  {
    id: 'auth.acl.manage',
    title: 'Manage ACLs',
    module: 'auth',
    dependsOn: ['auth.users.list', 'auth.roles.list'],
  },
  { id: 'auth.sidebar.manage', title: 'Manage sidebar presets', module: 'auth' },
]

export default features
