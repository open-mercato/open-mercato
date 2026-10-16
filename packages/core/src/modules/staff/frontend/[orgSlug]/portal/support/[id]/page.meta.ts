import type { PageMetadata } from '@open-mercato/shared/modules/registry'

export const metadata: PageMetadata = {
  requireCustomerAuth: true,
  requireCustomerFeatures: ['portal.support_tickets.view'],
  titleKey: 'staff.portal.support.detail.title',
  title: 'Support ticket',
}

export default metadata
