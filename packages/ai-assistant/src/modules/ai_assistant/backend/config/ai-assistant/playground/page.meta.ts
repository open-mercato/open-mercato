import React from 'react'

const playgroundIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
  React.createElement('path', { d: 'M14 4h6v6' }),
  React.createElement('path', { d: 'M10 20H4v-6' }),
  React.createElement('path', { d: 'M20 4 14 10' }),
  React.createElement('path', { d: 'm4 20 6-6' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['ai_assistant.settings.manage'],
  pageTitle: 'AI Playground',
  pageTitleKey: 'ai_assistant.playground.navTitle',
  pageGroup: 'Module Configs',
  pageGroupKey: 'settings.sections.moduleConfigs',
  pageOrder: 431,
  icon: playgroundIcon,
  pageContext: 'settings' as const,
  breadcrumb: [
    { label: 'AI Agents', labelKey: 'ai_assistant.agents.navTitle' },
    { label: 'Playground', labelKey: 'ai_assistant.playground.navTitle' },
  ],
} as const
