export const metadata = {
  requireAuth: true,
  requireFeatures: ['hr.write'],
  pageTitle: 'New driver profile',
  pageTitleKey: 'hr_management.drivers.form.create.title',
  pageGroup: 'HR',
  pageGroupKey: 'hr_management.nav.group',
  pageOrder: 217,
  icon: 'badge-check',
  breadcrumb: [
    { label: 'HR', labelKey: 'hr_management.nav.group' },
    { label: 'Drivers', labelKey: 'hr_management.drivers.page.title', href: '/backend/hr/drivers' },
    { label: 'New driver profile', labelKey: 'hr_management.drivers.form.create.title' },
  ],
}
