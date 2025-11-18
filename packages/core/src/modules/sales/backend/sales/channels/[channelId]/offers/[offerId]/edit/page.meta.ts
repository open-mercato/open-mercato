export const metadata = {
  requireAuth: true,
  requireFeatures: ['sales.channels.manage'],
  pageTitle: 'Edit channel offer',
  pageTitleKey: 'sales.channels.offers.form.editTitle',
  pageGroup: 'Sales',
  pageGroupKey: 'customers~sales.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Sales', labelKey: 'customers~sales.nav.group', href: '/backend/sales/channels' },
    { label: 'Channels', labelKey: 'sales.channels.nav.title', href: '/backend/sales/channels' },
    { label: 'Offers', labelKey: 'sales.channels.offers.form.tabs.offers' },
    { label: 'Edit', labelKey: 'sales.channels.offers.form.editTitle' },
  ],
} as const
