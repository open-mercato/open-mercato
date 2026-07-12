import React from 'react'

const tasksIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('path', { d: 'M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z' }),
  React.createElement('path', { d: 'm9 12 2 2 4-4' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['agent_orchestrator.tasks.view'],
  pageTitle: 'Agentic Tasks',
  pageTitleKey: 'agent_orchestrator.nav.tasks',
  pageGroup: 'Agents',
  pageGroupKey: 'agent_orchestrator.nav.group',
  pagePriority: 10,
  pageOrder: 160,
  icon: tasksIcon,
  breadcrumb: [{ label: 'Agentic Tasks', labelKey: 'agent_orchestrator.nav.tasks' }],
}

export default metadata
