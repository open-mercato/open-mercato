import React from 'react'

const instructorsIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('path', { d: 'M22 10v6M2 10l10-5 10 5-10 5z' }),
  React.createElement('path', { d: 'M6 12v5c3 3 9 3 12 0v-5' })
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['instructors.view'],
  pageTitle: 'Instructors',
  pageTitleKey: 'instructors.nav.instructors',
  pageGroup: 'Instructors',
  pageGroupKey: 'instructors.nav.group',
  pagePriority: 20,
  pageOrder: 100,
  icon: instructorsIcon,
  breadcrumb: [{ label: 'Instructors', labelKey: 'instructors.nav.instructors' }],
}
