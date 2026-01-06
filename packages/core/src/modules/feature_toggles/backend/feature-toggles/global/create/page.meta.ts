import React from 'react'

const createToggleIcon = React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('circle', { cx: 12, cy: 12, r: 9 }),
  React.createElement('path', { d: 'M12 8v8' }),
  React.createElement('path', { d: 'M8 12h8' }),
)

export const metadata = {
  requireAuth: true,
  requireRoles: ['superadmin'],
  pageTitle: 'Create Feature Toggle',
  pageTitleKey: 'feature_toggles.nav.global.create',
  pageGroup: 'Feature Toggles',
  pageGroupKey: 'feature_toggles.nav.group',
  pageOrder: 100,
  icon: createToggleIcon,
  breadcrumb: [ { label: 'Global', labelKey: 'feature_toggles.nav.global', href: '/backend/feature-toggles/global' }, { label: 'Create', labelKey: 'feature_toggles.nav.global.create' } ],
}
