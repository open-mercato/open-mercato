import React from 'react'

const rulesIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('path', { d: 'M9 3h6l3 3v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6l3-3z' }),
  React.createElement('path', { d: 'M9 3v3h6' }),
  React.createElement('path', { d: 'M9 12h6' }),
  React.createElement('path', { d: 'M9 16h6' }),
)

export const metadata = {
    requireAuth: true,
    requireFeatures: ['business_rules.view'],
    pageTitle: 'Business Rules',
    pageTitleKey: 'rules.nav.rules',
    pageGroup: 'Business Rules',
    pageGroupKey: 'rules.nav.group',
    pagePriority: 40,
    pageOrder: 110,
    icon: rulesIcon,
    pageContext: 'settings' as const,
    breadcrumb: [{ label: 'Business Rules', labelKey: 'rules.nav.rules' }],
}
