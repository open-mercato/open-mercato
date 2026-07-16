import React from 'react'

const agentsIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('rect', { x: 3, y: 11, width: 18, height: 10, rx: 2 }),
  React.createElement('circle', { cx: 12, cy: 5, r: 2 }),
  React.createElement('path', { d: 'M12 7v4' }),
  React.createElement('line', { x1: 8, y1: 16, x2: 8, y2: 16 }),
  React.createElement('line', { x1: 16, y1: 16, x2: 16, y2: 16 }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['agent_orchestrator.agents.view'],
  pageTitle: 'Agents',
  pageTitleKey: 'agent_orchestrator.nav.agents',
  pageGroup: 'Agents',
  pageGroupKey: 'agent_orchestrator.nav.group',
  pagePriority: 20,
  pageOrder: 120,
  icon: agentsIcon,
  breadcrumb: [{ label: 'Agents', labelKey: 'agent_orchestrator.nav.agents' }],
}

export default metadata
