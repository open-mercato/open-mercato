// Module-level features declaration for RBAC
export const features = [
  { id: 'auth.user.list', title: 'List users', module: 'auth' },
  { id: 'auth.user.create', title: 'Create users', module: 'auth' },
  { id: 'auth.user.edit', title: 'Edit users', module: 'auth' },
  { id: 'auth.user.delete', title: 'Delete users', module: 'auth' },
  { id: 'auth.role.list', title: 'List roles', module: 'auth' },
  { id: 'auth.role.manage', title: 'Manage roles', module: 'auth' },
  { id: 'auth.acl.manage', title: 'Manage ACLs', module: 'auth' },
  { id: 'auth.sidebar.manage', title: 'Manage sidebar presets', module: 'auth' },
]

export default features

