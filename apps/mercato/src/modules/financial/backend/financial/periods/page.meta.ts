export const metadata = {
  requireAuth: true,
  requireFeatures: ['financial.read'],
  pageTitle: 'Accounting periods',
  pageTitleKey: 'financial.periods.page.title',
  pageGroup: 'Financial',
  pageGroupKey: 'financial.nav.group',
  pageOrder: 410,
  icon: 'calendar-days',
  breadcrumb: [
    { label: 'Financial', labelKey: 'financial.nav.group' },
    { label: 'Accounting periods', labelKey: 'financial.periods.page.title' },
  ],
}
