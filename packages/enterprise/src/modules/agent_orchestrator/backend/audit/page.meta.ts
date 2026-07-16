import React from 'react'

const auditIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('path', { d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' }),
  React.createElement('path', { d: 'M14 2v6h6' }),
  React.createElement('path', { d: 'M9 13h6' }),
  React.createElement('path', { d: 'M9 17h6' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['agent_orchestrator.proposals.view'],
  pageTitle: 'Audit',
  pageTitleKey: 'agent_orchestrator.nav.audit',
  pageGroup: 'Agents',
  pageGroupKey: 'agent_orchestrator.nav.group',
  pagePriority: 60,
  pageOrder: 180,
  icon: auditIcon,
  breadcrumb: [{ label: 'Audit', labelKey: 'agent_orchestrator.nav.audit' }],
}

export default metadata
