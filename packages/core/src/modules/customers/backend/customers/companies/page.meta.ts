import React from 'react'

const companyIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('path', { d: 'M3 21V8a2 2 0 0 1 2-2h5v15' }),
  React.createElement('path', { d: 'M9 21V5a2 2 0 0 1 2-2h8v18' }),
  React.createElement('path', { d: 'M3 21h18' }),
  React.createElement('path', { d: 'M7 10h2' }),
  React.createElement('path', { d: 'M7 14h2' }),
  React.createElement('path', { d: 'M15 10h2' }),
  React.createElement('path', { d: 'M15 14h2' })
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['customers.companies.view'],
  pageTitle: 'Companies',
  pageTitleKey: 'customers.nav.companies',
  pageGroup: 'Customers',
  pageGroupKey: 'customers.nav.group',
  pagePriority: 10,
  pageOrder: 110,
  icon: companyIcon,
  breadcrumb: [{ label: 'Companies', labelKey: 'customers.nav.companies' }],
}
