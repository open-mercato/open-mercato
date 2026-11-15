import React from 'react'

const pipelineIcon = React.createElement(
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
  React.createElement('rect', { x: 3, y: 4, width: 5, height: 16, rx: 1 }),
  React.createElement('rect', { x: 10, y: 4, width: 5, height: 16, rx: 1 }),
  React.createElement('rect', { x: 17, y: 4, width: 4, height: 16, rx: 1 })
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['customers.pipelines.manage'],
  pageTitle: 'Pipeline stages',
  pageTitleKey: 'customers.config.nav.pipelineStages',
  pageGroup: 'Module Configs',
  pageGroupKey: 'settings.sections.moduleConfigs',
  pageOrder: 4,
  icon: pipelineIcon,
  pageContext: 'settings' as const,
  breadcrumb: [
    { label: 'Pipeline stages', labelKey: 'customers.config.nav.pipelineStages' },
  ],
} as const
