import React from 'react'

const sparklesIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('path', { d: 'M12 3l1.912 5.813a2 2 0 0 0 1.275 1.275L21 12l-5.813 1.912a2 2 0 0 0-1.275 1.275L12 21l-1.912-5.813a2 2 0 0 0-1.275-1.275L3 12l5.813-1.912a2 2 0 0 0 1.275-1.275L12 3z' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['example.todos.manage'],
  pageTitle: 'UMES Next Phases',
  pageTitleKey: 'example.umes.next.page.title',
  pageGroup: 'Example',
  pageGroupKey: 'example.nav.group',
  pageOrder: 20510,
  icon: sparklesIcon,
  breadcrumb: [
    { label: 'General tasks', labelKey: 'example.todos.page.title', href: '/backend/todos' },
    { label: 'Next phases', labelKey: 'example.umes.next.page.title' },
  ],
}

export default metadata
