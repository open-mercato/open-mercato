import React from 'react'

const shieldIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('path', { d: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['example.todos.view'],
  pageTitle: 'Phase M — Mutation Lifecycle',
  pageTitleKey: 'example.menu.mutationLifecycle',
  pageGroup: 'Example',
  pageGroupKey: 'example.nav.group',
  pageOrder: 20700,
  icon: shieldIcon,
  breadcrumb: [
    { label: 'General tasks', labelKey: 'example.todos.page.title', href: '/backend/todos' },
    { label: 'Phase M — Mutation Lifecycle', labelKey: 'example.mutationLifecycle.title' },
  ],
}

export default metadata
