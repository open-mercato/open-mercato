export const metadata = {
  requireAuth: true,
  requireFeatures: ['freight.read'],
  pageTitle: 'Trip abstracts',
  pageTitleKey: 'freight_operations.abstracts.page.title',
  pageGroup: 'Freight',
  pageGroupKey: 'freight_operations.nav.group',
  pageOrder: 280,
  icon: 'clipboard-list',
  breadcrumb: [
    { label: 'Freight', labelKey: 'freight_operations.nav.group' },
    { label: 'Abstracts', labelKey: 'freight_operations.abstracts.page.title' },
  ],
}
