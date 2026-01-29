import React from 'react'

const logsIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('path', { d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' }),
  React.createElement('path', { d: 'M14 2v6h6' }),
  React.createElement('path', { d: 'M8 13h8' }),
  React.createElement('path', { d: 'M8 17h5' }),
)

export const metadata = {
    requireAuth: true,
    requireFeatures: ['business_rules.view'],
    pageTitle: 'Logs',
    pageTitleKey: 'rules.nav.logs',
    pageGroup: 'Business Rules',
    pageGroupKey: 'rules.nav.group',
    pageOrder: 130,
    icon: logsIcon,
    pageContext: 'settings' as const,
    breadcrumb: [{ label: 'Business Rules Logs', labelKey: 'rules.nav.rules_logs' }],
}
