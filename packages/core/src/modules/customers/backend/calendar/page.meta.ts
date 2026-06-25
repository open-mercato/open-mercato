import React from 'react'

const calendarIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('rect', { x: 3, y: 4, width: 18, height: 18, rx: 2 }),
  React.createElement('path', { d: 'M16 2v4' }),
  React.createElement('path', { d: 'M8 2v4' }),
  React.createElement('path', { d: 'M3 10h18' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['customers.interactions.view'],
  pageTitle: 'Calendar',
  pageTitleKey: 'customers.calendar.nav.title',
  pageGroup: 'Customers',
  pageGroupKey: 'customers.nav.group',
  pagePriority: 10,
  pageOrder: 50,
  icon: calendarIcon,
  breadcrumb: [{ label: 'Calendar', labelKey: 'customers.calendar.nav.title' }],
}
