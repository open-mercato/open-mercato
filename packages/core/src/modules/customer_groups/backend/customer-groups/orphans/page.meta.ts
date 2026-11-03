export const metadata = {
  requireAuth: true,
  requireFeatures: ['customer_groups.groups.manage'],
  pageTitle: 'Orphaned Customer Group References',
  pageTitleKey: 'customer_groups.groups.orphans.pageTitle',
  pageGroup: 'Customers',
  navHidden: true,
  breadcrumb: [
    { label: 'Customer groups', labelKey: 'customer_groups.groups.nav.title', href: '/backend/customer-groups' },
    { label: 'Orphaned references', labelKey: 'customer_groups.groups.orphans.pageTitle' },
  ],
}
