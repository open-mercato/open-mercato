import type { PageMetadata } from '@open-mercato/shared/modules/registry'

export const metadata: PageMetadata = {
  requireCustomerAuth: true,
  requireCustomerFeatures: ['portal.warranty_claims.view'],
  titleKey: 'warranty_claims.portal.detail.title',
  title: 'Claim detail',
}

export default metadata
