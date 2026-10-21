export const metadata = {
  requireAuth: true,
  requireFeatures: ['hr.read'],
  pageTitle: 'Payroll',
  pageTitleKey: 'hr_management.payroll.page.title',
  pageGroup: 'HR',
  pageGroupKey: 'hr_management.nav.group',
  pageOrder: 230,
  icon: 'wallet',
  breadcrumb: [
    { label: 'HR', labelKey: 'hr_management.nav.group' },
    { label: 'Payroll', labelKey: 'hr_management.payroll.page.title' },
  ],
}
