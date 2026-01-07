export const metadata = {
  requireAuth: true,
  requireFeatures: ['booking.manage_resources'],
  pageTitle: 'Create resource',
  pageTitleKey: 'booking.resources.form.createTitle',
  pageGroup: 'Booking',
  pageGroupKey: 'booking.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Resources', labelKey: 'booking.resources.page.title', href: '/backend/booking/resources' },
    { label: 'Create', labelKey: 'common.create' },
  ],
}
