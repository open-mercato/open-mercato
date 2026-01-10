export const metadata = {
  requireAuth: true,
  requireFeatures: ['booking.manage_events'],
  pageTitle: 'Add attendee',
  pageTitleKey: 'booking.attendees.form.createTitle',
  pageGroup: 'Booking',
  pageGroupKey: 'booking.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Attendees', labelKey: 'booking.attendees.page.title', href: '/backend/booking/attendees' },
    { label: 'Add attendee', labelKey: 'booking.attendees.form.createTitle' },
  ],
}
