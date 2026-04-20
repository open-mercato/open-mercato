export const metadata = {
  requireAuth: true,
  requireFeatures: ['staff.manage_team'],
  pageTitle: 'Edit team',
  pageTitleKey: 'staff.team.form.editTitle',
  pageGroup: 'Employees',
  pageGroupKey: 'staff.nav.group',
  pageOrder: 79.6,
  breadcrumb: [
    { label: 'Teams', labelKey: 'staff.team.page.title', href: '/backend/staff/teams' },
    { label: 'Edit', labelKey: 'common.edit' },
  ],
}
