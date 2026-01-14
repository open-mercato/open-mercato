export const metadata = {
  requireAuth: true,
  requireFeatures: ['booking.manage_resources'],
  pageTitle: 'Edit resource',
  pageTitleKey: 'booking.resources.form.editTitle',
  pageGroup: 'Booking',
  pageGroupKey: 'booking.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Resources', labelKey: 'booking.resources.page.title', href: '/backend/booking/resources' },
    { label: 'Edit', labelKey: 'common.edit' },
  ],
}
