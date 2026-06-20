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
  React.createElement('path', { d: 'M3 5h18l-2 3v6l2 3H3l2-3V8L3 5z' }),
  React.createElement('path', { d: 'M3 5l9 7 9-7' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['communication_channels.connect_user_channel'],
  pageTitle: 'My communication channels',
  pageTitleKey: 'communication_channels.profile.title',
  pageGroup: 'Profile',
  pageGroupKey: 'communication_channels.profile.group',
  pageOrder: 20,
  icon: channelsIcon,
  pageContext: 'profile' as const,
  breadcrumb: [
    { label: 'Profile', labelKey: 'communication_channels.profile.group' },
    {
      label: 'My communication channels',
      labelKey: 'communication_channels.profile.title',
    },
  ],
} as const
