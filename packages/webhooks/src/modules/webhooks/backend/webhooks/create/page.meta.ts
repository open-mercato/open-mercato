export const metadata = {
  requireAuth: true,
  requireFeatures: ['webhooks.manage'],
  pageTitle: 'Create Webhook',
  pageTitleKey: 'webhooks.form.title.create',
  pageGroup: 'Integrations',
  pageGroupKey: 'webhooks.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Webhooks', labelKey: 'webhooks.nav.title', href: '/backend/webhooks' },
    { label: 'Create', labelKey: 'common.create' },
  ],
}
