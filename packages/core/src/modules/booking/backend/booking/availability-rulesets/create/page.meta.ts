export const metadata = {
  requireAuth: true,
  requireFeatures: ['booking.manage_availability'],
  pageTitle: 'Create schedule',
  pageTitleKey: 'booking.availabilityRuleSets.form.createTitle',
  pageGroup: 'Booking',
  pageGroupKey: 'booking.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Availability schedules', labelKey: 'booking.availabilityRuleSets.page.title', href: '/backend/booking/availability-rulesets' },
    { label: 'Create schedule', labelKey: 'booking.availabilityRuleSets.form.createTitle' },
  ],
}
