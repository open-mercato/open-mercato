import React from 'react'

const webhookIcon = React.createElement(
  'svg',
  {
    width: 16,
    height: 16,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  },
  React.createElement('path', { d: 'M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 0 1 2 17c.01-.7.2-1.4.57-2' }),
  React.createElement('path', { d: 'M6 17a4 4 0 0 1 7.5-2' }),
  React.createElement('path', { d: 'M9 6.99h5.99c1.1 0 1.95-.94 2.48-1.9A4 4 0 0 1 22 7c-.01.7-.2 1.4-.57 2' }),
  React.createElement('path', { d: 'M18 7a4 4 0 0 1-7.5 2' }),
  React.createElement('path', { d: 'M12 8v8' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['webhooks.list'],
  pageTitle: 'Webhooks',
  pageTitleKey: 'webhooks.nav.webhooks',
  pageGroup: 'Configuration',
  pageGroupKey: 'backend.nav.configuration',
  pageOrder: 415,
  icon: webhookIcon,
  breadcrumb: [{ label: 'Webhooks', labelKey: 'webhooks.nav.webhooks' }],
} as const
