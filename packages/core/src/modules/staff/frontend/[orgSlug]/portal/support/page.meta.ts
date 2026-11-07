import type { PageMetadata } from '@open-mercato/shared/modules/registry'

export const metadata: PageMetadata = {
  requireCustomerAuth: true,
  requireCustomerFeatures: ['portal.support_tickets.view'],
  titleKey: 'staff.portal.support.title',
  title: 'Support',
  nav: {
    label: 'Support',
    labelKey: 'staff.portal.support.nav',
    group: 'main',
    order: 45,
    icon: 'life-buoy',
  },
}

export default metadata
