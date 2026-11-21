import type { PageMetadata } from '@open-mercato/shared/modules/registry'

export const metadata: PageMetadata = {
  requireCustomerAuth: true,
  requireCustomerFeatures: ['portal.warranty_claims.view', 'portal.warranty_claims.manage'],
  titleKey: 'warranty_claims.portal.new.title',
  title: 'New claim',
}

export default metadata
