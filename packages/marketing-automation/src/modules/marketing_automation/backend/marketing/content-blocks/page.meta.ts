import React from 'react'

const blockIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
  React.createElement('rect', { x: 3, y: 3, width: 18, height: 7, rx: 1 }),
  React.createElement('rect', { x: 3, y: 14, width: 18, height: 7, rx: 1 }),
)

export const metadata = {
  icon: blockIcon,
  requireAuth: true,
  requireFeatures: ['marketing_automation.campaigns.view'],
  pageGroup: 'Marketing',
  pageGroupKey: 'marketing_automation.nav.group',
  pageTitle: 'Content blocks',
  pageTitleKey: 'marketing_automation.blocks.title',
  breadcrumb: [
    { label: 'Content blocks', labelKey: 'marketing_automation.blocks.title' },
  ],
}
