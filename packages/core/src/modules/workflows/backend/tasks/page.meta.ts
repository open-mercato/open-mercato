import React from 'react'

const tasksIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('path', { d: 'M9 11l3 3L22 4' }),
  React.createElement('path', { d: 'M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['workflows.view_tasks'],
  pageTitle: 'User Tasks',
  pageTitleKey: 'workflows.tasks.title',
  pageGroup: 'Workflows',
  pageGroupKey: 'workflows.module.name',
  pagePriority: 30,
  pageOrder: 120,
  icon: tasksIcon,
  pageContext: 'settings' as const,
  breadcrumb: [
    { label: 'Workflows', labelKey: 'workflows.module.name' },
    { label: 'Tasks', labelKey: 'workflows.tasks.plural' },
  ],
}
