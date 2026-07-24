export const metadata = {
  requireAuth: true,
  requireFeatures: ['eudr.plots.manage'],
  pageTitle: 'Create plot',
  pageTitleKey: 'eudr.plots.create.title',
  pageGroup: 'Compliance',
  pageGroupKey: 'eudr.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Plots', labelKey: 'eudr.nav.plots', href: '/backend/eudr/plots' },
    { label: 'Create', labelKey: 'eudr.plots.create.title' },
  ],
}
