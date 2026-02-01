import React from 'react'

const eventsIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('path', { d: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2' }),
  React.createElement('circle', { cx: '9', cy: '7', r: '4' }),
  React.createElement('polyline', { points: '16 11 18 13 22 9' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['workflows.view_logs'],
  pageTitle: 'Workflow Events',
  pageTitleKey: 'workflows.events.title',
  pageGroup: 'Workflows',
  pageGroupKey: 'workflows.module.name',
  pagePriority: 40,
  pageOrder: 130,
  icon: eventsIcon,
  breadcrumb: [
    { label: 'Workflows', labelKey: 'workflows.module.name' },
    { label: 'Events', labelKey: 'workflows.events.plural' },
  ],
}
