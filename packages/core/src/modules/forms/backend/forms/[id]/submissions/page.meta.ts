import type { PageMetadata } from '@open-mercato/shared/modules/registry'

export const metadata: PageMetadata = {
  requireAuth: true,
  requireFeatures: ['forms.view'],
  titleKey: 'forms.inbox.title',
  title: 'Submissions',
}

export default metadata
