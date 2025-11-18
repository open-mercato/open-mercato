export const metadata = {
  requireAuth: true,
  requireFeatures: ['sales.channels.manage'],
  pageTitle: 'Edit channel',
  pageTitleKey: 'sales.channels.form.editTitle',
  pageGroup: 'Sales',
  pageGroupKey: 'sales.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Sales', labelKey: 'sales.nav.group', href: '/backend/sales/channels' },
    { label: 'Channels', labelKey: 'sales.channels.nav.title', href: '/backend/sales/channels' },
    { label: 'Edit', labelKey: 'sales.channels.form.editTitle' },
  ],
} as const
