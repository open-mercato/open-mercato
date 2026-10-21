export const metadata = {
  requireAuth: true,
  requireFeatures: ['financial.write'],
  pageTitle: 'New vendor',
  pageTitleKey: 'financial.ap.vendors.form.create.title',
  pageGroup: 'Financial',
  pageGroupKey: 'financial.nav.group',
  pageOrder: 462,
  navHidden: true,
  breadcrumb: [
    { label: 'Financial', labelKey: 'financial.nav.group' },
    { label: 'Vendors', labelKey: 'financial.ap.vendors.page.title', href: '/backend/financial/payables/vendors' },
    { label: 'New vendor', labelKey: 'financial.ap.vendors.form.create.title' },
  ],
}
