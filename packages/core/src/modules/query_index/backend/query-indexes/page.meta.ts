import React from 'react'

const indexIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('path', { d: 'M3 3h18v4H3z' }),
  React.createElement('path', { d: 'M3 10h18v4H3z' }),
  React.createElement('path', { d: 'M3 17h18v4H3z' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['query_index.status.view'],
  pageTitle: 'Query Indexes',
  pageTitleKey: 'query_index.nav.queryIndexes',
  pageGroup: 'Data Designer',
  pageGroupKey: 'settings.sections.dataDesigner',
  pageOrder: 3,
  icon: indexIcon,
  pageContext: 'settings' as const,
}

