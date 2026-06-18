export const features = [
  { id: 'customers.people.view', title: 'View people', module: 'customers' },
  {
    id: 'customers.people.manage',
    title: 'Manage people',
    module: 'customers',
    dependsOn: ['customers.people.view'],
  },
  { id: 'customers.companies.view', title: 'View companies', module: 'customers' },
  {
    id: 'customers.companies.manage',
    title: 'Manage companies',
    module: 'customers',
    dependsOn: ['customers.companies.view'],
  },
  {
    id: 'customers.deals.view',
    title: 'View deals',
    module: 'customers',
    dependsOn: ['customers.people.view'],
  },
  {
    id: 'customers.deals.manage',
    title: 'Manage deals',
    module: 'customers',
    dependsOn: ['customers.deals.view'],
  },
  { id: 'customers.activities.view', title: 'View activities', module: 'customers' },
  {
    id: 'customers.activities.manage',
    title: 'Manage activities',
    module: 'customers',
    dependsOn: ['customers.activities.view'],
  },
  { id: 'customers.settings.manage', title: 'Manage customer settings', module: 'customers' },
  { id: 'customers.pipelines.view', title: 'View pipelines', module: 'customers' },
  {
    id: 'customers.pipelines.manage',
    title: 'Manage pipelines',
    module: 'customers',
    dependsOn: ['customers.pipelines.view'],
  },
  {
    id: 'customers.widgets.todos',
    title: 'Use customer todos widget',
    module: 'customers',
    dependsOn: ['customers.activities.view'],
  },
  {
    id: 'customers.widgets.next-interactions',
    title: 'Use customer next interactions widget',
    module: 'customers',
    dependsOn: ['customers.interactions.view'],
  },
  {
    id: 'customers.widgets.new-customers',
    title: 'Use customer new customers widget',
    module: 'customers',
    dependsOn: ['customers.people.view'],
  },
  {
    id: 'customers.widgets.new-deals',
    title: 'Use customer new deals widget',
    module: 'customers',
    dependsOn: ['customers.deals.view'],
  },
  { id: 'customers.interactions.view', title: 'View interactions', module: 'customers' },
  {
    id: 'customers.interactions.manage',
    title: 'Manage interactions',
    module: 'customers',
    dependsOn: ['customers.interactions.view'],
  },
  { id: 'customers.roles.view', title: 'View entity roles', module: 'customers' },
  {
    id: 'customers.roles.manage',
    title: 'Manage entity roles',
    module: 'customers',
    dependsOn: ['customers.roles.view'],
  },
  // Email integration (2026-05-27)
  {
    id: 'customers.email.compose',
    title: 'Compose / send emails from CRM',
    module: 'customers',
    dependsOn: ['customers.people.view'],
  },
  // Reserved for a future v2 admin-oversight capability. In v1 the email
  // privacy model is strict owner-only with NO admin bypass, so this feature is
  // declared but INERT — granting it does not unlock other users' private emails
  // (the visibility filter and the visibility-change gate ignore it). See
  // .ai/specs/implemented/2026-05-27-crm-email-integration.md (v1 strict owner-only).
  {
    id: 'customers.email.view_private',
    title: 'View other users\' private emails (reserved — inert in v1)',
    module: 'customers',
    dependsOn: ['customers.interactions.view'],
  },
]

export default features
