import React from 'react'

const autoApprovalIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('path', { d: 'M12 3l7 3v6c0 4.5-3 8-7 9-4-1-7-4.5-7-9V6z' }),
  React.createElement('path', { d: 'M9 12l2 2 4-4' }),
)

export const metadata = {
  requireAuth: true,
  // Same view-level gate as the rest of the Agents group, so the entry appears
  // wherever the other orchestrator pages do. Changing the policy is separately
  // gated on `agents.manage` at the PUT route.
  requireFeatures: ['agent_orchestrator.agents.view'],
  pageTitle: 'Auto-approval',
  pageTitleKey: 'agent_orchestrator.nav.autoApproval',
  // A tenant-wide standing decision about unattended action, not a property of
  // any one agent or workflow — so it lives in Settings beside web search.
  pageGroup: 'Settings',
  pageGroupKey: 'backend.nav.settings',
  pageOrder: 295,
  icon: autoApprovalIcon,
  pageContext: 'settings' as const,
  breadcrumb: [{ label: 'Auto-approval', labelKey: 'agent_orchestrator.nav.autoApproval' }],
}

export default metadata
