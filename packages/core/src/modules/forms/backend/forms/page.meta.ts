import React from 'react'

const formsIcon = React.createElement(
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
  React.createElement('rect', { x: 3, y: 4, width: 18, height: 16, rx: 2 }),
  React.createElement('path', { d: 'M7 9h10' }),
  React.createElement('path', { d: 'M7 13h10' }),
  React.createElement('path', { d: 'M7 17h6' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['forms.view'],
  pageTitle: 'Forms',
  pageTitleKey: 'forms.list.title',
  pageGroup: 'Operations',
  pageGroupKey: 'backend.nav.operations',
  pageOrder: 30,
  icon: formsIcon,
  breadcrumb: [{ label: 'Forms', labelKey: 'forms.list.title' }],
}
