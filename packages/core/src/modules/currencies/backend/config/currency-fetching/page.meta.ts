import React from 'react'

const exchangeRateIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
  React.createElement('path', { d: 'M7 16l-4-4 4-4' }),
  React.createElement('path', { d: 'M3 12h11' }),
  React.createElement('path', { d: 'M17 8l4 4-4 4' }),
  React.createElement('path', { d: 'M21 12H10' }),
)

export const metadata = {
  icon: exchangeRateIcon,
  requireAuth: true,
  requireFeatures: ['currencies.fetch.view'],
  pageGroup: 'Module Configs',
  pageGroupKey: 'settings.sections.moduleConfigs',
  pageTitle: 'Currency Rate Fetching',
  pageTitleKey: 'currencies.fetch.title',
  pageOrder: 4,
  pageContext: 'settings' as const,
}
