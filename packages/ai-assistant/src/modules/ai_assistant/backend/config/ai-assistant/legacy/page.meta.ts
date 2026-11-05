import React from 'react'

const aiIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
  React.createElement('path', { d: 'M12 8V4H8' }),
  React.createElement('rect', { width: 16, height: 12, x: 4, y: 8, rx: 2 }),
  React.createElement('path', { d: 'M2 14h2' }),
  React.createElement('path', { d: 'M20 14h2' }),
  React.createElement('path', { d: 'M15 13v2' }),
  React.createElement('path', { d: 'M9 13v2' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['ai_assistant.settings.manage'],
  pageTitle: 'AI Assistant (legacy)',
  pageTitleKey: 'ai_assistant.config.nav.settingsLegacy',
  pageGroup: 'Module Configs',
  pageGroupKey: 'settings.sections.moduleConfigs',
  pageOrder: 432,
  icon: aiIcon,
  pageContext: 'settings' as const,
  breadcrumb: [
    { label: 'AI Agents', labelKey: 'ai_assistant.agents.navTitle' },
    { label: 'AI Assistant (legacy)', labelKey: 'ai_assistant.config.nav.settingsLegacy' },
  ],
} as const
