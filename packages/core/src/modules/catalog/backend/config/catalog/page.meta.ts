import React from 'react'

const catalogIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
  React.createElement('rect', { x: 3, y: 4, width: 7, height: 7, rx: 1 }),
  React.createElement('rect', { x: 14, y: 4, width: 7, height: 7, rx: 1 }),
  React.createElement('rect', { x: 3, y: 13, width: 7, height: 7, rx: 1 }),
  React.createElement('rect', { x: 14, y: 13, width: 7, height: 7, rx: 1 }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['catalog.settings.manage'],
  pageTitle: 'Catalog',
  pageTitleKey: 'catalog.config.nav.catalog',
  pageGroup: 'Module Configs',
  pageGroupKey: 'settings.sections.moduleConfigs',
  pageOrder: 2,
  icon: catalogIcon,
  pageContext: 'settings' as const,
  breadcrumb: [
    { label: 'Catalog', labelKey: 'catalog.config.nav.catalog' },
  ],
} as const
