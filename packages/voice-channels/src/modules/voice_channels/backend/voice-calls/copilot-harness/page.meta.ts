import React from 'react'

const harnessIcon = React.createElement(
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
    d: 'M12 2v4',
  }),
  React.createElement('path', {
    d: 'M12 18v4',
  }),
  React.createElement('path', {
    d: 'M4.93 4.93l2.83 2.83',
  }),
  React.createElement('path', {
    d: 'M16.24 16.24l2.83 2.83',
  }),
  React.createElement('path', {
    d: 'M2 12h4',
  }),
  React.createElement('path', {
    d: 'M18 12h4',
  }),
  React.createElement('path', {
    d: 'M4.93 19.07l2.83-2.83',
  }),
  React.createElement('path', {
    d: 'M16.24 7.76l2.83-2.83',
  }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['voice_channels.mock.manage'],
  pageTitle: 'Call Copilot Harness',
  pageGroup: 'Voice Channels',
  pageOrder: 2,
  icon: harnessIcon,
  breadcrumb: [{ label: 'Call Copilot Harness' }],
}
