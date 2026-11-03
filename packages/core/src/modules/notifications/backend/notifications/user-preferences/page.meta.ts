import React from 'react'

const usersCogIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
  React.createElement('path', { d: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2' }),
  React.createElement('circle', { cx: 9, cy: 7, r: 4 }),
  React.createElement('circle', { cx: 19, cy: 16, r: 2 }),
  React.createElement('path', { d: 'M19 12v1' }),
  React.createElement('path', { d: 'M19 19v1' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['notifications.manage_user_preferences'],
  pageTitle: 'User Notification Preferences',
  pageTitleKey: 'notifications.preferences.admin.pageTitle',
  pageGroup: 'Auth',
  pageGroupKey: 'settings.sections.auth',
  pageOrder: 5,
  icon: usersCogIcon,
  pageContext: 'settings' as const,
  breadcrumb: [
    { label: 'User Notification Preferences', labelKey: 'notifications.preferences.admin.pageTitle' },
  ],
} as const
