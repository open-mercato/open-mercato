export const metadata = {
  requireAuth: true,
  requireFeatures: ['subscriptions.admin'],
  pageTitle: 'Subscription',
  pageTitleKey: 'subscriptions.detail.title',
  pageGroup: 'Billing',
  pageGroupKey: 'subscriptions.nav.group',
  breadcrumb: [
    { label: 'Subscriptions', labelKey: 'subscriptions.nav.title', href: '/backend/subscriptions' },
    { label: 'Subscription detail', labelKey: 'subscriptions.detail.title' },
  ],
}
