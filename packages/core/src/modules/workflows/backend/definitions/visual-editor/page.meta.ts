import React from 'react'

const visualEditorIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('rect', { x: '3', y: '3', width: '18', height: '18', rx: '2', ry: '2' }),
  React.createElement('line', { x1: '3', y1: '9', x2: '21', y2: '9' }),
  React.createElement('line', { x1: '9', y1: '21', x2: '9', y2: '9' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['workflows.manage'],
  pageTitle: 'Workflow Visual Editor',
  pageTitleKey: 'workflows.backend.definitions.visual_editor.title',
  pageGroup: 'Workflows',
  pageGroupKey: 'workflows.module.name',
  pagePriority: 10,
  pageOrder: 150,
  icon: visualEditorIcon,
  pageContext: 'settings' as const,
  breadcrumb: [
    { label: 'Workflows', labelKey: 'workflows.module.name', href: '/backend/definitions' },
    { label: 'Visual Editor', labelKey: 'workflows.backend.definitions.visual_editor.title' },
  ],
}
