import React from 'react'

const systemIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('rect', { x: 3, y: 3, width: 18, height: 18, rx: 2, ry: 2 }),
  React.createElement('path', { d: 'M9 9h6v6H9z' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['entities.definitions.view'],
  pageTitle: 'System Entities',
  pageTitleKey: 'entities.nav.systemEntities',
  pageGroup: 'Data Designer',
  pageGroupKey: 'settings.sections.dataDesigner',
  pageOrder: 1,
  icon: systemIcon,
  pageContext: 'settings' as const,
}
