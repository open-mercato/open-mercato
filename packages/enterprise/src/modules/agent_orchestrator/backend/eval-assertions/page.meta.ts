import React from 'react'

const evalIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('rect', { width: 8, height: 4, x: 8, y: 2, rx: 1 }),
  React.createElement('path', { d: 'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2' }),
  React.createElement('path', { d: 'm9 14 2 2 4-4' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['agent_orchestrator.eval.manage'],
  pageTitle: 'Eval assertions',
  pageTitleKey: 'agent_orchestrator.nav.evalAssertions',
  pageGroup: 'Agents',
  pageGroupKey: 'agent_orchestrator.nav.group',
  pagePriority: 50,
  pageOrder: 170,
  icon: evalIcon,
  breadcrumb: [{ label: 'Eval assertions', labelKey: 'agent_orchestrator.nav.evalAssertions' }],
}

export default metadata
