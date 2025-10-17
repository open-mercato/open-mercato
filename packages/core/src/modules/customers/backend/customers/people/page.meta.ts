import React from 'react'

const peopleIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('path', { d: 'M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2' }),
  React.createElement('circle', { cx: 9, cy: 7, r: 4 }),
  React.createElement('path', { d: 'M23 21v-2a4 4 0 0 0-3-3.87' }),
  React.createElement('path', { d: 'M16 3.13a4 4 0 0 1 0 7.75' })
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['customers.people.view'],
  pageTitle: 'People',
  pageTitleKey: 'customers.nav.people',
  pageGroup: 'Customers',
  pageGroupKey: 'customers.nav.group',
  pageOrder: 100,
  icon: peopleIcon,
  breadcrumb: [{ label: 'People', labelKey: 'customers.nav.people' }],
}
