import React from 'react'

const userIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('path', { d: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2' }),
  React.createElement('circle', { cx: 12, cy: 7, r: 4 }),
)

export const metadata = {
  requireAuth: true,
  requireRoles: ['admin'] as const,
  pageTitle: 'User Entities',
  pageGroup: 'Data designer',
  pageOrder: 12,
  icon: userIcon,
}
