import React from 'react'

const puzzleIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('path', { d: 'M12 2v6m0 0a2 2 0 1 0 0 4m0-4a2 2 0 1 1 0-4m0 8v6m0-6a2 2 0 1 0 0 4m0-4a2 2 0 1 1 0-4M2 12h6m0 0a2 2 0 1 0 4 0m-4 0a2 2 0 1 1-4 0m8 0h6m-6 0a2 2 0 1 0 4 0m-4 0a2 2 0 1 1 4 0' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['example.todos.view'],
  pageTitle: 'Phase E-H handlers',
  pageTitleKey: 'example.menu.umesExtensions',
  pageGroup: 'Example',
  pageGroupKey: 'example.nav.group',
  pageOrder: 20600,
  icon: puzzleIcon,
  breadcrumb: [
    { label: 'General tasks', labelKey: 'example.todos.page.title', href: '/backend/todos' },
    { label: 'Phase E-H extensions', labelKey: 'example.umes.extensions.title' },
  ],
}

export default metadata
