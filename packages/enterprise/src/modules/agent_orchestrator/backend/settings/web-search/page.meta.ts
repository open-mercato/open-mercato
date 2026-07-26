import React from 'react'

const webSearchIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('circle', { cx: 12, cy: 12, r: 10 }),
  React.createElement('path', { d: 'M2 12h20' }),
  React.createElement('path', { d: 'M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z' }),
)

export const metadata = {
  requireAuth: true,
  requireFeatures: ['agent_orchestrator.agents.manage'],
  pageTitle: 'Web search',
  pageTitleKey: 'agent_orchestrator.nav.webSearch',
  pageGroup: 'Agents',
  pageGroupKey: 'agent_orchestrator.nav.group',
  pagePriority: 30,
  pageOrder: 190,
  icon: webSearchIcon,
  breadcrumb: [{ label: 'Web search', labelKey: 'agent_orchestrator.nav.webSearch' }],
}

export default metadata
