import React from 'react'
import { getApiDocsPageMetadataAuth } from '@open-mercato/core/modules/api_docs/lib/public-access'

const bookIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('path', { d: 'M12 7v14' }),
  React.createElement('path', {
    d: 'M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z',
  }),
)

export const metadata = {
  ...getApiDocsPageMetadataAuth(),
  pageTitle: 'API documentation',
  pageTitleKey: 'api_docs.nav.title',
  pageGroup: 'Developers',
  pageGroupKey: 'backend.nav.developers',
  pageOrder: 1000,
  icon: bookIcon,
  pageContext: 'settings' as const,
}
