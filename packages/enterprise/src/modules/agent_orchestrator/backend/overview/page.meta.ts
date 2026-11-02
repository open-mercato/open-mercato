import React from 'react'

const overviewIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('rect', { x: 3, y: 3, width: 7, height: 9, rx: 1 }),
  React.createElement('rect', { x: 14, y: 3, width: 7, height: 5, rx: 1 }),
  React.createElement('rect', { x: 14, y: 12, width: 7, height: 9, rx: 1 }),
  React.createElement('rect', { x: 3, y: 16, width: 7, height: 5, rx: 1 }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['agent_orchestrator.proposals.view'],
  pageTitle: 'Overview',
  pageTitleKey: 'agent_orchestrator.nav.overview',
  pageGroup: 'Agents',
  pageGroupKey: 'agent_orchestrator.nav.group',
  pagePriority: 10,
  pageOrder: 90,
  icon: overviewIcon,
  breadcrumb: [{ label: 'Overview', labelKey: 'agent_orchestrator.nav.overview' }],
}

export default metadata
