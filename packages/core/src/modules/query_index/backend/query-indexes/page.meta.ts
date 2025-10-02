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
  requireRoles: ['admin'] as const,
  pageTitle: 'Query Indexes',
  pageGroup: 'Data designer',
  pageOrder: 13,
  icon: indexIcon,
}


