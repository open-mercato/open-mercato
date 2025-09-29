import React from 'react'

const listIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('path', { d: 'M8 6h13M8 12h13M8 18h13' }),
  React.createElement('path', { d: 'M3 6h.01M3 12h.01M3 18h.01' }),
)

export const metadata = {
  requireAuth: true,
  requireRoles: ['admin'] as const,
  pageTitle: 'Todos',
  pageGroup: 'Example',
  pageOrder: 1,
  icon: listIcon,
  breadcrumb: [
    { label: 'Todos' },
  ],
}
