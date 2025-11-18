export const metadata = {
  requireAuth: true,
  requireFeatures: ['sales.channels.manage'],
  pageTitle: 'Create channel offer',
  pageTitleKey: 'sales.channels.offers.form.createTitle',
  pageGroup: 'Sales',
  pageGroupKey: 'sales.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Sales', labelKey: 'sales.nav.group', href: '/backend/sales/channels' },
    { label: 'Channels', labelKey: 'sales.channels.nav.title', href: '/backend/sales/channels' },
    { label: 'Offers', labelKey: 'sales.channels.offers.form.tabs.offers' },
    { label: 'Create', labelKey: 'sales.channels.offers.form.createTitle' },
  ],
} as const
