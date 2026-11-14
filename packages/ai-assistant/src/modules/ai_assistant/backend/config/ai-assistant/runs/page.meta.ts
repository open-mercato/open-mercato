import React from 'react'

const agentRunsIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
  React.createElement('path', { d: 'M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['ai_assistant.runs.view'],
  pageTitle: 'Agent runs',
  pageTitleKey: 'ai_assistant.runs.navTitle',
  pageGroup: 'Module Configs',
  pageGroupKey: 'settings.sections.moduleConfigs',
  pageOrder: 431,
  icon: agentRunsIcon,
  pageContext: 'settings' as const,
  breadcrumb: [
    { label: 'Agent runs', labelKey: 'ai_assistant.runs.navTitle' },
  ],
} as const
