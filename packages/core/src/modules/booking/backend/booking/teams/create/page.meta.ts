export const metadata = {
  requireAuth: true,
  requireFeatures: ['booking.manage_team'],
  pageTitle: 'Create team',
  pageTitleKey: 'booking.teams.form.createTitle',
  pageGroup: 'Booking',
  pageGroupKey: 'booking.nav.group',
  pageOrder: 79.5,
  breadcrumb: [
    { label: 'Teams', labelKey: 'booking.teams.page.title', href: '/backend/booking/teams' },
    { label: 'Create', labelKey: 'common.create' },
  ],
}
