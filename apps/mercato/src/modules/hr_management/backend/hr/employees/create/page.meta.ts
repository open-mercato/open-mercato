export const metadata = {
  requireAuth: true,
  requireFeatures: ['hr.write'],
  pageTitle: 'New employee',
  pageTitleKey: 'hr_management.employees.form.create.title',
  pageGroup: 'HR',
  pageGroupKey: 'hr_management.nav.group',
  pageOrder: 210,
  icon: 'users',
  breadcrumb: [
    { label: 'HR', labelKey: 'hr_management.nav.group' },
    { label: 'Employees', labelKey: 'hr_management.employees.page.title', href: '/backend/hr/employees' },
    { label: 'New employee', labelKey: 'hr_management.employees.form.create.title' },
  ],
}
