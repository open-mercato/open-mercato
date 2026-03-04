import React from 'react'

const databaseIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('ellipse', { cx: 12, cy: 5, rx: 9, ry: 3 }),
  React.createElement('path', { d: 'M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5' }),
  React.createElement('path', { d: 'M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['example.todos.view'],
  pageTitle: 'Phase N query extensions',
  pageTitleKey: 'example.menu.umesQueryExtensions',
  pageGroup: 'Example',
  pageGroupKey: 'example.nav.group',
  pageOrder: 20800,
  icon: databaseIcon,
  breadcrumb: [
    { label: 'General tasks', labelKey: 'example.todos.page.title', href: '/backend/todos' },
    { label: 'Phase N query extensions', labelKey: 'example.umes.queryExtensions.title' },
  ],
}

export default metadata
