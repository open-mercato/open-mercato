import type { PageMetadata } from '@open-mercato/shared/modules/registry'

export const metadata: PageMetadata = {
  requireCustomerAuth: true,
  titleKey: 'marketing_automation.portal.title',
  title: 'Email preferences',
  nav: {
    label: 'Email preferences',
    labelKey: 'marketing_automation.portal.nav',
    group: 'main',
    order: 80,
    icon: 'mail',
  },
}

export default metadata
