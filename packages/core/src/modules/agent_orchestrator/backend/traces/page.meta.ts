import React from 'react'

const tracesIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('path', { d: 'M3 12h4l3 8 4-16 3 8h4' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['agent_orchestrator.trace.view'],
  pageTitle: 'Traces',
  pageTitleKey: 'agent_orchestrator.nav.traces',
  pageGroup: 'Agents',
  pageGroupKey: 'agent_orchestrator.nav.group',
  pagePriority: 10,
  pageOrder: 95,
  icon: tracesIcon,
  breadcrumb: [{ label: 'Traces', labelKey: 'agent_orchestrator.nav.traces' }],
}

export default metadata
