import type { PageMetadata } from '@open-mercato/shared/modules/registry'

export const metadata: PageMetadata = {
  requireCustomerAuth: true,
  requireCustomerFeatures: ['portal.freight.view'],
  titleKey: 'freight_operations.portal.abstracts.detailTitle',
  title: 'Trip abstract',
  navHidden: true,
}

export default metadata
