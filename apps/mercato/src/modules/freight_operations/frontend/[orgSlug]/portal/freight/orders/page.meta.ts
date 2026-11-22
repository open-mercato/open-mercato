import type { PageMetadata } from '@open-mercato/shared/modules/registry'

export const metadata: PageMetadata = {
  requireCustomerAuth: true,
  requireCustomerFeatures: ['portal.freight.view'],
  titleKey: 'freight_operations.portal.orders.title',
  title: 'Transport orders',
  nav: {
    label: 'Transport orders',
    labelKey: 'freight_operations.portal.orders.title',
    group: 'main',
    order: 25,
    icon: 'truck',
  },
}

export default metadata
