export const metadata = {
  requireAuth: true,
  requireFeatures: ['booking.manage_team'],
  pageTitle: 'Edit team',
  pageTitleKey: 'booking.teams.form.editTitle',
  pageGroup: 'Booking',
  pageGroupKey: 'booking.nav.group',
  pageOrder: 79.6,
  breadcrumb: [
    { label: 'Teams', labelKey: 'booking.teams.page.title', href: '/backend/booking/teams' },
    { label: 'Edit', labelKey: 'common.edit' },
  ],
}
