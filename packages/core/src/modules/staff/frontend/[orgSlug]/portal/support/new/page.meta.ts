import type { PageMetadata } from '@open-mercato/shared/modules/registry'

export const metadata: PageMetadata = {
  requireCustomerAuth: true,
  requireCustomerFeatures: ['portal.support_tickets.manage'],
  titleKey: 'staff.portal.support.new.title',
  title: 'New support ticket',
}

export default metadata
