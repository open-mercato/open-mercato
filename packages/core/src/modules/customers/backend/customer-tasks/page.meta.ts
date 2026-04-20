import React from 'react'

const tasksIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('rect', { x: 9, y: 3, width: 6, height: 4, rx: 1 }),
  React.createElement('path', { d: 'M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2' }),
  React.createElement('path', { d: 'M9 12h6' }),
  React.createElement('path', { d: 'M9 16h4' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['customers.interaction.view'],
  pageTitle: 'Customer related tasks',
  pageTitleKey: 'customers.workPlan.customerTodos.page.title',
  pageGroup: 'Customers',
  pageGroupKey: 'customers.nav.group',
  pagePriority: 10,
  pageOrder: 120,
  icon: tasksIcon,
  breadcrumb: [{ label: 'Customer related tasks', labelKey: 'customers.workPlan.customerTodos.page.title' }],
}
