export const metadata = {
  requireAuth: true,
  requireFeatures: ['hr.write'],
  pageTitle: 'New leave entitlement',
  pageTitleKey: 'hr_management.leaveEntitlements.form.create.title',
  pageGroup: 'HR',
  pageGroupKey: 'hr_management.nav.group',
  pageOrder: 225,
  icon: 'calendar',
  breadcrumb: [
    { label: 'HR', labelKey: 'hr_management.nav.group' },
    { label: 'Leave entitlements', labelKey: 'hr_management.leaveEntitlements.page.title', href: '/backend/hr/leave-entitlements' },
    { label: 'New leave entitlement', labelKey: 'hr_management.leaveEntitlements.form.create.title' },
  ],
}
