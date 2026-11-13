export const metadata = {
  requireAuth: true,
  requireFeatures: ['eudr.plots.view'],
  pageTitle: 'Plots',
  pageTitleKey: 'eudr.nav.plots',
  pageGroup: 'Compliance',
  pageGroupKey: 'eudr.nav.group',
  pagePriority: 10,
  pageOrder: 20,
  icon: 'map',
  breadcrumb: [
    { label: 'EUDR', labelKey: 'eudr.nav.module', href: '/backend/eudr' },
    { label: 'Plots', labelKey: 'eudr.nav.plots' },
  ],
}
