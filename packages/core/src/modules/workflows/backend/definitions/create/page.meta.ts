import React from 'react'

const createIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('circle', { cx: '12', cy: '12', r: '10' }),
  React.createElement('line', { x1: '12', y1: '8', x2: '12', y2: '16' }),
  React.createElement('line', { x1: '8', y1: '12', x2: '16', y2: '12' }),
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
