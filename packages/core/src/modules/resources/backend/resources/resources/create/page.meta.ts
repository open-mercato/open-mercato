import React from 'react'

const createPageIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('path', { d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' }),
  React.createElement('polyline', { points: '14 2 14 8 20 8' }),
  React.createElement('path', { d: 'M12 11v6M9 14h6' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['resources.manage_resources'],
  pageTitle: 'Create resource',
  pageTitleKey: 'resources.resources.form.createTitle',
  pageGroup: 'Resource planning',
  pageGroupKey: 'resources.nav.group',
  pageOrder: 31.1,
  icon: createPageIcon,
  breadcrumb: [
    { label: 'Resources', labelKey: 'resources.resources.page.title', href: '/backend/resources/resources' },
    { label: 'Create', labelKey: 'common.create' },
  ],
}
