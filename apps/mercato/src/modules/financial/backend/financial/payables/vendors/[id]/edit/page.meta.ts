export const metadata = {
  requireAuth: true,
  requireFeatures: ['financial.write'],
  pageTitle: 'Edit vendor',
  pageTitleKey: 'financial.ap.vendors.form.edit.title',
  pageGroup: 'Financial',
  pageGroupKey: 'financial.nav.group',
  pageOrder: 463,
  navHidden: true,
  breadcrumb: [
    { label: 'Financial', labelKey: 'financial.nav.group' },
    { label: 'Vendors', labelKey: 'financial.ap.vendors.page.title', href: '/backend/financial/payables/vendors' },
    { label: 'Edit vendor', labelKey: 'financial.ap.vendors.form.edit.title' },
  ],
}
