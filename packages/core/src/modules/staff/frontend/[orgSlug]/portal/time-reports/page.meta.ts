import type { PageMetadata } from '@open-mercato/shared/modules/registry'

export const metadata: PageMetadata = {
  requireCustomerAuth: true,
  requireCustomerFeatures: ['portal.time_reports.view'],
  titleKey: 'staff.portal.timeReports.listTitle',
  title: 'Time reports',
  nav: {
    label: 'Time reports',
    labelKey: 'staff.portal.timeReports.nav',
    group: 'main',
    order: 50,
    icon: 'clock',
  },
}

export default metadata
