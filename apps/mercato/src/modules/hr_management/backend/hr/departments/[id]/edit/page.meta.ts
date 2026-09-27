export const metadata = {
  requireAuth: true,
  requireFeatures: ['hr.write'],
  pageTitle: 'Edit department',
  pageTitleKey: 'hr_management.departments.form.edit.title',
  pageGroup: 'HR',
  pageGroupKey: 'hr_management.nav.group',
  pageOrder: 215,
  icon: 'building2',
  breadcrumb: [
    { label: 'HR', labelKey: 'hr_management.nav.group' },
    { label: 'Departments', labelKey: 'hr_management.departments.page.title', href: '/backend/hr/departments' },
    { label: 'Edit department', labelKey: 'hr_management.departments.form.edit.title' },
  ],
}
