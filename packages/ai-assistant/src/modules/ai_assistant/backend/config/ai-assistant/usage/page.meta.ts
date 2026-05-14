import React from 'react'

const usageIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
  React.createElement('path', { d: 'M3 3v18h18' }),
  React.createElement('path', { d: 'M7 16l4-4 4 4 4-4' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['ai_assistant.settings.manage'],
  pageTitle: 'AI Usage',
  pageTitleKey: 'ai_assistant.usage.navTitle',
  pageGroup: 'Module Configs',
  pageGroupKey: 'settings.sections.moduleConfigs',
  pageOrder: 431,
  icon: usageIcon,
  pageContext: 'settings' as const,
  breadcrumb: [
    { label: 'AI Usage', labelKey: 'ai_assistant.usage.navTitle' },
  ],
} as const
