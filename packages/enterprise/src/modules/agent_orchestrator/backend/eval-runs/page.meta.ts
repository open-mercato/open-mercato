import React from 'react'

const evalRunsIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('path', { d: 'm12 14 4-4' }),
  React.createElement('path', { d: 'M3.34 19a10 10 0 1 1 17.32 0' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['agent_orchestrator.eval.manage'],
  pageTitle: 'Evaluations',
  pageTitleKey: 'agent_orchestrator.nav.evalRuns',
  pageGroup: 'Agents',
  pageGroupKey: 'agent_orchestrator.nav.group',
  pagePriority: 57,
  pageOrder: 177,
  icon: evalRunsIcon,
  breadcrumb: [{ label: 'Evaluations', labelKey: 'agent_orchestrator.nav.evalRuns' }],
}

export default metadata
