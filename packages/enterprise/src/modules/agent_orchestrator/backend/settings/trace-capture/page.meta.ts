import React from 'react'

const traceCaptureIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('path', { d: 'M3 12h4l3-8 4 16 3-8h4' }),
)

export const metadata = {
  requireAuth: true,
  // Anyone who can read traces can see how much they record; changing the policy
  // additionally needs `agents.manage` + `trace.view_content`, enforced at the PUT
  // route and mirrored as read-only mode in the page.
  requireFeatures: ['agent_orchestrator.trace.view'],
  pageTitle: 'Trace capture',
  pageTitleKey: 'agent_orchestrator.nav.traceCapture',
  pageGroup: 'Settings',
  pageGroupKey: 'backend.nav.settings',
  pageOrder: 296,
  icon: traceCaptureIcon,
  pageContext: 'settings' as const,
  breadcrumb: [{ label: 'Trace capture', labelKey: 'agent_orchestrator.nav.traceCapture' }],
}

export default metadata
