import React from 'react'

const pendingActionsIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
  React.createElement('circle', { cx: 12, cy: 12, r: 9 }),
  React.createElement('path', { d: 'M12 7v5l3 2' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['ai_assistant.view'],
  pageTitle: 'Pending AI actions',
  pageTitleKey: 'ai_assistant.pendingActions.navTitle',
  pageGroup: 'Module Configs',
  pageGroupKey: 'settings.sections.moduleConfigs',
  pageOrder: 433,
  icon: pendingActionsIcon,
  pageContext: 'settings' as const,
  breadcrumb: [
    { label: 'Pending AI actions', labelKey: 'ai_assistant.pendingActions.navTitle' },
  ],
} as const
