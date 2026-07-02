import type { PageMetadata } from '@open-mercato/shared/modules/registry'

export const metadata: PageMetadata = {
  requireCustomerAuth: true,
  requireCustomerFeatures: ['portal.incidents.view'],
  titleKey: 'incidents.portal.nav.title',
  title: 'Incidents',
  nav: {
    label: 'Incidents',
    labelKey: 'incidents.portal.nav.title',
    group: 'main',
    order: 40,
  },
  breadcrumb: [{ label: 'Incidents', labelKey: 'incidents.portal.nav.title' }],
}

export default metadata
