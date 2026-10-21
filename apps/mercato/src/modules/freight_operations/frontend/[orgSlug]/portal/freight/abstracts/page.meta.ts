import type { PageMetadata } from '@open-mercato/shared/modules/registry'

export const metadata: PageMetadata = {
  requireCustomerAuth: true,
  requireCustomerFeatures: ['portal.freight.view'],
  titleKey: 'freight_operations.portal.abstracts.title',
  title: 'Trip abstracts',
  nav: {
    label: 'Trip abstracts',
    labelKey: 'freight_operations.portal.abstracts.title',
    group: 'main',
    order: 60,
  },
}

export default metadata
