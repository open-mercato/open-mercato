import React from 'react'

const queueIcon = React.createElement(
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
  React.createElement('rect', { x: 3, y: 4, width: 18, height: 4, rx: 1 }),
  React.createElement('rect', { x: 3, y: 10, width: 18, height: 4, rx: 1 }),
  React.createElement('rect', { x: 3, y: 16, width: 18, height: 4, rx: 1 }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['configs.queues_status.view'],
  pageTitle: 'Queue status',
  pageTitleKey: 'configs.config.nav.queuesStatus',
  pageGroup: 'System',
  pageGroupKey: 'settings.sections.system',
  pageOrder: 2,
  icon: queueIcon,
  pageContext: 'settings' as const,
  breadcrumb: [
    { label: 'Queue status', labelKey: 'configs.config.nav.queuesStatus' },
  ],
} as const
