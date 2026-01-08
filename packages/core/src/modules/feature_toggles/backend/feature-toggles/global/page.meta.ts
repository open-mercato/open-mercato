import React from 'react'

const globalTogglesIcon = React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('circle', { cx: 12, cy: 12, r: 10 }),
  React.createElement('path', { d: 'M2 12h20' }),
  React.createElement('path', { d: 'M12 2a15 15 0 0 1 0 20' }),
  React.createElement('path', { d: 'M12 2a15 15 0 0 0 0 20' }),
)

export const metadata = {
  requireAuth: true,
  requireRoles: ['superadmin'],
  pageTitle: 'Global',
  pageTitleKey: 'feature_toggles.nav.global',
  pageGroup: 'Feature Toggles',
  pageGroupKey: 'feature_toggles.nav.group',
  pageOrder: 100,
  icon: globalTogglesIcon,
  breadcrumb: [ { label: 'Feature Toggles', labelKey: 'feature_toggles.nav.global' } ],
}
