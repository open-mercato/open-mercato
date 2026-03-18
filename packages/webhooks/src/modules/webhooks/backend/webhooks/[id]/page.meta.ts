export const metadata = {
  requireAuth: true,
  requireFeatures: ['webhooks.edit'],
  pageTitle: 'Edit Webhook',
  pageTitleKey: 'webhooks.form.title.edit',
  pageGroup: 'Integrations',
  pageGroupKey: 'webhooks.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Webhooks', labelKey: 'webhooks.nav.title', href: '/backend/webhooks' },
    { label: 'Edit', labelKey: 'common.edit' },
  ],
}
