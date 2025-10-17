import React from 'react'

const usersIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('path', { d: 'M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2' }),
  React.createElement('circle', { cx: 9, cy: 7, r: 4 }),
  React.createElement('path', { d: 'M23 21v-2a4 4 0 0 0-3-3.87' }),
  React.createElement('path', { d: 'M16 3.13a4 4 0 0 1 0 7.75' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['customers.activities.view'],
  pageTitle: 'Customer related tasks',
  pageTitleKey: 'customers.workPlan.customerTodos.page.title',
  pageGroup: 'Work plan',
  pageGroupKey: 'example.workPlan.nav.group',
  pageOrder: 122,
  icon: usersIcon,
  breadcrumb: [
    { label: 'General tasks', labelKey: 'example.todos.page.title', href: '/backend/todos' },
    { label: 'Customer related tasks', labelKey: 'customers.workPlan.customerTodos.page.title' },
  ],
}
