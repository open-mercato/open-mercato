export const metadata = {
  requireAuth: true,
  requireFeatures: ['sales.channel.manage'],
  pageTitle: 'Edit channel',
  pageTitleKey: 'sales.channel.form.editTitle',
  pageGroup: 'Sales',
  pageGroupKey: 'customers~sales.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Sales', labelKey: 'customers~sales.nav.group', href: '/backend/sales/channels' },
    { label: 'Channels', labelKey: 'sales.channel.nav.title', href: '/backend/sales/channels' },
    { label: 'Edit', labelKey: 'sales.channel.form.editTitle' },
  ],
} as const
