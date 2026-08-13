// Module-level features declaration for RBAC
export const features = [
  { id: 'auth.users.list', title: 'List users', module: 'auth' },
  {
    id: 'auth.users.create',
    title: 'Create users',
    module: 'auth',
    dependsOn: ['auth.users.list'],
  },
  {
    id: 'auth.users.edit',
    title: 'Edit users',
    module: 'auth',
    dependsOn: ['auth.users.list'],
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
  // Refined away from the spec's proposed `auth.roles.list` dependency: the
  // sidebar customization surface serves its own role targets from
  // /api/auth/sidebar/preferences, gated on auth.sidebar.manage alone, and never
  // calls /api/auth/roles. See .ai/specs/2026-05-27-acl-dependency-bundles.md §6.4.
  { id: 'auth.sidebar.manage', title: 'Manage sidebar presets', module: 'auth' },
]

export default features
