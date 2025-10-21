import React from 'react'

const companyIcon = React.createElement(
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
  React.createElement('path', { d: 'M3 22h18' }),
  React.createElement('path', { d: 'M5 22V9a1 1 0 0 1 .55-.89l6.4-3.2a1 1 0 0 1 .9 0l6.6 3.3A1 1 0 0 1 19 9v13' }),
  React.createElement('path', { d: 'M9 22v-6h6v6' }),
  React.createElement('path', { d: 'M9 12h6' }),
  React.createElement('path', { d: 'M9 16h6' }),
  React.createElement('path', { d: 'M7 12h.01' }),
  React.createElement('path', { d: 'M17 12h.01' })
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
