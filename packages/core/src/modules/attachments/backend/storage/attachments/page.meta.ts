import React from 'react'

const attachmentIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
  React.createElement('path', { d: 'M21.44 11.05 12 20.5a5 5 0 1 1-7.07-7.07L14.5 3.86a3 3 0 1 1 4.24 4.24L8.93 17.91' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['attachments.view'],
  pageTitle: 'Attachments',
  pageTitleKey: 'attachments.library.title',
  pageGroup: 'Storage',
  pageGroupKey: 'customers.storage.nav.group',
  pagePriority: 20,
  pageOrder: 110,
  icon: attachmentIcon,
  breadcrumb: [
    { label: 'Attachments', labelKey: 'attachments.library.title' },
  ],
} as const
