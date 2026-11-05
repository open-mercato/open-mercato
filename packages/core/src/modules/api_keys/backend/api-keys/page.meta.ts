import React from 'react'

const keyIcon = React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('path', { d: 'M21 2l-2 2m-7.5 7.5l7.5-7.5' }),
  React.createElement('path', { d: 'M7.5 7.5a5 5 0 1 0 7 7' }),
  React.createElement('path', { d: 'M11 11l2 2' }),
  React.createElement('path', { d: 'M5 19l2-2' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['api_keys.view'],
  pageTitle: 'API Keys',
  pageTitleKey: 'api_keys.nav.apiKeys',
  pageGroup: 'Auth',
  pageGroupKey: 'settings.sections.auth',
  pageOrder: 3,
  icon: keyIcon,
  pageContext: 'settings' as const,
  breadcrumb: [{ label: 'API Keys', labelKey: 'api_keys.nav.apiKeys' }],
}
