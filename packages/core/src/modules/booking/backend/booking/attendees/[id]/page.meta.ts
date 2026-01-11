export const metadata = {
  requireAuth: true,
  requireFeatures: ['booking.manage_events'],
  pageTitle: 'Edit attendee',
  pageTitleKey: 'booking.attendees.form.editTitle',
  pageGroup: 'Booking',
  pageGroupKey: 'booking.nav.group',
  breadcrumb: [
    { label: 'Attendees', labelKey: 'booking.attendees.page.title', href: '/backend/booking/attendees' },
    { label: 'Edit attendee', labelKey: 'booking.attendees.form.editTitle' },
  ],
}
