import React from 'react'

const mailIcon = React.createElement(
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
  React.createElement('rect', { x: 2, y: 4, width: 20, height: 16, rx: 2 }),
  React.createElement('path', { d: 'm22 7-8.97 5.7a2 2 0 0 1-2.06 0L2 7' }),
)

export const metadata = {
  requireAuth: true,
  pageTitle: 'Messages',
  pageTitleKey: 'messages.nav.inbox',
  pageGroup: 'Messages',
  pageGroupKey: 'messages.nav.group',
  pageOrder: 460,
  icon: mailIcon,
  breadcrumb: [
    { label: 'Messages', labelKey: 'messages.nav.inbox' },
  ],
} as const
