import React from 'react'

const webhookIcon = React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
  React.createElement('path', { d: 'M18 16.98h1a2 2 0 0 0 2-2v-1a2 2 0 0 0-4 0v4a2 2 0 0 1-4 0v-1a2 2 0 0 1 2-2h1' }),
  React.createElement('path', { d: 'M2 12a10 10 0 0 1 18-6' }),
  React.createElement('path', { d: 'M12 2a10 10 0 0 1 6 18' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['webhooks.view'],
  pageTitle: 'Webhooks',
  pageTitleKey: 'webhooks.nav.title',
  pageGroup: 'External systems',
  pageGroupKey: 'backend.nav.externalSystems',
  pageOrder: 1,
  icon: webhookIcon,
  pageContext: 'settings' as const,
  breadcrumb: [{ label: 'Webhooks', labelKey: 'webhooks.nav.title' }],
}
