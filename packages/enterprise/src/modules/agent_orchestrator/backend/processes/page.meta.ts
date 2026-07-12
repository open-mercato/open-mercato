import React from 'react'

const processesIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
  React.createElement('circle', { cx: 5, cy: 6, r: 2 }),
  React.createElement('circle', { cx: 5, cy: 18, r: 2 }),
  React.createElement('path', { d: 'M5 8v8' }),
  React.createElement('path', { d: 'M11 6h7' }),
  React.createElement('path', { d: 'M11 12h7' }),
  React.createElement('path', { d: 'M11 18h7' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['agent_orchestrator.processes.view'],
  pageTitle: 'Processes',
  pageTitleKey: 'agent_orchestrator.nav.processes',
  pageGroup: 'Agents',
  pageGroupKey: 'agent_orchestrator.nav.group',
  pagePriority: 10,
  pageOrder: 92,
  icon: processesIcon,
  breadcrumb: [{ label: 'Processes', labelKey: 'agent_orchestrator.nav.processes' }],
}

export default metadata
