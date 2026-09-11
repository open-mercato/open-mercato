import React from 'react'

const workflowCommandsIcon = React.createElement(
  'svg',
  {
    width: 16,
    height: 16,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  },
  React.createElement('rect', { x: 3, y: 3, width: 7, height: 7, rx: 1 }),
  React.createElement('rect', { x: 14, y: 14, width: 7, height: 7, rx: 1 }),
  React.createElement('path', { d: 'M10 6.5h4a3 3 0 0 1 3 3V14' }),
)

export const metadata = {
  requireAuth: true,
  // Reading the posture rides on definition authoring; the PUT behind this page
  // is gated separately on `workflows.manage` by the API route.
  requireFeatures: ['workflows.definitions.view'],
  pageTitle: 'Workflow Commands',
  pageTitleKey: 'workflows.commandSettings.pageTitle',
  pageGroup: 'Module Configs',
  pageGroupKey: 'settings.sections.moduleConfigs',
  pageOrder: 12,
  icon: workflowCommandsIcon,
  pageContext: 'settings' as const,
  breadcrumb: [{ label: 'Workflow Commands', labelKey: 'workflows.commandSettings.pageTitle' }],
} as const
