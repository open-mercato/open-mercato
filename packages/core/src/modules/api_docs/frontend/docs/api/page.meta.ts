import { getApiDocsPageMetadataAuth } from '@open-mercato/core/modules/api_docs/lib/public-access'

export const metadata = {
  ...getApiDocsPageMetadataAuth(),
  pageTitle: 'API Explorer',
  pageTitleKey: 'api_docs.explorer.pageTitle',
} as const
