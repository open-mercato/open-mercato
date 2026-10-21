export const metadata = {
  requireAuth: true,
  requireFeatures: ['hr.write'],
  pageTitle: 'New payroll run',
  pageTitleKey: 'hr_management.payroll.form.title',
  pageGroup: 'HR',
  pageGroupKey: 'hr_management.nav.group',
  pageOrder: 231,
  navHidden: true,
  breadcrumb: [
    { label: 'HR', labelKey: 'hr_management.nav.group' },
    { label: 'Payroll', labelKey: 'hr_management.payroll.page.title', href: '/backend/hr/payroll' },
    { label: 'New payroll run', labelKey: 'hr_management.payroll.form.title' },
  ],
}
