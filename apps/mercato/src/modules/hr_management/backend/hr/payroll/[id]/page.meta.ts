export const metadata = {
  requireAuth: true,
  requireFeatures: ['hr.read'],
  pageTitle: 'Payroll run',
  pageTitleKey: 'hr_management.payroll.detail.title',
  pageGroup: 'HR',
  pageGroupKey: 'hr_management.nav.group',
  pageOrder: 232,
  navHidden: true,
  breadcrumb: [
    { label: 'HR', labelKey: 'hr_management.nav.group' },
    { label: 'Payroll', labelKey: 'hr_management.payroll.page.title', href: '/backend/hr/payroll' },
    { label: 'Payroll run', labelKey: 'hr_management.payroll.detail.title' },
  ],
}
