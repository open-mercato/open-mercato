import React from 'react'

const sidebarCustomizeIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
  React.createElement('rect', { x: 3, y: 3, width: 7, height: 18, rx: 1 }),
  React.createElement('rect', { x: 14, y: 3, width: 7, height: 11, rx: 1 }),
  React.createElement('path', { d: 'M14 17h7' }),
  React.createElement('path', { d: 'M17.5 14v7' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['auth.sidebar.manage'],
  pageTitle: 'Customize sidebar',
  pageTitleKey: 'appShell.customizeSidebar',
  pageGroup: 'Customization',
  pageGroupKey: 'appShell.sidebarCustomizationGroup',
  pageOrder: 1,
  icon: sidebarCustomizeIcon,
  pageContext: 'settings' as const,
  breadcrumb: [
    { label: 'Customize sidebar', labelKey: 'appShell.customizeSidebar' },
  ],
}

export default metadata
