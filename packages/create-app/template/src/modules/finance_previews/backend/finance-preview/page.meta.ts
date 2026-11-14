import type { PageMetadata } from '@open-mercato/shared/modules/registry'

export const metadata: PageMetadata = {
  requireAuth: true,
  requireFeatures: ['finance_previews.view'],
  pageTitle: 'Finance preview',
  pageTitleKey: 'finance_previews.nav.title',
  pageGroup: 'Finance',
  pageGroupKey: 'finance_previews.nav.group',
  pageOrder: 50,
  icon: 'coins',
  breadcrumb: [
    { label: 'Finance preview', labelKey: 'finance_previews.nav.title' },
  ],
}

export default metadata
