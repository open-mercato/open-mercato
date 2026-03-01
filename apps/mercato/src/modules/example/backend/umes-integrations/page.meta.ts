import React from 'react'

const linkIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('path', { d: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71' }),
  React.createElement('path', { d: 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['example.todos.view'],
  pageTitle: 'Phase I-L integrations',
  pageTitleKey: 'example.menu.umesIntegrations',
  pageGroup: 'Example',
  pageGroupKey: 'example.nav.group',
  pageOrder: 20700,
  icon: linkIcon,
  breadcrumb: [
    { label: 'General tasks', labelKey: 'example.todos.page.title', href: '/backend/todos' },
    { label: 'Phase I-L integrations', labelKey: 'example.umes.integrations.title' },
  ],
}

export default metadata
