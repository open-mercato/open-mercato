export const metadata = {
  requireAuth: true,
  requireFeatures: ['staff.manage_team'],
  pageTitle: 'Add team member',
  pageTitleKey: 'staff.teamMembers.form.createTitle',
  pageGroup: 'Employees',
  pageGroupKey: 'staff.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Team members', labelKey: 'staff.teamMembers.page.title', href: '/backend/staff/team-members' },
    { label: 'Add team member', labelKey: 'staff.teamMembers.form.createTitle' },
  ],
}
