import React from 'react'

const channelsIcon = React.createElement(
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
  React.createElement('path', {
    d: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  }),
  React.createElement('circle', { cx: 12, cy: 11, r: 1 }),
  React.createElement('circle', { cx: 7, cy: 11, r: 1 }),
  React.createElement('circle', { cx: 17, cy: 11, r: 1 }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['communication_channels.view'],
  pageTitle: 'Communication Channels',
  pageTitleKey: 'communication_channels.nav.title',
  pageGroup: 'Integrations',
  pageGroupKey: 'communication_channels.nav.group',
  pageOrder: 90,
  icon: channelsIcon,
  pageContext: 'main' as const,
  breadcrumb: [
    { label: 'Communication Channels', labelKey: 'communication_channels.nav.title' },
  ],
} as const
