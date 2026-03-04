import React from 'react'

const sparklesIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('path', { d: 'M12 3l1.9 4.1L18 9l-4.1 1.9L12 15l-1.9-4.1L6 9l4.1-1.9L12 3z' }),
  React.createElement('path', { d: 'M19 14l.9 1.9L22 17l-2.1 1.1L19 20l-.9-1.9L16 17l2.1-1.1L19 14z' }),
  React.createElement('path', { d: 'M5 14l.9 1.9L8 17l-2.1 1.1L5 20l-.9-1.9L2 17l2.1-1.1L5 14z' }),
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
    { label: 'UMES next phases', labelKey: 'example.umes.next.page.title' },
  ],
}

export default metadata
