export const metadata = {
  requireAuth: true,
  requireFeatures: ['financial.read'],
  pageTitle: 'Automatic posting',
  pageTitleKey: 'financial.postingSettings.pageTitle',
  pageGroup: 'Financial',
  pageGroupKey: 'financial.nav.group',
  pageOrder: 440,
  icon: 'settings',
  breadcrumb: [
    { label: 'Financial', labelKey: 'financial.nav.group' },
    { label: 'Automatic posting', labelKey: 'financial.postingSettings.pageTitle' },
  ],
}
