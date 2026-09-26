export const metadata = {
  requireAuth: true,
  requireFeatures: ['hr.write'],
  pageTitle: 'Edit employee',
  pageTitleKey: 'hr_management.employees.form.edit.title',
  pageGroup: 'HR',
  pageGroupKey: 'hr_management.nav.group',
  pageOrder: 211,
  icon: 'users',
  breadcrumb: [
    { label: 'HR', labelKey: 'hr_management.nav.group' },
    { label: 'Employees', labelKey: 'hr_management.employees.page.title', href: '/backend/hr/employees' },
    { label: 'Edit employee', labelKey: 'hr_management.employees.form.edit.title' },
  ],
}
