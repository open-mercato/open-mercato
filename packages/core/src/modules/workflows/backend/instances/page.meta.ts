import React from 'react'

const instancesIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('path', { d: 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['workflows.view_instances'],
  pageTitle: 'Workflow Instances',
  pageTitleKey: 'workflows.instances.title',
  pageGroup: 'Workflows',
  pageGroupKey: 'workflows.module.name',
  pagePriority: 20,
  pageOrder: 110,
  icon: instancesIcon,
  breadcrumb: [
    { label: 'Workflows', labelKey: 'workflows.module.name' },
    { label: 'Instances', labelKey: 'workflows.instances.plural' },
  ],
}
