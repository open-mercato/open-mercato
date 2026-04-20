export const metadata = {
  requireAuth: true,
  requireFeatures: ['sales.channel.manage'],
  pageTitle: 'Edit channel offer',
  pageTitleKey: 'sales.channel.offers.form.editTitle',
  pageGroup: 'Sales',
  pageGroupKey: 'customers~sales.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Sales', labelKey: 'customers~sales.nav.group', href: '/backend/sales/channels' },
    { label: 'Channels', labelKey: 'sales.channel.nav.title', href: '/backend/sales/channels' },
    { label: 'Offers', labelKey: 'sales.channel.offers.form.tabs.offers' },
    { label: 'Edit', labelKey: 'sales.channel.offers.form.editTitle' },
  ],
} as const
