export const metadata = {
  requireAuth: true,
  requireFeatures: ['booking.manage_team'],
  pageTitle: 'Add team role',
  pageTitleKey: 'booking.teamRoles.form.createTitle',
  pageGroup: 'Booking',
  pageGroupKey: 'booking.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Team roles', labelKey: 'booking.teamRoles.page.title', href: '/backend/booking/team-roles' },
    { label: 'Add team role', labelKey: 'booking.teamRoles.form.createTitle' },
  ],
}
