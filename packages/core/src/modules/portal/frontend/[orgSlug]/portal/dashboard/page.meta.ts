import type { PageMetadata } from '@open-mercato/shared/modules/registry'

export const metadata: PageMetadata = {
  requireCustomerAuth: true,
  titleKey: 'portal.dashboard.title',
  title: 'Dashboard',
  nav: {
    label: 'Dashboard',
    labelKey: 'portal.nav.dashboard',
    group: 'main',
    order: 10,
  },
}

export default metadata
