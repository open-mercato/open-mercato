import React from 'react'

const brandingIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
  React.createElement('rect', { x: 3, y: 5, width: 18, height: 14, rx: 2 }),
  React.createElement('circle', { cx: 8, cy: 10, r: 1.5 }),
  React.createElement('path', { d: 'm21 15-5-5L5 21' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['directory.organizations.manage'],
  pageTitle: 'Organization branding',
  pageTitleKey: 'directory.branding.nav',
  pageGroup: 'Directory',
  pageGroupKey: 'settings.sections.directory',
  pageOrder: 0,
  icon: brandingIcon,
  pageContext: 'settings' as const,
  breadcrumb: [{ label: 'Organization branding', labelKey: 'directory.branding.nav' }],
}

export default metadata
