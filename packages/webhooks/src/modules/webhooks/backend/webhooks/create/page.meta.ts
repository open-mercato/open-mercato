export const metadata = {
  requireAuth: true,
  requireFeatures: ['webhooks.manage'],
  pageTitle: 'Create Webhook',
  pageTitleKey: 'webhooks.form.title.create',
  pageGroup: 'External systems',
  pageGroupKey: 'backend.nav.externalSystems',
  navHidden: true,
  breadcrumb: [
    { label: 'Webhooks', labelKey: 'webhooks.nav.title', href: '/backend/webhooks' },
    { label: 'Create', labelKey: 'common.create' },
  ],
}
