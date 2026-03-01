import React from 'react'

const credentialsIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('rect', { x: 3, y: 3, width: 18, height: 18, rx: 2 }),
  React.createElement('path', { d: 'M9 12l2 2 4-4' })
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['instructors.credentials.view'],
  pageTitle: 'Credentials',
  pageTitleKey: 'instructors.nav.credentials',
  pageGroup: 'Instructors',
  pageGroupKey: 'instructors.nav.group',
  pagePriority: 20,
  pageOrder: 110,
  icon: credentialsIcon,
  breadcrumb: [
    { label: 'Instructors', labelKey: 'instructors.nav.instructors', href: '/backend/instructors' },
    { label: 'Credentials', labelKey: 'instructors.nav.credentials' },
  ],
}
