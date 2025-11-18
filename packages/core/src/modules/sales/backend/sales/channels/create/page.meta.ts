export const metadata = {
  requireAuth: true,
  requireFeatures: ['sales.channels.manage'],
  pageTitle: 'Create channel',
  pageTitleKey: 'sales.channels.form.createTitle',
  pageGroup: 'Sales',
  pageGroupKey: 'sales.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Sales', labelKey: 'sales.nav.group', href: '/backend/sales/channels' },
    { label: 'Channels', labelKey: 'sales.channels.nav.title', href: '/backend/sales/channels' },
    { label: 'Create', labelKey: 'sales.channels.form.createTitle' },
  ],
} as const
