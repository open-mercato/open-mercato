import React from 'react'

const setsIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
  React.createElement('rect', { x: 8, y: 2, width: 12, height: 16, rx: 1 }),
  React.createElement('path', { d: 'M16 2v4h4' }),
  React.createElement('line', { x1: 11, y1: 11, x2: 17, y2: 11 }),
  React.createElement('line', { x1: 11, y1: 14, x2: 15, y2: 14 }),
  React.createElement('path', { d: 'M6 4v16c0 .6.4 1 1 1h11' }),
  React.createElement('path', { d: 'M4 6v16c0 .6.4 1 1 1h11' }),
)

export const metadata = {
  requireAuth: true,
  pageGroup: 'Business Rules',
  pageTitle: 'Rule Sets',
  pageTitleKey: 'rules.nav.sets',
  pageGroupKey: 'rules.nav.group',
  requireFeatures: ['business_rules.view'],
  pageOrder: 120,
  icon: setsIcon,
  pageContext: 'settings' as const,
  breadcrumb: [{label: 'Rule Sets', labelKey: 'rules.nav.sets'}],
}
