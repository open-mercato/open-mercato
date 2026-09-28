import React from 'react'

const createIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('path', { d: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2' }),
  React.createElement('circle', { cx: 9, cy: 7, r: 4 }),
  React.createElement('path', { d: 'M23 21v-2a4 4 0 0 0-3-3.87' }),
  React.createElement('path', { d: 'M16 3.13a4 4 0 0 1 0 7.75' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['customer_groups.groups.manage'],
  pageTitle: 'Create Customer Group',
  pageTitleKey: 'customer_groups.groups.form.createTitle',
  pageGroup: 'Customers',
  pageGroupKey: 'customers.nav.group',
  icon: createIcon,
  breadcrumb: [
    { label: 'Customer Groups', labelKey: 'customer_groups.groups.page.title', href: '/backend/customer-groups' },
    { label: 'Create', labelKey: 'common.create' },
  ],
}
