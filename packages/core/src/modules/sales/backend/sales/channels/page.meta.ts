export const metadata = {
  requireAuth: true,
  requireFeatures: ['sales.channels.manage'],
  pageTitle: 'Sales channels',
  pageTitleKey: 'sales.channels.nav.title',
  pageGroup: 'Sales',
  pageGroupKey: 'customers~sales.nav.group',
  pagePriority: 40,
  pageOrder: 120,
  icon: 'globe',
  breadcrumb: [
    { label: 'Sales', labelKey: 'customers~sales.nav.group', href: '/backend/sales/channels' },
    { label: 'Channels', labelKey: 'sales.channels.nav.title' },
  ],
} as const
