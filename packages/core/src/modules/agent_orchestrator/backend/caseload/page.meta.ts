import React from 'react'

const caseloadIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('path', { d: 'M9 11l3 3L22 4' }),
  React.createElement('path', { d: 'M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['agent_orchestrator.proposals.view'],
  pageTitle: 'Caseload',
  pageTitleKey: 'agent_orchestrator.nav.caseload',
  pageGroup: 'Agents',
  pageGroupKey: 'agent_orchestrator.nav.group',
  pagePriority: 10,
  pageOrder: 100,
  icon: caseloadIcon,
  breadcrumb: [{ label: 'Caseload', labelKey: 'agent_orchestrator.nav.caseload' }],
}

export default metadata
