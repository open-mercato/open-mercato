export const metadata = {
  requireAuth: true,
  requireFeatures: ['staff.manage_team'],
  pageTitle: 'Add team role',
  pageTitleKey: 'staff.teamRoles.form.createTitle',
  pageGroup: 'Employees',
  pageGroupKey: 'staff.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Team roles', labelKey: 'staff.teamRoles.page.title', href: '/backend/staff/team-roles' },
    { label: 'Add team role', labelKey: 'staff.teamRoles.form.createTitle' },
  ],
}
