import React from 'react'

const editIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('path', { d: 'M4 4h7l2 3h7v13H4z' }),
  React.createElement('path', { d: 'M4 4v16' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['resources.manage_resources'],
  pageTitle: 'Edit resource type',
  pageTitleKey: 'resources.resourceTypes.form.editTitle',
  pageGroup: 'Resource planning',
  pageGroupKey: 'resources.nav.group',
  icon: editIcon,
  breadcrumb: [
    { label: 'Resource types', labelKey: 'resources.resourceTypes.page.title', href: '/backend/resources/resource-types' },
    { label: 'Edit', labelKey: 'common.edit' },
  ],
}
