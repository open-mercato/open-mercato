import React from 'react'

const otelExportIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('path', { d: 'M4 12h10' }),
  React.createElement('path', { d: 'm10 6 6 6-6 6' }),
  React.createElement('path', { d: 'M20 4v16' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['agent_orchestrator.trace.view'],
  pageTitle: 'OTel export',
  pageTitleKey: 'agent_orchestrator.nav.otelExport',
  pageGroup: 'Settings',
  pageGroupKey: 'backend.nav.settings',
  pageOrder: 297,
  icon: otelExportIcon,
  pageContext: 'settings' as const,
  breadcrumb: [{ label: 'OTel export', labelKey: 'agent_orchestrator.nav.otelExport' }],
}

export default metadata
