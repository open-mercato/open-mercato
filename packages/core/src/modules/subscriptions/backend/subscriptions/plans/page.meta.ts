export const metadata = {
  requireAuth: true,
  requireFeatures: ['subscriptions.admin'],
  pageTitle: 'Subscription Plans',
  pageTitleKey: 'subscriptions.plans.title',
  pageGroup: 'Billing',
  pageGroupKey: 'subscriptions.nav.group',
  pagePriority: 60,
  pageOrder: 110,
  breadcrumb: [
    { label: 'Subscriptions', labelKey: 'subscriptions.nav.title', href: '/backend/subscriptions' },
    { label: 'Plans', labelKey: 'subscriptions.nav.plans' },
  ],
}
