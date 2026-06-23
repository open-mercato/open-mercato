import React from 'react'

const kanbanIcon = React.createElement(
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
  React.createElement('rect', { width: 7, height: 9, x: 3, y: 3, rx: 1 }),
  React.createElement('rect', { width: 7, height: 5, x: 14, y: 3, rx: 1 }),
  React.createElement('rect', { width: 7, height: 9, x: 14, y: 12, rx: 1 }),
  React.createElement('rect', { width: 7, height: 5, x: 3, y: 16, rx: 1 }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['customers.leads.view'],
  pageTitle: 'Leads board',
  pageTitleKey: 'customers.nav.leads.kanban',
  pageGroup: 'Customers',
  pageGroupKey: 'customers.nav.group',
  pagePriority: 10,
  pageOrder: 116,
  icon: kanbanIcon,
  breadcrumb: [
    { label: 'Leads', labelKey: 'customers.nav.leads', href: '/backend/customers/leads' },
    { label: 'Leads board', labelKey: 'customers.nav.leads.kanban' },
  ],
}
