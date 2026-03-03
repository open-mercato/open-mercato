import React from 'react'

const governanceIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('path', { d: 'M4 7h16' }),
  React.createElement('path', { d: 'M4 12h16' }),
  React.createElement('path', { d: 'M4 17h10' }),
  React.createElement('circle', { cx: 18, cy: 17, r: 2 }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['agent_governance.view'],
  pageTitle: 'Agent Governance',
  pageTitleKey: 'agent_governance.nav.dashboard',
  pageGroup: 'AI Operations',
  pageGroupKey: 'agent_governance.nav.group',
  pagePriority: 60,
  pageOrder: 30,
  icon: governanceIcon,
  breadcrumb: [{ label: 'AI Operations', labelKey: 'agent_governance.nav.group' }],
} as const
