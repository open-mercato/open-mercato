export const features = [
  { id: 'example.backend', title: 'Access example backend', module: 'example' },
  // ACL override probe. Nothing gates on it, so it stays inert wherever it is granted.
  // `apps/mercato/src/modules.ts` nulls it through `entry.overrides.acl.features` so
  // TC-AUTH-055 can assert that a nulled feature stays denied for literal, wildcard and
  // super-admin grants. It must remain declared here — an override naming an undeclared
  // feature is skipped as stale and logs a warning on every module registration.
  { id: 'example.manage', title: 'Manage example (override probe)', module: 'example' },
  { id: 'example.view', title: 'View example enrichments', module: 'example' },
  { id: 'example.todos.view', title: 'View todos', module: 'example' },
  {
    id: 'example.todos.manage',
    title: 'Manage todos',
    module: 'example',
    dependsOn: ['example.todos.view'],
  },
  {
    id: 'example.widgets.injection',
    title: 'Use injection widgets',
    module: 'example',
    dependsOn: ['example.view'],
  },
  {
    id: 'example.widgets.todo',
    title: 'Use dashboard todo widget',
    module: 'example',
    dependsOn: ['example.todos.view'],
  },
  {
    id: 'example.widgets.welcome',
    title: 'Use dashboard welcome widget',
    module: 'example',
    dependsOn: ['example.view'],
  },
  {
    id: 'example.widgets.notes',
    title: 'Use dashboard notes widget',
    module: 'example',
    dependsOn: ['example.view'],
  },
]

export default features
