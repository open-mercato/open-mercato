import React from 'react'

const checkboxIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('rect', { x: 3, y: 3, width: 18, height: 18, rx: 2 }),
  React.createElement('path', { d: 'M7 12l3 3 7-7' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['example.todos.view'],
  pageTitle: 'General tasks',
  pageTitleKey: 'example.todos.page.title',
  pageGroup: 'Work plan',
  pageGroupKey: 'example.workPlan.nav.group',
  pageOrder: 120,
  icon: checkboxIcon,
  breadcrumb: [
    { label: 'General tasks', labelKey: 'example.todos.page.title' },
  ],
}
