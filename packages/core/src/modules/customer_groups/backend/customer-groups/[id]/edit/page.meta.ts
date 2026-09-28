export const metadata = {
  requireAuth: true,
  requireFeatures: ['customer_groups.groups.manage'],
  pageTitle: 'Edit Customer Group',
  pageTitleKey: 'customer_groups.groups.form.editTitle',
  pageGroup: 'Customers',
  navHidden: true,
  breadcrumb: [
    { label: 'Customer Groups', labelKey: 'customer_groups.groups.page.title', href: '/backend/customer-groups' },
    { label: 'Edit', labelKey: 'common.edit' },
  ],
}
