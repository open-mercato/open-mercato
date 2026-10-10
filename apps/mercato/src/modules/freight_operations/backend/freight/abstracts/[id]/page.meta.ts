export const metadata = {
  requireAuth: true,
  requireFeatures: ['freight.read'],
  pageTitle: 'Abstract detail',
  pageTitleKey: 'freight_operations.abstracts.detail.title',
  pageGroup: 'Freight',
  pageGroupKey: 'freight_operations.nav.group',
  pageOrder: 282,
  icon: 'clipboard-list',
  breadcrumb: [
    { label: 'Freight', labelKey: 'freight_operations.nav.group' },
    { label: 'Abstracts', labelKey: 'freight_operations.abstracts.page.title', href: '/backend/freight/abstracts' },
    { label: 'Abstract detail', labelKey: 'freight_operations.abstracts.detail.title' },
  ],
}
