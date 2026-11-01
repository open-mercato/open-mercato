export const features = [
  { id: 'checkout.view', title: 'View checkout links and transactions', module: 'checkout' },
  {
    id: 'checkout.create',
    title: 'Create checkout links and templates',
    module: 'checkout',
    dependsOn: ['checkout.view', 'sales.orders.view', 'customers.people.view'],
  },
  {
    id: 'checkout.edit',
    title: 'Edit checkout links and templates',
    module: 'checkout',
    dependsOn: ['checkout.view'],
  },
  {
    id: 'checkout.delete',
    title: 'Delete checkout links and templates',
    module: 'checkout',
    dependsOn: ['checkout.view'],
  },
  {
    id: 'checkout.viewPii',
    title: 'View checkout customer PII',
    module: 'checkout',
    dependsOn: ['checkout.view', 'customers.people.view'],
  },
  {
    id: 'checkout.export',
    title: 'Export checkout transactions',
    module: 'checkout',
    dependsOn: ['checkout.view'],
  },
  // Release 5, Step 2.12 (B.1, §9.1/C25, D-R5-34). Buyer `/sessions/current/*` routes are
  // not ACL-gated (token-bound, §9.0) — only the admin surface needs features.
  {
    id: 'checkout.sessions.view',
    title: 'View checkout sessions',
    module: 'checkout',
    dependsOn: ['checkout.view'],
  },
  {
    id: 'checkout.sessions.manage',
    title: 'Manage checkout sessions (force-expire, force re-price)',
    module: 'checkout',
    dependsOn: ['checkout.sessions.view'],
  },
]

export default features
