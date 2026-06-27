import React from 'react'

const caseloadIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('path', { d: 'M22 12h-6l-2 3h-4l-2-3H2' }),
  React.createElement('path', { d: 'M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z' }),
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
