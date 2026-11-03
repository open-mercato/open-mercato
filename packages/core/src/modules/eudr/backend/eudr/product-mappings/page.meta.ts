export const metadata = {
  requireAuth: true,
  requireFeatures: ['eudr.mappings.view'],
  pageTitle: 'Product mappings',
  pageTitleKey: 'eudr.nav.mappings',
  pageGroup: 'Compliance',
  pageGroupKey: 'eudr.nav.group',
  pagePriority: 10,
  pageOrder: 10,
  icon: 'package',
  breadcrumb: [
    { label: 'EUDR', labelKey: 'eudr.nav.module', href: '/backend/eudr' },
    { label: 'Product mappings', labelKey: 'eudr.nav.mappings' },
  ],
}
