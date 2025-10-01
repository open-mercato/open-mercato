import React from 'react'

const formIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('rect', { x: 3, y: 4, width: 18, height: 16, rx: 2 }),
  React.createElement('path', { d: 'M7 8h10M7 12h10M7 16h6' }),
)

export const metadata = {
  requireAuth: true,
  requireRoles: ['admin'] as const,
  pageTitle: 'Entities',
  pageGroup: 'Custom fields',
  pageOrder: 10,
  icon: formIcon,
}
