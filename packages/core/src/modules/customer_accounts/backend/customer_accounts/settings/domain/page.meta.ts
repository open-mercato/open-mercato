import React from 'react'

const globeIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
  React.createElement('circle', { cx: 12, cy: 12, r: 10 }),
  React.createElement('path', { d: 'M2 12h20' }),
  React.createElement('path', { d: 'M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['customer_accounts.domain.manage'],
  pageTitle: 'Custom Domain',
  pageTitleKey: 'customer_accounts.domainMapping.title',
  pageGroup: 'Module Configs',
  pageGroupKey: 'settings.sections.moduleConfigs',
  pageOrder: 60,
  icon: globeIcon,
  pageContext: 'settings' as const,
  breadcrumb: [
    { label: 'Custom Domain', labelKey: 'customer_accounts.domainMapping.title' },
  ],
}

export default metadata
