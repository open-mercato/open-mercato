import React from 'react'

const playgroundIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('polygon', { points: '5 3 19 12 5 21 5 3' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['agent_orchestrator.agents.run'],
  pageTitle: 'Playground',
  pageTitleKey: 'agent_orchestrator.nav.playground',
  pageGroup: 'Agents',
  pageGroupKey: 'agent_orchestrator.nav.group',
  pagePriority: 10,
  pageOrder: 130,
  icon: playgroundIcon,
  breadcrumb: [{ label: 'Playground', labelKey: 'agent_orchestrator.nav.playground' }],
}

export default metadata
