import React from 'react'

const overridesIcon = React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('path', { d: 'M4 21v-7' }),
  React.createElement('path', { d: 'M4 10V3' }),
  React.createElement('path', { d: 'M12 21v-9' }),
  React.createElement('path', { d: 'M12 8V3' }),
  React.createElement('path', { d: 'M20 21v-5' }),
  React.createElement('path', { d: 'M20 12V3' }),
  React.createElement('circle', { cx: 4, cy: 12, r: 2 }),
  React.createElement('circle', { cx: 12, cy: 10, r: 2 }),
  React.createElement('circle', { cx: 20, cy: 14, r: 2 }),
)

export const metadata = {
  requireAuth: true,
  requireRoles: ['superadmin'],
  pageTitle: 'Overrides',
  pageTitleKey: 'feature_toggles.nav.overrides',
  pageGroup: 'Feature Toggles',
  pageGroupKey: 'feature_toggles.nav.group',
  pageOrder: 200,
  icon: overridesIcon,
  breadcrumb: [ { label: 'Overrides', labelKey: 'feature_toggles.nav.overrides' } ],
}
