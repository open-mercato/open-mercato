export const metadata = {
  requireAuth: true,
  requireFeatures: ['webhooks.create'],
  pageTitle: 'Create Webhook',
  pageTitleKey: 'webhooks.nav.create',
  pageGroup: 'Configuration',
  pageGroupKey: 'backend.nav.configuration',
  navHidden: true,
  breadcrumb: [
    { label: 'Webhooks', labelKey: 'webhooks.nav.webhooks', href: '/backend/webhooks' },
    { label: 'Create', labelKey: 'common.create' },
  ],
}
