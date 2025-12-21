export const metadata = {
  requireAuth: true,
  requireFeatures: ['webhooks.edit'],
  pageTitle: 'Edit Webhook',
  pageTitleKey: 'webhooks.nav.edit',
  pageGroup: 'Configuration',
  pageGroupKey: 'backend.nav.configuration',
  navHidden: true,
  breadcrumb: [
    { label: 'Webhooks', labelKey: 'webhooks.nav.webhooks', href: '/backend/webhooks' },
    { label: 'Edit', labelKey: 'common.edit' },
  ],
}
