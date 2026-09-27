export const metadata = {
  requireAuth: true,
  requireFeatures: ['hr.write'],
  pageTitle: 'New department',
  pageTitleKey: 'hr_management.departments.form.create.title',
  pageGroup: 'HR',
  pageGroupKey: 'hr_management.nav.group',
  pageOrder: 214,
  icon: 'building2',
  breadcrumb: [
    { label: 'HR', labelKey: 'hr_management.nav.group' },
    { label: 'Departments', labelKey: 'hr_management.departments.page.title', href: '/backend/hr/departments' },
    { label: 'New department', labelKey: 'hr_management.departments.form.create.title' },
  ],
}
