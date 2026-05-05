import React from 'react'

const agentsIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
  React.createElement('rect', { width: 18, height: 10, x: 3, y: 11, rx: 2 }),
  React.createElement('circle', { cx: 12, cy: 5, r: 2 }),
  React.createElement('path', { d: 'M12 7v4' }),
  React.createElement('line', { x1: 8, y1: 16, x2: 8, y2: 16 }),
  React.createElement('line', { x1: 16, y1: 16, x2: 16, y2: 16 }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['ai_assistant.settings.manage'],
  pageTitle: 'AI Agents',
  pageTitleKey: 'ai_assistant.agents.navTitle',
  pageGroup: 'Module Configs',
  pageGroupKey: 'settings.sections.moduleConfigs',
  pageOrder: 430,
  icon: agentsIcon,
  pageContext: 'settings' as const,
  breadcrumb: [
    { label: 'AI Agents', labelKey: 'ai_assistant.agents.navTitle' },
  ],
} as const
