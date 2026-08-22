export const metadata = {
  requireAuth: true,
  requireFeatures: ['eudr.plots.manage'],
  pageTitle: 'Edit plot',
  pageTitleKey: 'eudr.plots.edit.title',
  pageGroup: 'Compliance',
  pageGroupKey: 'eudr.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'EUDR', labelKey: 'eudr.nav.module', href: '/backend/eudr' },
    { label: 'Plots', labelKey: 'eudr.nav.plots', href: '/backend/eudr/plots' },
    { label: 'Edit plot', labelKey: 'eudr.plots.edit.title' },
  ],
}
