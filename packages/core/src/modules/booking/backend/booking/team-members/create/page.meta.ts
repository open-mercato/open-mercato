export const metadata = {
  requireAuth: true,
  requireFeatures: ['booking.manage_team'],
  pageTitle: 'Add team member',
  pageTitleKey: 'booking.teamMembers.form.createTitle',
  pageGroup: 'Booking',
  pageGroupKey: 'booking.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Team members', labelKey: 'booking.teamMembers.page.title', href: '/backend/booking/team-members' },
    { label: 'Add team member', labelKey: 'booking.teamMembers.form.createTitle' },
  ],
}
