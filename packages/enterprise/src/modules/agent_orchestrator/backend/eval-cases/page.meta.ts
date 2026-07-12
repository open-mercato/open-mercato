import React from 'react'

const evalCasesIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('rect', { width: 8, height: 4, x: 8, y: 2, rx: 1 }),
  React.createElement('path', { d: 'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2' }),
  React.createElement('path', { d: 'M8 11h8' }),
  React.createElement('path', { d: 'M8 15h5' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['agent_orchestrator.eval.manage'],
  pageTitle: 'Eval cases',
  pageTitleKey: 'agent_orchestrator.nav.evalCases',
  pageGroup: 'Agents',
  pageGroupKey: 'agent_orchestrator.nav.group',
  pagePriority: 55,
  pageOrder: 175,
  icon: evalCasesIcon,
  breadcrumb: [{ label: 'Eval cases', labelKey: 'agent_orchestrator.nav.evalCases' }],
}

export default metadata
