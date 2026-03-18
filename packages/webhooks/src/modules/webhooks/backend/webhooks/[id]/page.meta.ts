export const metadata = {
  requireAuth: true,
  requireFeatures: ['webhooks.view'],
  pageTitle: 'Webhook Detail',
  pageTitleKey: 'webhooks.detail.title',
  pageGroup: 'Integrations',
  pageGroupKey: 'webhooks.nav.group',
  navHidden: false,
  breadcrumb: [
    { label: 'Webhooks', labelKey: 'webhooks.nav.title', href: '/backend/webhooks' },
    { label: 'Detail', labelKey: 'webhooks.detail.title' },
  ],
}
