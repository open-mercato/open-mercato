import React from 'react'

const createIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('path', { d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' }),
  React.createElement('polyline', { points: '14 2 14 8 20 8' }),
  React.createElement('line', { x1: 12, y1: 13, x2: 12, y2: 19 }),
  React.createElement('line', { x1: 9, y1: 16, x2: 15, y2: 16 })
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['workflows.create'],
  pageTitle: 'Create Workflow Definition',
  pageTitleKey: 'workflows.create.title',
  pageGroup: 'Workflows',
  pageGroupKey: 'workflows.module.name',
  pagePriority: 10,
  pageOrder: 100,
  icon: createIcon,
  breadcrumb: [
    { label: 'Workflows', labelKey: 'workflows.module.name', href: '/backend/workflows/definitions' },
    { label: 'Create', labelKey: 'workflows.common.create' },
  ],
}
