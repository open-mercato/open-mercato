import type { PageMetadata } from '@open-mercato/shared/modules/registry'

export const metadata: PageMetadata = {
  requireCustomerAuth: true,
  titleKey: 'warranty_claims.portal.listTitle',
  title: 'My claims',
  nav: {
    label: 'Claims',
    labelKey: 'warranty_claims.portal.nav',
    group: 'main',
    order: 40,
    icon: 'shield-check',
  },
}

export default metadata
