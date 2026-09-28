export const metadata = {
  requireAuth: true,
  requireFeatures: ['hr.write'],
  pageTitle: 'Edit driver profile',
  pageTitleKey: 'hr_management.drivers.form.edit.title',
  pageGroup: 'HR',
  pageGroupKey: 'hr_management.nav.group',
  pageOrder: 218,
  icon: 'badge-check',
  breadcrumb: [
    { label: 'HR', labelKey: 'hr_management.nav.group' },
    { label: 'Drivers', labelKey: 'hr_management.drivers.page.title', href: '/backend/hr/drivers' },
    { label: 'Edit driver profile', labelKey: 'hr_management.drivers.form.edit.title' },
  ],
}
