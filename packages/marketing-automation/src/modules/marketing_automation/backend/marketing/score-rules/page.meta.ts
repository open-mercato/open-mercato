import React from 'react'

const scoreRuleIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
  React.createElement('path', { d: 'M3 17l6-6 4 4 8-8' }),
  React.createElement('path', { d: 'M14 7h7v7' }),
)

export const metadata = {
  icon: scoreRuleIcon,
  requireAuth: true,
  requireFeatures: ['marketing_automation.campaigns.view'],
  pageGroup: 'Marketing',
  pageGroupKey: 'marketing_automation.nav.group',
  pageTitle: 'Score rules',
  pageTitleKey: 'marketing_automation.scoreRules.title',
  breadcrumb: [
    { label: 'Score rules', labelKey: 'marketing_automation.scoreRules.title' },
  ],
}
