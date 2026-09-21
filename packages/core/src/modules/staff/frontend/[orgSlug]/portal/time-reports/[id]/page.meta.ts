import type { PageMetadata } from '@open-mercato/shared/modules/registry'

export const metadata: PageMetadata = {
  requireCustomerAuth: true,
  requireCustomerFeatures: ['portal.time_reports.view'],
  titleKey: 'staff.portal.timeReports.detailTitle',
  title: 'Time report',
}

export default metadata
