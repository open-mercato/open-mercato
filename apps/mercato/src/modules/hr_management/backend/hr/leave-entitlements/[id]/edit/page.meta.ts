export const metadata = {
  requireAuth: true,
  requireFeatures: ['hr.write'],
  pageTitle: 'Edit leave entitlement',
  pageTitleKey: 'hr_management.leaveEntitlements.form.edit.title',
  pageGroup: 'HR',
  pageGroupKey: 'hr_management.nav.group',
  pageOrder: 226,
  icon: 'calendar',
  breadcrumb: [
    { label: 'HR', labelKey: 'hr_management.nav.group' },
    { label: 'Leave entitlements', labelKey: 'hr_management.leaveEntitlements.page.title', href: '/backend/hr/leave-entitlements' },
    { label: 'Edit leave entitlement', labelKey: 'hr_management.leaveEntitlements.form.edit.title' },
  ],
}
