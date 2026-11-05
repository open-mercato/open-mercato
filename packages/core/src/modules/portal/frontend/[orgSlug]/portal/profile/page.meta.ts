import type { PageMetadata } from '@open-mercato/shared/modules/registry'

export const metadata: PageMetadata = {
  requireCustomerAuth: true,
  titleKey: 'portal.nav.profile',
  title: 'Profile',
  nav: {
    label: 'Profile',
    labelKey: 'portal.nav.profile',
    group: 'account',
    order: 10,
  },
}

export default metadata
